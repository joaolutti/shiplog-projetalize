/**
 * Follow-ups for NextSteps (docs/ARCHITECTURE.md §2, step 5): call after the transaction that
 * produced them commits. Every job is idempotent per shipment and purpose, so a retry or a
 * repeated step never posts twice.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { shipments } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { JOBS, type ShipmentJob, type TimerJob } from "@/worker/jobs";
import type { NextStep } from "./next-step";

const HOUR = 60 * 60 * 1000;

export async function dispatch(steps: NextStep[]): Promise<void> {
  for (const step of steps) {
    if (step.kind === "noop") continue;
    const job: ShipmentJob = { shipmentId: step.shipmentId };

    switch (step.kind) {
      case "unclaimed":
        await enqueue(JOBS.notifyLeadsUnclaimed, job);
        break;
      case "nudge_missing_branch":
      case "nudge_open_mrs":
      case "held":
      case "refresh":
        await enqueue(JOBS.syncRecipientDm, job);
        break;
      case "send_draft":
        await enqueue(JOBS.syncRecipientDm, job);
        await scheduleTimers(step.shipmentId);
        break;
      case "published":
        await enqueue(JOBS.publishShipment, job);
        break;
      case "verification_changed":
        await enqueue(JOBS.syncRequesterDm, job);
        break;
      case "comment_added":
        await enqueue(JOBS.notifyComment, { ...job, commentId: step.commentId });
        break;
      case "issue_reported":
        await enqueue(JOBS.syncRequesterDm, job);
        await enqueue(JOBS.notifyIssueReported, { ...job, commentId: step.commentId });
        break;
    }
  }
}

/** Reminder and auto-publish for the shipment's current draft cycle (D8). */
async function scheduleTimers(shipmentId: number): Promise<void> {
  const [row] = await db().select({ pendingSince: shipments.pendingSince }).from(shipments).where(eq(shipments.id, shipmentId));
  if (!row?.pendingSince) return;
  const start = row.pendingSince.getTime();
  const cycle = row.pendingSince.toISOString();
  const timer: TimerJob = { shipmentId, cycle };

  await enqueue(JOBS.sendReminder, timer, {
    startAfter: new Date(start + env("REMINDER_AFTER_HOURS") * HOUR),
    singletonKey: `${shipmentId}:${cycle}`,
  });
  await enqueue(JOBS.autoPublish, timer, {
    startAfter: new Date(start + env("AUTO_PUBLISH_AFTER_HOURS") * HOUR),
    singletonKey: `${shipmentId}:${cycle}`,
  });
}
