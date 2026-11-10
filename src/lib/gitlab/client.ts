/**
 * Read-only GitLab API client (group access token, `read_api`).
 * Shiplog never writes to GitLab, so keep this surface GET-only.
 */
import { notImplemented } from "@/lib/not-implemented";

export interface RelatedMergeRequest {
  id: number;
  iid: number;
  projectId: number;
  projectPath: string;
  title: string;
  webUrl: string;
  state: "opened" | "merged" | "closed" | "locked";
  authorId: number;
  targetBranch: string;
  mergedAt: string | null;
}

/** GET /projects/:id/issues/:iid/related_merge_requests: cross-project. */
export async function getRelatedMergeRequests(
  _projectId: number,
  _issueIid: number,
): Promise<RelatedMergeRequest[]> {
  return notImplemented("getRelatedMergeRequests", "M1");
}

/** Per-file stats only; diffs are fetched separately and only when policy allows (v1.5). */
export async function getMergeRequestStats(
  _projectId: number,
  _mrIid: number,
): Promise<{ filesChanged: number; additions: number; deletions: number; firstCommitAt: string | null }> {
  return notImplemented("getMergeRequestStats", "M1");
}

/** Raw diff hunks, held in memory only. Callers must apply data policy + redaction. */
export async function getMergeRequestDiffs(
  _projectId: number,
  _mrIid: number,
): Promise<Array<{ path: string; diff: string }>> {
  return notImplemented("getMergeRequestDiffs", "v1.5");
}
