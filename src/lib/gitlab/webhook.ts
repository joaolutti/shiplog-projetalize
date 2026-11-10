/**
 * GitLab group webhook (Issue Hook + Merge Request Hook).
 *
 * Headers used:
 *   X-Gitlab-Token       shared secret (constant-time compare against GITLAB_WEBHOOK_SECRET)
 *   X-Gitlab-Event       "Issue Hook" | "Merge Request Hook" | …
 *   X-Gitlab-Event-UUID  dedupe key → gitlab_events.event_uuid
 *
 * GitLab disables hooks that keep failing or timing out, so the route only verifies,
 * stores and enqueues. All work happens in the worker.
 */
import { notImplemented } from "@/lib/not-implemented";

export type GitlabEventType = "Issue Hook" | "Merge Request Hook";

export function verifyWebhookToken(_headerValue: string | null): boolean {
  return notImplemented("verifyWebhookToken", "M1");
}

/** Insert into gitlab_events (ignore duplicates) and enqueue `ingest-gitlab-event`. */
export async function storeAndEnqueue(_args: {
  eventUuid: string;
  eventType: string;
  payload: unknown;
}): Promise<{ duplicate: boolean }> {
  return notImplemented("storeAndEnqueue", "M1");
}
