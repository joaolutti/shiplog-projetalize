/**
 * Background worker (Render "worker" service): `bun run worker`.
 * Runs pg-boss on the app database; registers one handler per queue in ./jobs.
 */
import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import type { InteractionPayload } from "@/lib/slack/interactions";
import { handleInteraction } from "@/lib/slack/interactions";
import { handleIngestGitlabEvent, type IngestGitlabEventJob } from "./handlers/ingest-gitlab-event";
import {
  notifyComment,
  notifyIssueReported,
  notifyLeadsUnclaimed,
  publishShipment,
  runAutoPublish,
  sendReminder,
  syncRecipientDm,
  syncRequesterDm,
} from "./handlers/shipment-messages";
import { JOBS, type ShipmentJob, type TimerJob } from "./jobs";

async function main() {
  const boss = new PgBoss(env("DATABASE_URL"));
  boss.on("error", (err) => console.error("[worker] pg-boss error", err));
  await boss.start();

  for (const name of Object.values(JOBS)) {
    // Retries with backoff; GitLab and Slack hiccups shouldn't lose work.
    await boss.createQueue(name, { retryLimit: 5, retryBackoff: true, retryDelay: 10 });
  }

  // Runs a handler for each job in the batch.
  const each =
    <T extends object>(handler: (data: T) => Promise<unknown>) =>
    async (jobs: Array<{ data: T }>) => {
      for (const job of jobs) await handler(job.data);
    };

  await boss.work<IngestGitlabEventJob>(JOBS.ingestGitlabEvent, each(handleIngestGitlabEvent));
  await boss.work<ShipmentJob>(JOBS.syncRecipientDm, each(syncRecipientDm));
  await boss.work<ShipmentJob>(JOBS.notifyLeadsUnclaimed, each(notifyLeadsUnclaimed));
  await boss.work<TimerJob>(JOBS.sendReminder, each(sendReminder));
  await boss.work<TimerJob>(JOBS.autoPublish, each(runAutoPublish));
  await boss.work<ShipmentJob>(JOBS.publishShipment, each(publishShipment));
  await boss.work<ShipmentJob>(JOBS.syncRequesterDm, each(syncRequesterDm));
  await boss.work<ShipmentJob & { commentId: number }>(JOBS.notifyIssueReported, each(notifyIssueReported));
  await boss.work<ShipmentJob & { commentId: number }>(JOBS.notifyComment, each(notifyComment));
  await boss.work<{ payload: InteractionPayload }>(
    JOBS.handleSlackInteraction,
    each(({ payload }: { payload: InteractionPayload }) => handleInteraction(payload)),
  );
  // TODO: refresh-merge-requests, request-reverification (M4), review-weight (v1.5).

  console.log(`[worker] started; queues: ${Object.values(JOBS).join(", ")}`);

  const stop = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
