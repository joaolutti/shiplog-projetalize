/**
 * Follow-ups for NextSteps (docs/ARCHITECTURE.md §2, step 5): queued inside the transaction
 * that produced them, so a state change never commits without its jobs, nor the jobs without
 * it. Every job is idempotent per shipment and purpose, so a retry or a repeated step never
 * posts twice.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { shipments } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { JOBS, type ShipmentJob, type TimerJob } from "@/worker/jobs";
import type { Tx } from "./commands";
import type { NextStep } from "./next-step";

const HOUR = 60 * 60 * 1000;

// Runs a command and queues its follow-ups in one transaction.
export function execute(command: (tx: Tx) => Promise<NextStep>): Promise<NextStep> {
  return db().transaction(async (tx) => {
    const step = await command(tx);
    await dispatch(tx, [step]);
    return step;
  });
}

export async function dispatch(tx: Tx, steps: NextStep[]): Promise<void> {
  for (const step of steps) {
    if (step.kind === "noop") continue;
    const job: ShipmentJob = { shipmentId: step.shipmentId };

    switch (step.kind) {
      case "unclaimed":
        await enqueue(JOBS.notifyLeadsUnclaimed, job, {}, tx);
        break;
      case "nudge_missing_branch":
      case "nudge_open_mrs":
      case "held":
      case "refresh":
        await enqueue(JOBS.syncRecipientDm, job, {}, tx);
        break;
      case "send_draft":
        await enqueue(JOBS.syncRecipientDm, job, {}, tx);
        await scheduleTimers(tx, step.shipmentId);
        break;
      case "published":
        await enqueue(JOBS.publishShipment, job, {}, tx);
        break;
      case "verification_changed":
        await enqueue(JOBS.syncRequesterDm, job, {}, tx);
        break;
      case "comment_added":
        await enqueue(JOBS.notifyComment, { ...job, commentId: step.commentId }, {}, tx);
        break;
      case "issue_reported":
        await enqueue(JOBS.syncRequesterDm, job, {}, tx);
        await enqueue(JOBS.notifyIssueReported, { ...job, commentId: step.commentId }, {}, tx);
        break;
      case "reverification_requested":
        await enqueue(JOBS.requestReverification, job, {}, tx);
        break;
    }
  }
}

// Reminder and auto-publish for the shipment's current draft cycle (D8).
async function scheduleTimers(tx: Tx, shipmentId: number): Promise<void> {
  const [row] = await tx.select({ pendingSince: shipments.pendingSince }).from(shipments).where(eq(shipments.id, shipmentId));
  if (!row?.pendingSince) return;
  const start = row.pendingSince.getTime();
  const cycle = row.pendingSince.toISOString();
  const timer: TimerJob = { shipmentId, cycle };

  await enqueue(JOBS.sendReminder, timer, {
    startAfter: new Date(start + env("REMINDER_AFTER_HOURS") * HOUR),
    singletonKey: `${shipmentId}:${cycle}`,
  }, tx);
  await enqueue(JOBS.autoPublish, timer, {
    startAfter: new Date(start + env("AUTO_PUBLISH_AFTER_HOURS") * HOUR),
    singletonKey: `${shipmentId}:${cycle}`,
  }, tx);
}
