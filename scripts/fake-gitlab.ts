/**
 * Local stand-in for the GitLab API, for running the ingest flow end to end without a
 * real token. Serves the issue and MR from tests/fixtures/webhooks (issue 412 in
 * project 777, MR !45). GET only, like the real client.
 *
 *   FAKE_MR_STATE=opened bun run scripts/fake-gitlab.ts     # default port 4010
 *   GITLAB_BASE_URL=http://localhost:4010 GITLAB_API_TOKEN=fake bun run worker
 */
import { createServer } from "node:http";
import issueHook from "../tests/fixtures/webhooks/issue-done.json";

const port = Number(process.env.FAKE_GITLAB_PORT ?? 4010);
const mrState = process.env.FAKE_MR_STATE ?? "merged";
const a = issueHook.object_attributes;

const issue = {
  id: a.id,
  iid: a.iid,
  project_id: a.project_id,
  title: a.title,
  description: a.description,
  web_url: a.url,
  labels: issueHook.labels.map((l) => l.title),
  weight: a.weight,
  assignees: issueHook.assignees.map((u) => ({ id: u.id })),
  state: a.state,
};

const mergeRequest = {
  id: 5045,
  iid: 45,
  project_id: 777,
  title: "Corrige login SSO",
  description: "## Notas de entrega\nCorrige o login com SSO para clientes enterprise.",
  web_url: "https://gitlab.com/acme/billing-svc/-/merge_requests/45",
  state: mrState,
  author: { id: 11 },
  target_branch: "staging",
  merged_at: mrState === "merged" ? "2026-11-10T12:00:00.000Z" : null,
  references: { full: "acme/billing-svc!45" },
};

const routes: Record<string, unknown> = {
  [`/api/v4/projects/777/issues/${a.iid}`]: issue,
  [`/api/v4/projects/777/issues/${a.iid}/related_merge_requests`]: [mergeRequest],
  "/api/v4/projects/777/merge_requests/45/diffs": [
    { new_path: "src/sso.ts", diff: "@@ -1,2 +1,3 @@\n-old\n+new\n+more\n" },
  ],
  "/api/v4/projects/777/merge_requests/45/commits": [{ created_at: "2026-11-08T09:00:00.000Z" }],
};

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  console.log(`[fake-gitlab] ${req.method} ${path}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "x-next-page": "" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET") return send(405, { message: "read-only" });
  if (!(path in routes)) return send(404, { message: "404 Not Found" });
  send(200, routes[path]);
}).listen(port, () => {
  console.log(`[fake-gitlab] listening on http://localhost:${port} (MR state: ${mrState})`);
});
