/**
 * Turns a stored GitLab event into ticket/shipment state (SCOPE.md §4 step 2,
 * docs/ARCHITECTURE.md §4).
 *
 * Issue Hook (trigger = Done label or a trigger Status, see gitlab/trigger.ts):
 *   - became triggered   → upsert ticket, one shipment per branch (or one needs_branch
 *                          shipment when there is none); a published one re-ships (D7)
 *   - new branch         → (already triggered) new shipment for that branch, or answers
 *                          the branch gate of a needs_branch shipment. A Branch label or a
 *                          move between "Deployed <branch>" statuses
 *   - anything else      → refresh the cached ticket if we have it; reopen is noted on the
 *                          ticket's shipments
 * Merge Request Hook:
 *   - update the MR snapshot on linked shipments; release held shipments once no MR is open
 *
 * GitLab is only read here (the issue is always refetched). State changes for existing
 * shipments go through commands.ts; this module only creates new shipments. The follow-up
 * jobs are queued in the same transaction (effects.ts).
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { gitlabEvents, shipmentMergeRequests, shipments, tickets } from "@/lib/db/schema";
import {
  getIssue,
  getMergeRequestStats,
  getRelatedMergeRequests,
  type GitlabIssue,
  type MergeRequestStats,
  type RelatedMergeRequest,
} from "@/lib/gitlab/client";
import { parseLabels } from "@/lib/gitlab/labels";
import { extractHubspotUrls, parseDeliveryNotes, parseRequester } from "@/lib/gitlab/templates";
import { shipChange, shipState, triggerConfig } from "@/lib/gitlab/trigger";
import {
  findBranchless,
  noteOnTicketShipments,
  pickBranch,
  releaseHeld,
  reship,
  timelineEntry,
  type Actor,
  type Tx,
} from "./commands";
import { nextStepFor, weightMismatch, type NextStep } from "./next-step";
import { dispatch } from "./effects";
import { resolveRecipient, type Recipient } from "./recipient";
import { gateStatus } from "./state";

export type { NextStep } from "./next-step";

const SYSTEM: Actor = { kind: "system" };

// ── Payloads (only the fields Shiplog reads) ─────────────────────────

const label = z.object({ title: z.string() });
/** Work item Status. Not in the REST API, so the webhook is the only source. */
const status = z.object({ name: z.string() }).nullish();

const issueHook = z.object({
  user: z.object({ id: z.number() }).nullish(),
  project: z.object({ id: z.number(), path_with_namespace: z.string() }),
  object_attributes: z.object({
    id: z.number(),
    iid: z.number(),
    project_id: z.number(),
    action: z.string().nullish(),
    status,
  }),
  labels: z.array(label).default([]),
  changes: z
    .object({
      labels: z.object({ previous: z.array(label), current: z.array(label) }).optional(),
      status: z.object({ previous: status, current: status }).optional(),
    })
    .default({}),
});

const mergeRequestHook = z.object({
  object_attributes: z.object({
    id: z.number(),
    iid: z.number(),
    target_project_id: z.number(),
    title: z.string(),
    state: z.string(),
    action: z.string().nullish(),
    target_branch: z.string(),
  }),
});

type IssueHook = z.infer<typeof issueHook>;
type MergeRequestHook = z.infer<typeof mergeRequestHook>;

// ── Entry point ──────────────────────────────────────────────────────

export async function ingestGitlabEvent(eventId: number): Promise<NextStep[]> {
  const [event] = await db().select().from(gitlabEvents).where(eq(gitlabEvents.id, eventId));
  if (!event) return [{ kind: "noop", reason: `event ${eventId} not found` }];

  switch (event.eventType) {
    case "Issue Hook":
      return ingestIssueHook(issueHook.parse(event.payload));
    case "Merge Request Hook":
      return ingestMergeRequestHook(mergeRequestHook.parse(event.payload));
    default:
      return [{ kind: "noop", reason: `unhandled event type ${event.eventType}` }];
  }
}

// ── Issue Hook ───────────────────────────────────────────────────────

async function ingestIssueHook(p: IssueHook): Promise<NextStep[]> {
  const titles = (labels: Array<{ title: string }>) => labels.map((l) => l.title);
  const current = titles(p.changes.labels?.current ?? p.labels);
  const previous = p.changes.labels ? titles(p.changes.labels.previous) : current;

  const currentStatus = p.object_attributes.status?.name ?? null;
  const previousStatus = p.changes.status ? (p.changes.status.previous?.name ?? null) : currentStatus;

  const config = triggerConfig();
  const now = shipState(current, currentStatus, config);
  const { started, newBranches } = shipChange(shipState(previous, previousStatus, config), now);
  const { id: issueId, project_id: projectId, iid } = p.object_attributes;

  const [known] = await db()
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.gitlabIssueId, issueId));

  if (!started && newBranches.length === 0) {
    if (!known) return [{ kind: "noop", reason: `issue ${issueId}: not triggered and no new branch` }];
    const issue = await getIssue(projectId, iid);
    await db().transaction(async (tx) => {
      await upsertTicket(tx, issue, p.project.path_with_namespace, currentStatus);
      if (p.object_attributes.action === "reopen") {
        await noteOnTicketShipments(tx, known.id, timelineEntry("issue_reopened"));
      }
    });
    return [{ kind: "noop", reason: `ticket ${known.id} refreshed` }];
  }

  // Read GitLab before opening the transaction: the network calls don't hold row locks.
  const issue = await getIssue(projectId, iid);
  const mrs = await getRelatedMergeRequests(projectId, iid);
  const stats = await statsFor(mrs);
  const recipient = await resolveRecipient({
    assigneeGitlabIds: issue.assigneeIds,
    mrAuthorGitlabIds: mrs.map((mr) => mr.authorId),
    labelAppliedByGitlabId: p.user?.id ?? null,
  });

  const targets: Array<string | null> = started ? (now.branches.length ? now.branches : [null]) : newBranches;

  return db().transaction(async (tx) => {
    const ticket = await upsertTicket(tx, issue, p.project.path_with_namespace, currentStatus);
    // Serializes concurrent events for the same ticket.
    await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticket.id)).for("update");

    const steps: NextStep[] = [];
    for (const branch of targets) {
      steps.push(
        await shipToBranch(tx, {
          ticket,
          branch,
          started,
          recipient,
          mrs,
          stats,
          notesDraft: notesDraft(issue, mrs),
        }),
      );
    }
    await dispatch(tx, steps);
    return steps;
  });
}

type TicketRow = typeof tickets.$inferSelect;

async function upsertTicket(
  tx: Tx,
  issue: GitlabIssue,
  projectPath: string,
  status: string | null,
): Promise<TicketRow> {
  const requester = parseRequester(issue.description);
  const values = {
    gitlabIssueId: issue.id,
    gitlabProjectId: issue.projectId,
    projectPath,
    iid: issue.iid,
    title: issue.title,
    webUrl: issue.webUrl,
    labels: issue.labels,
    nativeWeight: issue.weight,
    labelWeight: parseLabels(issue.labels).labelWeight,
    assigneeGitlabIds: issue.assigneeIds,
    // Slack resolution of the requester happens when the draft is sent (M3).
    requesterRaw: requester ? (requester.kind === "handle" ? `@${requester.value}` : requester.value) : null,
    hubspotUrls: extractHubspotUrls(issue.description),
    gitlabState: issue.state,
    gitlabStatus: status,
  };
  const [row] = await tx
    .insert(tickets)
    .values(values)
    .onConflictDoUpdate({ target: tickets.gitlabIssueId, set: { ...values, updatedAt: new Date() } })
    .returning();
  return row;
}

/** v1 notes: each MR's "## Notas de entrega", falling back to its title; the issue title if no MRs. */
function notesDraft(issue: GitlabIssue, mrs: RelatedMergeRequest[]): string {
  const relevant = mrs.filter((mr) => mr.state !== "closed");
  if (relevant.length === 0) return issue.title;
  return relevant.map((mr) => parseDeliveryNotes(mr.description) ?? mr.title).join("\n\n");
}

/** Stats per MR id. A failure (e.g. a project the token can't read) leaves the stats empty. */
async function statsFor(mrs: RelatedMergeRequest[]): Promise<Map<number, MergeRequestStats>> {
  const entries = await Promise.all(
    mrs.map(async (mr) => {
      try {
        return [mr.id, await getMergeRequestStats(mr.projectId, mr.iid)] as const;
      } catch (err) {
        console.warn(`[ingest] stats for MR ${mr.projectPath}!${mr.iid} failed`, err);
        return null;
      }
    }),
  );
  return new Map(entries.filter((e) => e !== null));
}

async function shipToBranch(
  tx: Tx,
  args: {
    ticket: TicketRow;
    branch: string | null;
    /** Only becoming triggered re-ships; a re-added Branch label never does. */
    started: boolean;
    recipient: Recipient | null;
    mrs: RelatedMergeRequest[];
    stats: Map<number, MergeRequestStats>;
    notesDraft: string;
  },
): Promise<NextStep> {
  const { ticket, branch } = args;

  if (branch === null) {
    const branchless = await findBranchless(tx, ticket.id);
    if (branchless) return { kind: "noop", reason: `shipment ${branchless.id} already waiting for a branch` };
    return createShipment(tx, args);
  }

  const [existing] = await tx
    .select()
    .from(shipments)
    .where(and(eq(shipments.ticketId, ticket.id), eq(shipments.branch, branch)))
    .for("update");

  if (existing) {
    await snapshotMergeRequests(tx, existing.id, args.mrs, args.stats);
    if (!args.started) return { kind: "noop", reason: `shipment ${existing.id} already exists for ${branch}` };
    return reship(tx, {
      actor: SYSTEM,
      shipmentId: existing.id,
      recipient: { userId: args.recipient?.userId ?? null, gitlabId: args.recipient?.gitlabId ?? null },
      notesDraft: args.notesDraft,
    });
  }

  // A Branch label answers the branch gate of a waiting shipment instead of adding another.
  const branchless = await findBranchless(tx, ticket.id);
  if (branchless) {
    await snapshotMergeRequests(tx, branchless.id, args.mrs, args.stats);
    return pickBranch(tx, { actor: SYSTEM, shipmentId: branchless.id, branch });
  }

  return createShipment(tx, args);
}

async function createShipment(
  tx: Tx,
  args: {
    ticket: TicketRow;
    branch: string | null;
    recipient: Recipient | null;
    mrs: RelatedMergeRequest[];
    stats: Map<number, MergeRequestStats>;
    notesDraft: string;
  },
): Promise<NextStep> {
  const openMrIds = openMergeRequests(args.mrs).map((mr) => mr.id);
  const status = gateStatus({
    recipientUserId: args.recipient?.userId ?? null,
    branch: args.branch,
    openMrCount: openMrIds.length,
  });

  const [shipment] = await tx
    .insert(shipments)
    .values({
      ticketId: args.ticket.id,
      branch: args.branch,
      status,
      recipientUserId: args.recipient?.userId ?? null,
      recipientGitlabId: args.recipient?.gitlabId ?? null,
      notesDraft: args.notesDraft,
      timeline: [timelineEntry("created", { status, branch: args.branch })],
      pendingSince: status === "pending_confirmation" ? new Date() : null,
    })
    .returning();
  await snapshotMergeRequests(tx, shipment.id, args.mrs, args.stats);

  return nextStepFor(shipment.id, status, {
    openMrIds,
    weightMismatch: weightMismatch(args.ticket.nativeWeight, args.ticket.labelWeight),
  });
}

/** MRs that still block the hold gate. Closed-without-merge MRs don't (ARCHITECTURE §3). */
function openMergeRequests(mrs: RelatedMergeRequest[]): RelatedMergeRequest[] {
  return mrs.filter((mr) => mr.state === "opened" || mr.state === "locked");
}

/** Upserts the per-shipment MR rows: stats only, never diffs. */
async function snapshotMergeRequests(
  tx: Tx,
  shipmentId: number,
  mrs: RelatedMergeRequest[],
  stats: Map<number, MergeRequestStats>,
): Promise<void> {
  for (const mr of mrs) {
    const s = stats.get(mr.id);
    const values = {
      shipmentId,
      gitlabMrId: mr.id,
      projectPath: mr.projectPath,
      iid: mr.iid,
      title: mr.title,
      webUrl: mr.webUrl,
      state: mr.state,
      authorGitlabId: mr.authorId,
      targetBranch: mr.targetBranch,
      filesChanged: s?.filesChanged ?? null,
      additions: s?.additions ?? null,
      deletions: s?.deletions ?? null,
      firstCommitAt: s?.firstCommitAt ? new Date(s.firstCommitAt) : null,
      mergedAt: mr.mergedAt ? new Date(mr.mergedAt) : null,
    };
    await tx
      .insert(shipmentMergeRequests)
      .values(values)
      .onConflictDoUpdate({
        target: [shipmentMergeRequests.shipmentId, shipmentMergeRequests.gitlabMrId],
        set: values,
      });
  }
}

// ── Merge Request Hook ───────────────────────────────────────────────

async function ingestMergeRequestHook(p: MergeRequestHook): Promise<NextStep[]> {
  const mr = p.object_attributes;
  const linked = await db()
    .select({ id: shipmentMergeRequests.id, shipmentId: shipmentMergeRequests.shipmentId })
    .from(shipmentMergeRequests)
    .where(eq(shipmentMergeRequests.gitlabMrId, mr.id));
  if (linked.length === 0) return [{ kind: "noop", reason: `MR ${mr.id} not linked to a shipment` }];

  let stats: MergeRequestStats | null = null;
  if (mr.state === "merged") {
    stats = await getMergeRequestStats(mr.target_project_id, mr.iid).catch((err) => {
      console.warn(`[ingest] stats for MR ${mr.id} failed`, err);
      return null;
    });
  }

  return db().transaction(async (tx) => {
    const existing = await tx
      .select({ id: shipmentMergeRequests.id, mergedAt: shipmentMergeRequests.mergedAt })
      .from(shipmentMergeRequests)
      .where(inArray(shipmentMergeRequests.id, linked.map((l) => l.id)));

    for (const row of existing) {
      await tx
        .update(shipmentMergeRequests)
        .set({
          title: mr.title,
          state: mr.state,
          targetBranch: mr.target_branch,
          mergedAt: mr.state === "merged" ? (row.mergedAt ?? new Date()) : null,
          ...(stats
            ? {
                filesChanged: stats.filesChanged,
                additions: stats.additions,
                deletions: stats.deletions,
                firstCommitAt: stats.firstCommitAt ? new Date(stats.firstCommitAt) : null,
              }
            : {}),
        })
        .where(eq(shipmentMergeRequests.id, row.id));
    }

    const steps: NextStep[] = [];
    for (const shipmentId of new Set(linked.map((l) => l.shipmentId))) {
      const [shipment] = await tx
        .select({ status: shipments.status })
        .from(shipments)
        .where(eq(shipments.id, shipmentId));
      if (shipment?.status === "held" || shipment?.status === "awaiting_hold_decision") {
        steps.push(await releaseHeld(tx, { actor: SYSTEM, shipmentId }));
      } else {
        steps.push({ kind: "noop", reason: `shipment ${shipmentId}: MR ${mr.id} updated` });
      }
    }
    await dispatch(tx, steps);
    return steps;
  });
}
