// GitLab client: payload mapping, pagination, diff-free stats, errors and the GET-only guard.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitlabApiError,
  getIssue,
  getMergeRequestStats,
  getRelatedMergeRequests,
  mergeRequestRefs,
} from "@/lib/gitlab/client";
import issueFixture from "./fixtures/gitlab/issue.json";
import relatedFixture from "./fixtures/gitlab/related_merge_requests.json";

const BASE = "https://gitlab.example.com";
const TOKEN = "glpat-test-token";

type Route = { body: unknown; status?: number; nextPage?: string };
// Routes keyed by "<pathname>" or "<pathname>?page=N".
let routes: Record<string, Route>;
const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
  const url = new URL(String(input));
  const page = url.searchParams.get("page");
  const route = (page && routes[`${url.pathname}?page=${page}`]) || routes[url.pathname];
  if (!route) return new Response(JSON.stringify({ message: "404 Not Found" }), { status: 404 });
  const headers = new Headers({ "content-type": "application/json" });
  if (route.nextPage) headers.set("x-next-page", route.nextPage);
  else headers.set("x-next-page", "");
  return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers });
});

beforeAll(() => {
  process.env.GITLAB_BASE_URL = BASE;
  process.env.GITLAB_API_TOKEN = TOKEN;
});

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Every request this client made must be a GET carrying the token.
  for (const [input, init] of fetchMock.mock.calls) {
    expect(String(input).startsWith(`${BASE}/api/v4/`)).toBe(true);
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
    expect(new Headers(init?.headers).get("PRIVATE-TOKEN")).toBe(TOKEN);
  }
  vi.unstubAllGlobals();
});

describe("getIssue", () => {
  it("maps the issue payload", async () => {
    routes["/api/v4/projects/501/issues/12"] = { body: issueFixture };
    expect(await getIssue(501, 12)).toEqual({
      id: 90210,
      iid: 12,
      projectId: 501,
      title: "Exportar relatorio em CSV",
      description: "Solicitante: @maria\n\nPrecisamos exportar o relatorio.",
      webUrl: "https://gitlab.example.com/acme/app/-/issues/12",
      labels: ["Development: Done", "Branch: Staging"],
      weight: 3,
      assigneeIds: [7, 9],
      state: "opened",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults missing weight and assignees", async () => {
    const { weight: _w, assignees: _a, ...rest } = issueFixture;
    routes["/api/v4/projects/501/issues/12"] = { body: { ...rest, description: null } };
    const issue = await getIssue(501, 12);
    expect(issue.weight).toBeNull();
    expect(issue.assigneeIds).toEqual([]);
    expect(issue.description).toBeNull();
  });

  it("throws GitlabApiError on 404", async () => {
    const err = await getIssue(501, 999).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitlabApiError);
    expect(err).toMatchObject({ status: 404, path: "/projects/501/issues/999" });
  });
});

describe("getRelatedMergeRequests", () => {
  it("maps related MRs, including cross-project paths", async () => {
    routes["/api/v4/projects/501/issues/12/related_merge_requests"] = { body: relatedFixture };
    expect(await getRelatedMergeRequests(501, 12)).toEqual([
      {
        id: 3001,
        iid: 45,
        projectId: 777,
        projectPath: "acme/sub/api",
        title: "Exportar CSV",
        description: "Closes acme/app#12\n\n## Notas de entrega\nNovo botao de exportar.",
        webUrl: "https://gitlab.example.com/acme/sub/api/-/merge_requests/45",
        state: "merged",
        authorId: 7,
        targetBranch: "main",
        mergedAt: "2026-10-03T08:00:00.000Z",
      },
      {
        id: 3002,
        iid: 46,
        projectId: 501,
        projectPath: "acme/app",
        title: "Draft: ajuste de layout",
        description: null,
        webUrl: "https://gitlab.example.com/acme/app/-/merge_requests/46",
        state: "opened",
        authorId: 9,
        targetBranch: "staging",
        mergedAt: null,
      },
    ]);
  });

  it("follows x-next-page pagination", async () => {
    const path = "/api/v4/projects/501/issues/12/related_merge_requests";
    routes[`${path}?page=1`] = { body: [relatedFixture[0]], nextPage: "2" };
    routes[`${path}?page=2`] = { body: [relatedFixture[1]] };
    const mrs = await getRelatedMergeRequests(501, 12);
    expect(mrs.map((m) => m.iid)).toEqual([45, 46]);
    const calls = fetchMock.mock.calls.map(([input]) => new URL(String(input))).filter((u) => u.pathname === path);
    expect(calls).toHaveLength(2);
    const pages = calls.map((u) => u.searchParams);
    expect(pages.map((p) => p.get("page"))).toEqual(["1", "2"]);
    expect(pages.every((p) => p.get("per_page") === "100")).toBe(true);
  });

  it("adds MRs referenced in the issue's comments, skipping unreadable and repeated ones", async () => {
    routes["/api/v4/projects/501/issues/12/related_merge_requests"] = { body: [relatedFixture[0]] };
    routes["/api/v4/projects/501/issues/12/notes"] = {
      body: [
        { system: false, body: "acme/sub/api!45 e acme/back!132" },
        { system: false, body: "Ver https://gitlab.example.com/acme/back/-/merge_requests/132 e !46" },
        { system: false, body: "secret/proj!9" },
        { system: true, body: "mentioned in acme/other!1" },
      ],
    };
    const back = { ...relatedFixture[0], id: 4001, iid: 132, project_id: 900, references: { full: "acme/back!132" } };
    routes["/api/v4/projects/acme%2Fback/merge_requests/132"] = { body: back };
    routes["/api/v4/projects/501/merge_requests/46"] = { body: relatedFixture[1] };
    const mrs = await getRelatedMergeRequests(501, 12);
    expect(mrs.map((m) => `${m.projectPath}!${m.iid}`)).toEqual(["acme/sub/api!45", "acme/back!132", "acme/app!46"]);
  });
});

describe("mergeRequestRefs", () => {
  it("reads full refs, short refs and MR URLs, but not issue refs or words", () => {
    expect(
      mergeRequestRefs("p1429/modules/api!132, !7, Feito! 8, acme/app#12, https://gitlab.com/a/b/-/merge_requests/3"),
    ).toEqual([
      { project: "a/b", iid: 3 },
      { project: "p1429/modules/api", iid: 132 },
      { project: null, iid: 7 },
    ]);
  });
});

describe("getMergeRequestStats", () => {
  const diffA = [
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "+const c = 4;",
    "",
  ].join("\n");
  const diffB = "@@ -0,0 +1,2 @@\n+SECRET_LINE_ONE\n+SECRET_LINE_TWO\n";
  const diffC = "@@ -1,2 +0,0 @@\n-gone\n---not-a-header-in-content\n";

  it("counts lines from paginated diffs, returns no diff text", async () => {
    const base = "/api/v4/projects/777/merge_requests/45";
    routes[`${base}/diffs?page=1`] = {
      body: [
        { old_path: "src/a.ts", new_path: "src/a.ts", diff: diffA },
        { old_path: "src/b.ts", new_path: "src/b.ts", new_file: true, diff: diffB },
      ],
      nextPage: "2",
    };
    routes[`${base}/diffs?page=2`] = {
      body: [{ old_path: "src/c.ts", new_path: "src/c.ts", deleted_file: true, diff: diffC }],
    };
    routes[`${base}/commits`] = {
      body: [
        { id: "c3", created_at: "2026-10-02T15:00:00.000+00:00" },
        { id: "c1", created_at: "2026-10-01T09:00:00.000+00:00" },
        { id: "c2", created_at: "2026-10-01T18:00:00.000+00:00" },
      ],
    };

    const stats = await getMergeRequestStats(777, 45);
    // diffA: +2 -1 (file headers skipped); diffB: +2; diffC: -2 ("---not-a-header…" is content).
    expect(stats).toEqual({
      filesChanged: 3,
      additions: 4,
      deletions: 3,
      firstCommitAt: "2026-10-01T09:00:00.000+00:00",
    });
    expect(Object.keys(stats).sort()).toEqual(
      ["additions", "deletions", "filesChanged", "firstCommitAt"].sort(),
    );
    const serialized = JSON.stringify(stats);
    expect(serialized).not.toContain("SECRET_LINE");
    expect(serialized).not.toContain("@@");
  });

  it("returns null firstCommitAt with no commits", async () => {
    const base = "/api/v4/projects/777/merge_requests/46";
    routes[`${base}/diffs`] = { body: [] };
    routes[`${base}/commits`] = { body: [] };
    expect(await getMergeRequestStats(777, 46)).toEqual({
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      firstCommitAt: null,
    });
  });
});

describe("read-only guard", () => {
  it("client.ts names no write HTTP method", () => {
    const path = fileURLToPath(new URL("../src/lib/gitlab/client.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/["'`](post|put|patch|delete)["'`]/i);
    const methods = [...source.matchAll(/method\s*:\s*([^,}\s]+)/gi)].map((m) => m[1]);
    expect(methods.every((m) => /^["'`]GET["'`]$/.test(m))).toBe(true);
  });
});
