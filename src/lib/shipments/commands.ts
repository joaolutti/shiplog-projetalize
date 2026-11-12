/**
 * The only place shipment state changes (D39, docs/ARCHITECTURE.md §2). Server actions,
 * Slack handlers and the worker all call these.
 *
 * Each command: authorize → load the shipment FOR UPDATE → transition (state.ts) →
 * persist the change plus a timeline entry → return the follow-up step. Commands run
 * inside the caller's transaction; the caller queues the follow-up jobs in that
 * same transaction (effects.ts `execute` / `dispatch`).
 *
 * M1: what ingest needs. M3: everything the Slack messages trigger (gates, draft,
 * verification). M4: unverify, requestReverification. The weight review comes later.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db/client";
import {
  comments,
  shipmentMergeRequests,
  shipments,
  tickets,
  verifications,
  type TimelineEntry,
} from "@/lib/db/schema";
import { nextStepFor, weightMismatch, type NextStep } from "./next-step";
import type { Recipient } from "./recipient";
import { transition, type GateContext, type ShipmentEvent } from "./state";

export type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type Actor = { kind: "system" } | { kind: "user"; userId: string; role: "member" | "dev" | "lead" };

type Shipment = typeof shipments.$inferSelect;

export class CommandError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

// System, leads, and the shipment's recipient may answer its gates.
function authorizeGateAnswer(actor: Actor, shipment: Shipment): void {
  if (actor.kind === "system" || actor.role === "lead") return;
  if (actor.userId === shipment.recipientUserId) return;
  throw new CommandError("forbidden", `user ${actor.userId} can't act on shipment ${shipment.id}`);
}

async function loadForUpdate(tx: Tx, shipmentId: number): Promise<Shipment> {
  const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
  if (!shipment) throw new CommandError("not_found", `shipment ${shipmentId} not found`);
  return shipment;
}

// Open related MRs on the shipment's snapshot. Closed-without-merge MRs don't block.
async function openMrIds(tx: Tx, shipmentId: number): Promise<number[]> {
  const rows = await tx
    .select({ id: shipmentMergeRequests.gitlabMrId, state: shipmentMergeRequests.state })
    .from(shipmentMergeRequests)
    .where(eq(shipmentMergeRequests.shipmentId, shipmentId));
  return rows.filter((r) => r.state === "opened" || r.state === "locked").map((r) => r.id);
}

async function stepFor(tx: Tx, shipment: Shipment): Promise<NextStep> {
  const [ticket] = await tx
    .select({ nativeWeight: tickets.nativeWeight, labelWeight: tickets.labelWeight })
    .from(tickets)
    .where(eq(tickets.id, shipment.ticketId));
  return nextStepFor(shipment.id, shipment.status, {
    openMrIds: await openMrIds(tx, shipment.id),
    weightMismatch: weightMismatch(ticket?.nativeWeight ?? null, ticket?.labelWeight ?? null),
  });
}

export function timelineEntry(event: string, data?: Record<string, unknown>): TimelineEntry {
  return data ? { at: new Date().toISOString(), event, data } : { at: new Date().toISOString(), event };
}

// Runs `event` on a locked shipment; an invalid transition becomes a noop step, not a throw.
async function apply(
  tx: Tx,
  shipment: Shipment,
  event: ShipmentEvent,
  changes: Partial<Shipment> & Pick<GateContext, "branch">,
  data?: Record<string, unknown>,
): Promise<NextStep> {
  const open = await openMrIds(tx, shipment.id);
  const result = transition(shipment.status, event, {
    branch: changes.branch,
    openMrCount: open.length,
  });
  if (!result.ok) {
    return { kind: "noop", reason: `shipment ${shipment.id}: ${event} rejected (${result.error.code})` };
  }

  const [updated] = await tx
    .update(shipments)
    .set({
      ...changes,
      status: result.status,
      ...(result.publishedVia ? { publishedVia: result.publishedVia, publishedAt: new Date() } : {}),
      // A new draft cycle: the reminder and auto-publish jobs are keyed by it.
      ...(result.status === "pending_confirmation" && shipment.status !== "pending_confirmation"
        ? { pendingSince: new Date(), reminderSentAt: null }
        : {}),
      timeline: [
        ...shipment.timeline,
        timelineEntry(event, { from: shipment.status, to: result.status, ...data }),
      ],
    })
    .where(eq(shipments.id, shipment.id))
    .returning();
  return stepFor(tx, updated);
}

/**
 * Answers the branch gate. If the ticket already has a shipment for that branch, the
 * branchless row merges into it (its timeline is kept there) and is deleted.
 */
export async function pickBranch(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; branch: string },
): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  if (shipment.branch !== null) {
    return { kind: "noop", reason: `shipment ${shipment.id} already has branch ${shipment.branch}` };
  }

  const [existing] = await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.ticketId, shipment.ticketId), eq(shipments.branch, args.branch)))
    .for("update");
  if (existing) {
    await tx
      .update(shipments)
      .set({
        timeline: [
          ...existing.timeline,
          timelineEntry("merged_branchless_shipment", { shipmentId: shipment.id, timeline: shipment.timeline }),
        ],
      })
      .where(eq(shipments.id, existing.id));
    await tx.delete(shipments).where(eq(shipments.id, shipment.id));
    return { kind: "noop", reason: `shipment ${shipment.id} merged into ${existing.id} (${args.branch})` };
  }

  return apply(
    tx,
    shipment,
    "pick_branch",
    { branch: args.branch },
    { branch: args.branch },
  );
}

// MR Hook: all related MRs merged (or closed) → the held shipment moves on to the draft.
export async function releaseHeld(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (args.actor.kind !== "system") {
    throw new CommandError("forbidden", "releaseHeld is triggered by GitLab events only");
  }
  return apply(tx, shipment, "release_held", gateCtx(shipment));
}

/**
 * D7 re-ship: the ticket was marked Done again on a branch that already published. The same
 * row starts a new draft cycle; previous notes and verifications move into the timeline.
 */
export async function reship(
  tx: Tx,
  args: {
    actor: Actor;
    shipmentId: number;
    recipient: Recipient;
    notesDraft: string | null;
  },
): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (args.actor.kind !== "system") {
    throw new CommandError("forbidden", "reship is triggered by GitLab events only");
  }
  if (shipment.status !== "published") {
    return { kind: "noop", reason: `shipment ${shipment.id} is already in progress (${shipment.status})` };
  }

  const previousVerifications = await tx
    .select({ userId: verifications.userId, kind: verifications.kind, at: verifications.updatedAt })
    .from(verifications)
    .where(eq(verifications.shipmentId, shipment.id));

  const step = await apply(
    tx,
    shipment,
    "reship",
    {
      branch: shipment.branch,
      recipientUserId: args.recipient.userId,
      recipientGitlabId: args.recipient.gitlabId,
      notesDraft: args.notesDraft,
      notesFinal: null,
      publishedVia: null,
      publishedAt: null,
      verificationStatus: "unverified",
      dmChannelId: null,
      dmMessageTs: null,
      feedMessageTs: null,
      reminderSentAt: null,
    },
    {
      previous: {
        notesFinal: shipment.notesFinal,
        publishedVia: shipment.publishedVia,
        publishedAt: shipment.publishedAt?.toISOString() ?? null,
        verificationStatus: shipment.verificationStatus,
        verifications: previousVerifications.map((v) => ({ ...v, at: v.at.toISOString() })),
      },
    },
  );
  await tx.delete(verifications).where(eq(verifications.shipmentId, shipment.id));
  return step;
}

// Adds a timeline entry to every shipment of a ticket (e.g. the issue was reopened).
export async function noteOnTicketShipments(tx: Tx, ticketId: number, entry: TimelineEntry): Promise<void> {
  await tx
    .update(shipments)
    .set({ timeline: sql`${shipments.timeline} || ${JSON.stringify([entry])}::jsonb` })
    .where(eq(shipments.ticketId, ticketId));
}

// The branchless (needs_branch) shipment of a ticket, locked, if any.
export async function findBranchless(tx: Tx, ticketId: number): Promise<Shipment | undefined> {
  const [row] = await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.ticketId, ticketId), isNull(shipments.branch)))
    .for("update");
  return row;
}

const actorId = (actor: Actor) => (actor.kind === "user" ? actor.userId : "system");

// ── M3: recipient DM ─────────────────────────────────────────────────

// "Aguardar o merge": released by the MR Hook once nothing is open (releaseHeld).
export async function holdUntilMerged(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  return apply(tx, shipment, "hold_until_merged", gateCtx(shipment), { by: actorId(args.actor) });
}

// "Publicar mesmo assim": skips the open-MR gate and goes to the draft.
export async function publishAnyway(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  return apply(tx, shipment, "publish_anyway", gateCtx(shipment), { by: actorId(args.actor) });
}

// "Confirmar e publicar": the notes as they stand become final.
export async function confirm(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  return apply(
    tx,
    shipment,
    "confirm",
    { ...gateCtx(shipment), notesFinal: shipment.notesFinal ?? shipment.notesDraft },
    { by: actorId(args.actor) },
  );
}

/**
 * Timer: AUTO_PUBLISH_AFTER_HOURS without an answer (D8). Only for the draft cycle the job was
 * scheduled for, so a confirm, a re-ship or a reopen in between cancels it.
 */
export async function autoPublish(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; cycle: string },
): Promise<NextStep> {
  if (args.actor.kind !== "system") throw new CommandError("forbidden", "autoPublish is a timer");
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (shipment.pendingSince?.toISOString() !== args.cycle) {
    return { kind: "noop", reason: `shipment ${shipment.id}: draft cycle ${args.cycle} is over` };
  }
  return apply(tx, shipment, "auto_publish", { ...gateCtx(shipment), notesFinal: shipment.notesFinal ?? shipment.notesDraft });
}

// "Editar notas": what the dev writes replaces the draft; after publishing it updates the card.
export async function editNotes(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; notes: string },
): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  const notes = args.notes.trim();
  await tx
    .update(shipments)
    .set({
      notesFinal: notes || null,
      timeline: [...shipment.timeline, timelineEntry("notes_edited", { by: actorId(args.actor), previous: shipment.notesFinal ?? shipment.notesDraft })],
    })
    .where(eq(shipments.id, shipment.id));
  return { kind: "refresh", shipmentId: shipment.id };
}

// The dev picks the requester when the Solicitante name didn't match one Slack user.
export async function pickRequester(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; slackUserId: string },
): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  await tx
    .update(tickets)
    .set({ requesterSlackId: args.slackUserId, requesterSource: "dev_picked", updatedAt: new Date() })
    .where(eq(tickets.id, shipment.ticketId));
  await tx
    .update(shipments)
    .set({ timeline: [...shipment.timeline, timelineEntry("requester_picked", { by: actorId(args.actor), slackUserId: args.slackUserId })] })
    .where(eq(shipments.id, shipment.id));
  return { kind: "refresh", shipmentId: shipment.id };
}

// A comment on the ticket's thread (D13), optionally about this shipment. Anyone signed in.
export async function addComment(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; body: string; source: "web" | "slack_dm" },
): Promise<{ step: NextStep; commentId: number }> {
  if (args.actor.kind !== "user") throw new CommandError("forbidden", "comments come from people");
  const body = args.body.trim();
  if (!body) return { step: { kind: "noop", reason: "empty comment" }, commentId: 0 };
  const shipment = await loadForUpdate(tx, args.shipmentId);
  const [comment] = await tx
    .insert(comments)
    .values({ ticketId: shipment.ticketId, shipmentId: shipment.id, authorUserId: args.actor.userId, body, source: args.source })
    .returning({ id: comments.id });
  return { step: { kind: "comment_added", shipmentId: shipment.id, commentId: comment.id }, commentId: comment.id };
}

// "Marcar no anúncio": who gets @mentioned on the channel card (the requester always is).
export async function setMentions(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; slackUserIds: string[] },
): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  const mentions = [...new Set(args.slackUserIds)].slice(0, 20);
  await tx
    .update(shipments)
    .set({
      mentionSlackIds: mentions,
      timeline: [...shipment.timeline, timelineEntry("mentions_set", { by: actorId(args.actor), mentions })],
    })
    .where(eq(shipments.id, shipment.id));
  return { kind: "refresh", shipmentId: shipment.id };
}

// ── M3: verification (D12, D41) ──────────────────────────────────────

// any issue_reported → issue_reported; else any verified → verified; else unverified.
async function recomputeVerification(tx: Tx, shipmentId: number) {
  const rows = await tx.select({ kind: verifications.kind }).from(verifications).where(eq(verifications.shipmentId, shipmentId));
  const status = rows.some((r) => r.kind === "issue_reported")
    ? "issue_reported"
    : rows.some((r) => r.kind === "verified")
      ? "verified"
      : "unverified";
  await tx.update(shipments).set({ verificationStatus: status }).where(eq(shipments.id, shipmentId));
  return status;
}

async function setVerification(
  tx: Tx,
  shipment: Shipment,
  userId: string,
  kind: "verified" | "issue_reported",
  commentId: number | null,
): Promise<void> {
  const [previous] = await tx
    .select({ kind: verifications.kind })
    .from(verifications)
    .where(and(eq(verifications.shipmentId, shipment.id), eq(verifications.userId, userId)));
  await tx
    .insert(verifications)
    .values({ shipmentId: shipment.id, userId, kind, commentId })
    .onConflictDoUpdate({
      target: [verifications.shipmentId, verifications.userId],
      set: { kind, commentId, updatedAt: new Date() },
    });
  const status = await recomputeVerification(tx, shipment.id);
  await tx
    .update(shipments)
    .set({
      timeline: [...shipment.timeline, timelineEntry(kind, { by: userId, previous: previous?.kind ?? null, verificationStatus: status })],
    })
    .where(eq(shipments.id, shipment.id));
}

// Anyone verifies a published shipment; a reporter can change their own row back (D41).
export async function verify(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  if (args.actor.kind !== "user") throw new CommandError("forbidden", "verification comes from people");
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (shipment.status !== "published") return { kind: "noop", reason: `shipment ${shipment.id} isn't published` };
  await setVerification(tx, shipment, args.actor.userId, "verified", null);
  return { kind: "verification_changed", shipmentId: shipment.id };
}

// Anyone reports a problem: a thread comment plus their verification row; the dev is DMed.
export async function reportIssue(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; comment: string; source: "web" | "slack_dm" },
): Promise<NextStep> {
  if (args.actor.kind !== "user") throw new CommandError("forbidden", "reports come from people");
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (shipment.status !== "published") return { kind: "noop", reason: `shipment ${shipment.id} isn't published` };
  const body = args.comment.trim() || "(sem descrição)";
  const [comment] = await tx
    .insert(comments)
    .values({ ticketId: shipment.ticketId, shipmentId: shipment.id, authorUserId: args.actor.userId, body, source: args.source })
    .returning({ id: comments.id });
  await setVerification(tx, shipment, args.actor.userId, "issue_reported", comment.id);
  return { kind: "issue_reported", shipmentId: shipment.id, commentId: comment.id };
}

// "Você verificou · desfazer": the actor removes their own verification row.
export async function unverify(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  if (args.actor.kind !== "user") throw new CommandError("forbidden", "verification comes from people");
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (shipment.status !== "published") return { kind: "noop", reason: `shipment ${shipment.id} isn't published` };
  const [removed] = await tx
    .delete(verifications)
    .where(and(eq(verifications.shipmentId, shipment.id), eq(verifications.userId, args.actor.userId)))
    .returning({ kind: verifications.kind });
  if (!removed) return { kind: "noop", reason: `shipment ${shipment.id}: ${args.actor.userId} hasn't verified` };
  const status = await recomputeVerification(tx, shipment.id);
  await tx
    .update(shipments)
    .set({
      timeline: [...shipment.timeline, timelineEntry("unverified", { by: args.actor.userId, previous: removed.kind, verificationStatus: status })],
    })
    .where(eq(shipments.id, shipment.id));
  return { kind: "verification_changed", shipmentId: shipment.id };
}

const REVERIFY_EVERY_MS = 60 * 60 * 1000;

// "Pedir nova verificação" (D41): the recipient or a lead asks the reporters to check again, once an hour.
export async function requestReverification(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  if (args.actor.kind !== "user") throw new CommandError("forbidden", "reverification is asked by people");
  const shipment = await loadForUpdate(tx, args.shipmentId);
  authorizeGateAnswer(args.actor, shipment);
  if (shipment.verificationStatus !== "issue_reported") {
    return { kind: "noop", reason: `shipment ${shipment.id} has no reported issue` };
  }
  const now = new Date();
  const last = shipment.lastReverifyRequestedAt;
  if (last && now.getTime() - last.getTime() < REVERIFY_EVERY_MS) {
    return { kind: "noop", reason: `shipment ${shipment.id}: reverification already asked at ${last.toISOString()}` };
  }
  const [comment] = await tx
    .insert(comments)
    .values({
      ticketId: shipment.ticketId,
      shipmentId: shipment.id,
      authorUserId: args.actor.userId,
      body: "Pediu nova verificação a quem relatou problema.",
      source: "web",
    })
    .returning({ id: comments.id });
  await tx
    .update(shipments)
    .set({
      lastReverifyRequestedAt: now,
      timeline: [...shipment.timeline, timelineEntry("reverification_requested", { by: args.actor.userId, commentId: comment.id })],
    })
    .where(eq(shipments.id, shipment.id));
  return { kind: "reverification_requested", shipmentId: shipment.id, commentId: comment.id };
}

const gateCtx = (shipment: Shipment) => ({ branch: shipment.branch });
