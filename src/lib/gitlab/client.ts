/**
 * Read-only GitLab API client (group access token, `read_api`).
 * Shiplog never writes to GitLab, so keep this surface GET-only: every request goes through
 * `gitlabGet`, and tests/gitlab-client.test.ts fails if this file names a write method.
 */
import { env } from "@/lib/env";
import { notImplemented } from "@/lib/not-implemented";

type Query = Record<string, string | number | boolean | undefined>;

/** Non-2xx response from the GitLab API. */
export class GitlabApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GitLab API GET ${path} failed with ${status}`);
    this.name = "GitlabApiError";
  }
}

/** The only way this module talks to GitLab: a single GET with the API token. */
async function gitlabGet(path: string, query: Query = {}): Promise<Response> {
  const url = new URL(`${env("GITLAB_BASE_URL").replace(/\/+$/, "")}/api/v4${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    method: "GET",
    headers: { "PRIVATE-TOKEN": env("GITLAB_API_TOKEN"), Accept: "application/json" },
  });
  if (!res.ok) throw new GitlabApiError(res.status, path);
  return res;
}

/** GET a single resource as JSON. */
async function getJson<T>(path: string, query?: Query): Promise<T> {
  return (await (await gitlabGet(path, query)).json()) as T;
}

/** GET every page of a list endpoint, following `x-next-page`. */
async function getAllPages<T>(path: string, query: Query = {}): Promise<T[]> {
  const items: T[] = [];
  let page: string | null = "1";
  while (page) {
    const res = await gitlabGet(path, { ...query, per_page: 100, page });
    items.push(...((await res.json()) as T[]));
    page = res.headers.get("x-next-page") || null;
  }
  return items;
}

const enc = encodeURIComponent;

export interface GitlabIssue {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description: string | null;
  webUrl: string;
  labels: string[];
  weight: number | null;
  assigneeIds: number[];
  state: "opened" | "closed";
}

interface RawIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  web_url: string;
  labels: string[];
  weight?: number | null;
  assignees?: Array<{ id: number }>;
  state: "opened" | "closed";
}

/** GET /projects/:id/issues/:iid: always refetched, never trusting the webhook payload alone. */
export async function getIssue(projectId: number, iid: number): Promise<GitlabIssue> {
  const raw = await getJson<RawIssue>(`/projects/${enc(projectId)}/issues/${enc(iid)}`);
  return {
    id: raw.id,
    iid: raw.iid,
    projectId: raw.project_id,
    title: raw.title,
    description: raw.description ?? null,
    webUrl: raw.web_url,
    labels: raw.labels ?? [],
    weight: raw.weight ?? null,
    assigneeIds: (raw.assignees ?? []).map((a) => a.id),
    state: raw.state,
  };
}

export interface RelatedMergeRequest {
  id: number;
  iid: number;
  projectId: number;
  projectPath: string;
  title: string;
  description: string | null;
  webUrl: string;
  state: "opened" | "merged" | "closed" | "locked";
  authorId: number;
  targetBranch: string;
  mergedAt: string | null;
}

interface RawMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  web_url: string;
  state: RelatedMergeRequest["state"];
  author: { id: number };
  target_branch: string;
  merged_at: string | null;
  references: { full: string };
}

/** "group/sub/proj!45" → "group/sub/proj". */
function projectPathFromReference(full: string): string {
  const bang = full.lastIndexOf("!");
  return bang === -1 ? full : full.slice(0, bang);
}

/** GET /projects/:id/issues/:iid/related_merge_requests: cross-project. */
export async function getRelatedMergeRequests(
  projectId: number,
  issueIid: number,
): Promise<RelatedMergeRequest[]> {
  const raw = await getAllPages<RawMergeRequest>(
    `/projects/${enc(projectId)}/issues/${enc(issueIid)}/related_merge_requests`,
  );
  return raw.map((mr) => ({
    id: mr.id,
    iid: mr.iid,
    projectId: mr.project_id,
    projectPath: projectPathFromReference(mr.references.full),
    title: mr.title,
    description: mr.description ?? null,
    webUrl: mr.web_url,
    state: mr.state,
    authorId: mr.author.id,
    targetBranch: mr.target_branch,
    mergedAt: mr.merged_at ?? null,
  }));
}

export interface MergeRequestStats {
  filesChanged: number;
  additions: number;
  deletions: number;
  firstCommitAt: string | null;
}

/**
 * Counts added/removed lines of one unified diff. Only lines after the first `@@` hunk header
 * count, so `+++`/`---` file headers are skipped but content lines starting with `---` are not.
 */
function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk) continue;
    else if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/**
 * GET /merge_requests/:iid/diffs + /commits. GitLab has no line stats on MRs, so diffs are
 * counted in memory and discarded here: only the counts leave this function.
 */
export async function getMergeRequestStats(
  projectId: number,
  mrIid: number,
): Promise<MergeRequestStats> {
  const base = `/projects/${enc(projectId)}/merge_requests/${enc(mrIid)}`;
  const [diffs, commits] = await Promise.all([
    getAllPages<{ diff: string }>(`${base}/diffs`),
    getAllPages<{ created_at: string }>(`${base}/commits`),
  ]);

  let additions = 0;
  let deletions = 0;
  for (const file of diffs) {
    const counts = countDiffLines(file.diff ?? "");
    additions += counts.additions;
    deletions += counts.deletions;
  }

  let firstCommitAt: string | null = null;
  for (const c of commits) {
    if (firstCommitAt === null || Date.parse(c.created_at) < Date.parse(firstCommitAt)) {
      firstCommitAt = c.created_at;
    }
  }

  return { filesChanged: diffs.length, additions, deletions, firstCommitAt };
}

/** Raw diff hunks, held in memory only. Callers must apply data policy + redaction. */
export async function getMergeRequestDiffs(
  _projectId: number,
  _mrIid: number,
): Promise<Array<{ path: string; diff: string }>> {
  return notImplemented("getMergeRequestDiffs", "v1.5");
}
