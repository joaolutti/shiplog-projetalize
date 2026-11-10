/**
 * Who gets the draft DM: assignee → linked-MR author → user who applied the label (D4).
 * The recipient is the first candidate, in that order, who has linked GitLab to Shiplog
 * (account.provider_id = "gitlab"). If none has, the shipment is unclaimed but keeps the
 * first candidate's GitLab ID so leads can see who it was meant for.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account } from "@/lib/db/schema";

export interface RecipientCandidates {
  assigneeGitlabIds: number[];
  mrAuthorGitlabIds: number[];
  labelAppliedByGitlabId: number | null;
}

export interface Recipient {
  gitlabId: number;
  /** Linked Shiplog user, or null when no candidate is linked (→ unclaimed). */
  userId: string | null;
}

/** Candidates in D4 order, without repeats. */
export function candidateOrder(c: RecipientCandidates): number[] {
  const ordered = [...c.assigneeGitlabIds, ...c.mrAuthorGitlabIds];
  if (c.labelAppliedByGitlabId !== null) ordered.push(c.labelAppliedByGitlabId);
  return [...new Set(ordered)];
}

/** Pure choice given which GitLab IDs are linked (GitLab ID → Shiplog user ID). */
export function pickRecipient(
  c: RecipientCandidates,
  linked: ReadonlyMap<number, string>,
): Recipient | null {
  const order = candidateOrder(c);
  if (order.length === 0) return null;
  const first = order.find((id) => linked.has(id));
  if (first === undefined) return { gitlabId: order[0], userId: null };
  return { gitlabId: first, userId: linked.get(first)! };
}

/** GitLab user ID → Shiplog user ID for the given GitLab IDs that have linked accounts. */
export async function linkedGitlabUsers(gitlabIds: number[]): Promise<Map<number, string>> {
  if (gitlabIds.length === 0) return new Map();
  const rows = await db()
    .select({ accountId: account.accountId, userId: account.userId })
    .from(account)
    .where(
      and(eq(account.providerId, "gitlab"), inArray(account.accountId, gitlabIds.map(String))),
    );
  return new Map(rows.map((r) => [Number(r.accountId), r.userId]));
}

export async function resolveRecipient(c: RecipientCandidates): Promise<Recipient | null> {
  return pickRecipient(c, await linkedGitlabUsers(candidateOrder(c)));
}
