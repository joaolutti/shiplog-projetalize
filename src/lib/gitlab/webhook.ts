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
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabEvents } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { JOBS } from "@/worker/jobs";

export type GitlabEventType = "Issue Hook" | "Merge Request Hook";

// Event types Shiplog stores. Confidential issues arrive as their own hook type.
const HANDLED: Record<string, GitlabEventType> = {
  "Issue Hook": "Issue Hook",
  "Confidential Issue Hook": "Issue Hook",
  "Merge Request Hook": "Merge Request Hook",
};

export function handledEventType(header: string | null): GitlabEventType | null {
  return (header && HANDLED[header]) || null;
}

export function verifyWebhookToken(headerValue: string | null): boolean {
  if (!headerValue) return false;
  // Hash both sides so the compare is constant-time regardless of length.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(headerValue), digest(env("GITLAB_WEBHOOK_SECRET")));
}

/**
 * Insert into gitlab_events (ignore duplicates) and enqueue `ingest-gitlab-event`.
 * A redelivery of an event that was stored but never processed is enqueued again, so a
 * failed enqueue (the route then returns 500 and GitLab retries) can't lose an event.
 */
export async function storeAndEnqueue(args: {
  eventUuid: string;
  eventType: GitlabEventType;
  payload: unknown;
}): Promise<{ duplicate: boolean; eventId: number | null }> {
  const [inserted] = await db()
    .insert(gitlabEvents)
    .values({ eventUuid: args.eventUuid, eventType: args.eventType, payload: args.payload })
    .onConflictDoNothing({ target: gitlabEvents.eventUuid })
    .returning({ id: gitlabEvents.id });

  if (inserted) {
    await enqueue(JOBS.ingestGitlabEvent, { eventId: inserted.id });
    return { duplicate: false, eventId: inserted.id };
  }

  const [existing] = await db()
    .select({ id: gitlabEvents.id, processedAt: gitlabEvents.processedAt })
    .from(gitlabEvents)
    .where(eq(gitlabEvents.eventUuid, args.eventUuid));
  if (existing && !existing.processedAt) {
    await enqueue(JOBS.ingestGitlabEvent, { eventId: existing.id });
  }
  return { duplicate: true, eventId: existing?.id ?? null };
}
