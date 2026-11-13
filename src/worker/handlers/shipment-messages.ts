/**
 * Jobs that keep the Slack messages in step with shipments (M3). Each one re-reads the
 * shipment and does nothing if the state moved on, so retries and duplicates are harmless.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { comments, shipments, tickets, user, verifications } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { parseRequester } from "@/lib/gitlab/templates";
import { autoPublish } from "@/lib/shipments/commands";
import { execute } from "@/lib/shipments/effects";
import { loadShipment, slackIdOf, usersBySlackId } from "@/lib/shipments/view";
import {
  commentReply,
  feedCard,
  issueReportedDm,
  recipientDm,
  reminderReply,
  requesterDm,
  reverificationDm,
} from "@/lib/slack/blocks";
import { post, reply, sendDm, setBotReaction, update, verifiedReactions } from "@/lib/slack/client";
import { resolveRequester } from "@/lib/slack/directory";
import type { ShipmentJob, TimerJob } from "../jobs";

const log = (job: string, msg: string) => console.log(`[${job}] ${msg}`);

// The recipient's DM for the current status: posted once, then updated in place.
export async function syncRecipientDm({ shipmentId }: ShipmentJob): Promise<void> {
  const s = await loadShipment(shipmentId);
  if (!s?.recipientUserId) return log("sync-recipient-dm", `${shipmentId}: no recipient`);

  if (s.view.status === "pending_confirmation") await resolveTicketRequester(s.ticketId);
  const fresh = (await loadShipment(shipmentId))!;

  const message = recipientDm(fresh.view, {
    branchChoices: env("BRANCH_CHOICES").split(",").map((b) => b.trim()).filter(Boolean),
    autoPublishHours: env("AUTO_PUBLISH_AFTER_HOURS"),
  });

  if (fresh.dm) return update(fresh.dm, message);

  const slackId = await slackIdOf(fresh.recipientUserId!);
  if (!slackId) return log("sync-recipient-dm", `${shipmentId}: recipient hasn't signed in with Slack`);
  const ref = await sendDm(slackId, message);
  await db().update(shipments).set({ dmChannelId: ref.channel, dmMessageTs: ref.ts }).where(eq(shipments.id, shipmentId));
}

/**
 * Matches the issue's Solicitante against the Slack directory once, when the draft goes out.
 * A requester the dev picked is never overwritten.
 */
async function resolveTicketRequester(ticketId: number): Promise<void> {
  const [t] = await db().select().from(tickets).where(eq(tickets.id, ticketId));
  if (!t?.requesterRaw || t.requesterSlackId) return;
  const ref = parseRequester(`Solicitante: ${t.requesterRaw}`);
  if (!ref) return;
  const match = await resolveRequester(ref);
  if (match.kind !== "found") return log("requester", `ticket ${ticketId}: "${t.requesterRaw}" ${match.kind}`);
  await db()
    .update(tickets)
    .set({ requesterSlackId: match.slackUserId, requesterSource: "template" })
    .where(and(eq(tickets.id, ticketId), eq(tickets.requesterSource, "none")));
}

// One reminder in the draft's thread, if this draft cycle is still waiting (D8).
export async function sendReminder({ shipmentId, cycle }: TimerJob): Promise<void> {
  const s = await loadShipment(shipmentId);
  if (!s || s.view.status !== "pending_confirmation" || s.pendingSince?.toISOString() !== cycle) return;
  if (s.reminderSentAt || !s.dm) return;
  // The reminder may have waited for business hours, so count from now.
  const publishAt = s.pendingSince!.getTime() + env("AUTO_PUBLISH_AFTER_HOURS") * 3_600_000;
  const hoursLeft = Math.max(1, Math.round((publishAt - Date.now()) / 3_600_000));
  await reply(s.dm, reminderReply(s.view, hoursLeft));
  await db().update(shipments).set({ reminderSentAt: new Date() }).where(eq(shipments.id, shipmentId));
}

// Publishes an unanswered draft as is, flagged "notas não confirmadas" (D8).
export async function runAutoPublish({ shipmentId, cycle }: TimerJob): Promise<void> {
  const step = await execute((tx) => autoPublish(tx, { actor: { kind: "system" }, shipmentId, cycle }));
  log("auto-publish", `${shipmentId}: ${JSON.stringify(step)}`);
}

// Channel card (D9), then the recipient's DM shows "publicada" and the requester is DMed (D11).
export async function publishShipment({ shipmentId }: ShipmentJob): Promise<void> {
  const loaded = await loadShipment(shipmentId);
  if (!loaded || loaded.view.status !== "published") return;
  // Usually matched when the draft went out; this retries a miss.
  await resolveTicketRequester(loaded.ticketId);
  const s = (await loadShipment(shipmentId))!;

  const channel = env("SLACK_FEED_CHANNEL_ID");
  const card = feedCard(s.view);
  if (s.feed) {
    await update({ channel, ts: s.feed }, card);
  } else {
    const ref = await post(channel, card);
    await db().update(shipments).set({ feedMessageTs: ref.ts }).where(eq(shipments.id, shipmentId));
  }

  await syncRecipientDm({ shipmentId });
  await syncRequesterDm({ shipmentId });
}

// The requester's DM, reflecting their own verification, if any.
export async function syncRequesterDm({ shipmentId }: ShipmentJob): Promise<void> {
  const s = await loadShipment(shipmentId);
  if (!s || s.view.status !== "published" || s.view.requester.kind !== "resolved") return;
  const requesterSlackId = s.view.requester.slackUserId;

  const requester = (await usersBySlackId([requesterSlackId])).get(requesterSlackId);
  const [mine] = requester
    ? await db()
        .select({ kind: verifications.kind })
        .from(verifications)
        .where(and(eq(verifications.shipmentId, shipmentId), eq(verifications.userId, requester.id)))
    : [];
  const message = requesterDm(s.view, mine?.kind ?? null);

  if (s.requesterDm) return update(s.requesterDm, message);
  const ref = await sendDm(requesterSlackId, message);
  await db()
    .update(shipments)
    .set({ requesterDmChannelId: ref.channel, requesterDmTs: ref.ts })
    .where(eq(shipments.id, shipmentId));
}

// DMs the dev that someone reported a problem.
export async function notifyIssueReported({ shipmentId, commentId }: ShipmentJob & { commentId: number }): Promise<void> {
  const s = await loadShipment(shipmentId);
  if (!s) return;
  const [comment] = await db().select().from(comments).where(eq(comments.id, commentId));
  if (!comment) return;

  const reporterSlackId = await slackIdOf(comment.authorUserId);
  const message = issueReportedDm(s.view, reporterSlackId, comment.body);
  const recipientSlackId = s.recipientUserId ? await slackIdOf(s.recipientUserId) : null;
  if (!recipientSlackId) return log("notify-issue-reported", `${shipmentId}: recipient hasn't signed in with Slack`);
  await sendDm(recipientSlackId, message);
}

/**
 * Someone else's comment shows up in the thread of the recipient's DM (D13: the thread lives in
 * Shiplog). The recipient's own comments aren't echoed back to them.
 */
export async function notifyComment({ shipmentId, commentId }: ShipmentJob & { commentId: number }): Promise<void> {
  const s = await loadShipment(shipmentId);
  if (!s?.dm) return log("notify-comment", `${shipmentId}: no recipient DM to reply under`);
  const [row] = await db()
    .select({ body: comments.body, authorUserId: comments.authorUserId, authorName: user.name })
    .from(comments)
    .innerJoin(user, eq(user.id, comments.authorUserId))
    .where(eq(comments.id, commentId));
  if (!row || row.authorUserId === s.recipientUserId) return;
  await reply(s.dm, commentReply(await slackIdOf(row.authorUserId), row.authorName, row.body));
}

// "Pedir nova verificação" (D41): DMs everyone whose row is still issue_reported.
export async function requestReverification({ shipmentId }: ShipmentJob): Promise<void> {
  const s = await loadShipment(shipmentId);
  if (!s || s.view.status !== "published") return;
  const reporters = await db()
    .select({ userId: verifications.userId })
    .from(verifications)
    .where(and(eq(verifications.shipmentId, shipmentId), eq(verifications.kind, "issue_reported")));
  const message = reverificationDm(s.view);
  for (const r of reporters) {
    const slackId = await slackIdOf(r.userId);
    if (slackId) await sendDm(slackId, message);
    else log("request-reverification", `${shipmentId}: ${r.userId} hasn't signed in with Slack`);
  }
}

// The bot's ✅ on the channel card while the shipment is verified and nobody has reacted ✅ themselves (D53).
export async function syncFeedReaction({ shipmentId }: ShipmentJob): Promise<void> {
  const [s] = await db()
    .select({ status: shipments.status, verification: shipments.verificationStatus, feed: shipments.feedMessageTs })
    .from(shipments)
    .where(eq(shipments.id, shipmentId));
  if (!s?.feed || s.status !== "published") return;
  const ref = { channel: env("SLACK_FEED_CHANNEL_ID"), ts: s.feed };
  const { people, bot } = await verifiedReactions(ref);
  const want = s.verification === "verified" && !people;
  if (want !== bot) await setBotReaction(ref, want);
}
