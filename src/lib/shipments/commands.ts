/**
 * The only place shipment state changes (D39, docs/ARCHITECTURE.md §2). Server actions,
 * Slack handlers and the worker all call these.
 *
 * Each command: authorize → load the shipment FOR UPDATE → transition (state.ts) →
 * persist the change plus a timeline entry → return the follow-up step. Commands run
 * inside the caller's transaction; the caller queues follow-up jobs after commit.
 *
 * M1 has the commands ingest needs; M2 adds the leads' unclaimed queue (assignRecipient,
 * leadPublish). The rest (confirm, editNotes, verify, …) come in M3/M4.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db/client";
import {
  account,
  shipmentMergeRequests,
  shipments,
  tickets,
  user,
  verifications,
  type TimelineEntry,
} from "@/lib/db/schema";
import { nextStepFor, weightMismatch, type NextStep } from "./next-step";
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

/** System, leads, and the shipment's recipient may answer its gates. */
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

/** Open related MRs on the shipment's snapshot. Closed-without-merge MRs don't block. */
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

/** Runs `event` on a locked shipment; an invalid transition becomes a noop step, not a throw. */
async function apply(
  tx: Tx,
  shipment: Shipment,
  event: ShipmentEvent,
  changes: Partial<Shipment> & Pick<GateContext, "branch" | "recipientUserId">,
  data?: Record<string, unknown>,
): Promise<NextStep> {
  const open = await openMrIds(tx, shipment.id);
  const result = transition(shipment.status, event, {
    recipientUserId: changes.recipientUserId,
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
    { branch: args.branch, recipientUserId: shipment.recipientUserId },
    { branch: args.branch },
  );
}

/** MR Hook: all related MRs merged (or closed) → the held shipment moves on to the draft. */
export async function releaseHeld(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  const shipment = await loadForUpdate(tx, args.shipmentId);
  if (args.actor.kind !== "system") {
    throw new CommandError("forbidden", "releaseHeld is triggered by GitLab events only");
  }
  return apply(tx, shipment, "release_held", {
    branch: shipment.branch,
    recipientUserId: shipment.recipientUserId,
  });
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
    recipient: { userId: string | null; gitlabId: number | null };
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

/** Adds a timeline entry to every shipment of a ticket (e.g. the issue was reopened). */
export async function noteOnTicketShipments(tx: Tx, ticketId: number, entry: TimelineEntry): Promise<void> {
  await tx
    .update(shipments)
    .set({ timeline: sql`${shipments.timeline} || ${JSON.stringify([entry])}::jsonb` })
    .where(eq(shipments.ticketId, ticketId));
}

/** The branchless (needs_branch) shipment of a ticket, locked, if any. */
export async function findBranchless(tx: Tx, ticketId: number): Promise<Shipment | undefined> {
  const [row] = await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.ticketId, ticketId), isNull(shipments.branch)))
    .for("update");
  return row;
}

function requireLead(actor: Actor): void {
  if (actor.kind === "user" && actor.role === "lead") return;
  throw new CommandError("forbidden", "only leads can do this");
}

/**
 * Leads' unclaimed queue: gives an unclaimed shipment a recipient, who must be a dev or lead
 * with GitLab linked. The shipment moves on to the next gate.
 */
export async function assignRecipient(
  tx: Tx,
  args: { actor: Actor; shipmentId: number; userId: string },
): Promise<NextStep> {
  requireLead(args.actor);
  const shipment = await loadForUpdate(tx, args.shipmentId);

  const [recipient] = await tx
    .select({ role: user.role, gitlabId: account.accountId })
    .from(user)
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "gitlab")))
    .where(eq(user.id, args.userId));
  if (!recipient || recipient.role === "member") {
    throw new CommandError("forbidden", `user ${args.userId} isn't a dev or lead with GitLab linked`);
  }

  return apply(
    tx,
    shipment,
    "assign_recipient",
    { branch: shipment.branch, recipientUserId: args.userId, recipientGitlabId: Number(recipient.gitlabId) },
    { by: actorId(args.actor), recipientUserId: args.userId },
  );
}

/** Leads' unclaimed queue: publishes as is (published_via = lead). The draft notes become final. */
export async function leadPublish(tx: Tx, args: { actor: Actor; shipmentId: number }): Promise<NextStep> {
  requireLead(args.actor);
  const shipment = await loadForUpdate(tx, args.shipmentId);
  return apply(
    tx,
    shipment,
    "lead_publish",
    { branch: shipment.branch, recipientUserId: shipment.recipientUserId, notesFinal: shipment.notesDraft },
    { by: actorId(args.actor) },
  );
}

const actorId = (actor: Actor) => (actor.kind === "user" ? actor.userId : "system");
