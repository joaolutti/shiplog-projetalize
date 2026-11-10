/**
 * Re-runs ingest for a stored GitLab event without GitLab redelivering it, and prints
 * the NextStep[]. Useful after a fix, or to inspect what an event does.
 *
 *   bun run scripts/replay-event.ts <gitlab_events.id>
 */
import { handleIngestGitlabEvent } from "@/worker/handlers/ingest-gitlab-event";

const eventId = Number(process.argv[2]);
if (!Number.isInteger(eventId) || eventId <= 0) {
  console.error("usage: bun run scripts/replay-event.ts <gitlab_events.id>");
  process.exit(1);
}

try {
  const steps = await handleIngestGitlabEvent({ eventId }, { force: true });
  console.log(JSON.stringify(steps, null, 2));
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
