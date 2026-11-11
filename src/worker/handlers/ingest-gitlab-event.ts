/**
 * Job `ingest-gitlab-event` (docs/ARCHITECTURE.md §4 step 2): load the stored event, run
 * ingest, record the outcome on gitlab_events. A failure is recorded and rethrown so
 * pg-boss retries it.
 *
 * Ingest queues the Slack jobs for the NextStep[] in its own transaction (effects.ts), so a
 * failure here retries the whole event and loses nothing.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gitlabEvents } from "@/lib/db/schema";
import { ingestGitlabEvent, type NextStep } from "@/lib/shipments/ingest";

export interface IngestGitlabEventJob {
  eventId: number;
}

export async function handleIngestGitlabEvent(
  { eventId }: IngestGitlabEventJob,
  { force = false }: { force?: boolean } = {},
): Promise<NextStep[]> {
  const [event] = await db()
    .select({ processedAt: gitlabEvents.processedAt })
    .from(gitlabEvents)
    .where(eq(gitlabEvents.id, eventId));
  if (!event) return [{ kind: "noop", reason: `event ${eventId} not found` }];
  if (event.processedAt && !force) return [{ kind: "noop", reason: `event ${eventId} already processed` }];

  try {
    const steps = await ingestGitlabEvent(eventId);
    await db()
      .update(gitlabEvents)
      .set({ processedAt: new Date(), error: null })
      .where(eq(gitlabEvents.id, eventId));
    for (const step of steps) console.log(`[ingest] event ${eventId}:`, JSON.stringify(step));
    return steps;
  } catch (err) {
    await db()
      .update(gitlabEvents)
      .set({ error: err instanceof Error ? (err.stack ?? err.message) : String(err) })
      .where(eq(gitlabEvents.id, eventId));
    throw err;
  }
}
