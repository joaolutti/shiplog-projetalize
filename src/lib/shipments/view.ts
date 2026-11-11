/**
 * Loads what the Slack messages need about a shipment (blocks.ts ShipmentView), plus the
 * Slack identities of the people involved.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, shipmentMergeRequests, shipments, tickets, user } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { ShipmentView } from "@/lib/slack/blocks";
import { slack } from "@/lib/slack/client";

export interface LoadedShipment {
  view: ShipmentView;
  ticketId: number;
  recipientUserId: string | null;
  dm: { channel: string; ts: string } | null;
  feed: string | null;
  requesterDm: { channel: string; ts: string } | null;
  pendingSince: Date | null;
  reminderSentAt: Date | null;
  leadsNotifiedAt: Date | null;
}

export async function loadShipment(shipmentId: number): Promise<LoadedShipment | null> {
  const [row] = await db()
    .select({ s: shipments, t: tickets })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .where(eq(shipments.id, shipmentId));
  if (!row) return null;
  const { s, t } = row;

  const mrs = await db()
    .select()
    .from(shipmentMergeRequests)
    .where(eq(shipmentMergeRequests.shipmentId, s.id))
    .orderBy(asc(shipmentMergeRequests.projectPath), asc(shipmentMergeRequests.iid));

  return {
    view: {
      id: s.id,
      status: s.status,
      branch: s.branch,
      notes: s.notesFinal ?? s.notesDraft,
      publishedVia: s.publishedVia,
      url: `${env("APP_URL").replace(/\/+$/, "")}/tickets/${t.id}`,
      ticket: {
        iid: t.iid,
        title: t.title,
        webUrl: t.webUrl,
        projectPath: t.projectPath,
        nativeWeight: t.nativeWeight,
        labelWeight: t.labelWeight,
      },
      requester: t.requesterSlackId
        ? { kind: "resolved", slackUserId: t.requesterSlackId }
        : t.requesterRaw
          ? { kind: "unresolved", raw: t.requesterRaw }
          : { kind: "none" },
      mergeRequests: mrs.map((mr) => ({
        ref: `${mr.projectPath}!${mr.iid}`,
        title: mr.title,
        webUrl: mr.webUrl,
        state: mr.state,
      })),
      intendedGitlabId: s.recipientGitlabId,
    },
    ticketId: t.id,
    recipientUserId: s.recipientUserId,
    dm: s.dmChannelId && s.dmMessageTs ? { channel: s.dmChannelId, ts: s.dmMessageTs } : null,
    feed: s.feedMessageTs,
    requesterDm:
      s.requesterDmChannelId && s.requesterDmTs ? { channel: s.requesterDmChannelId, ts: s.requesterDmTs } : null,
    pendingSince: s.pendingSince,
    reminderSentAt: s.reminderSentAt,
    leadsNotifiedAt: s.leadsNotifiedAt,
  };
}

/** Slack user ID of a Shiplog user (from their Slack sign-in), or null. */
export async function slackIdOf(userId: string): Promise<string | null> {
  const [row] = await db()
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "slack")));
  return row?.accountId ?? null;
}

/** Slack user IDs of every lead who has signed in. */
export async function leadSlackIds(): Promise<string[]> {
  const rows = await db()
    .select({ accountId: account.accountId })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(user.role, "lead"), eq(account.providerId, "slack")));
  return rows.map((r) => r.accountId);
}

/** Shiplog users for these Slack IDs (only those who exist). */
export async function usersBySlackId(slackIds: string[]): Promise<Map<string, { id: string; role: "member" | "dev" | "lead" }>> {
  if (slackIds.length === 0) return new Map();
  const rows = await db()
    .select({ slackId: account.accountId, id: user.id, role: user.role })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.providerId, "slack"), inArray(account.accountId, slackIds)));
  return new Map(rows.map((r) => [r.slackId, { id: r.id, role: r.role }]));
}

/**
 * The Shiplog user behind a Slack user, created on first contact (anyone can verify, D12, and
 * requesters may never have opened the web app). Slack sign-in later finds the same account.
 */
export async function ensureSlackUser(slackUserId: string): Promise<{ id: string; role: "member" | "dev" | "lead" }> {
  const existing = (await usersBySlackId([slackUserId])).get(slackUserId);
  if (existing) return existing;

  const info = await slack().users.info({ user: slackUserId });
  const profile = info.user?.profile;
  const email = profile?.email ?? `${slackUserId}@slack.invalid`;

  return db().transaction(async (tx) => {
    const [byEmail] = await tx.select({ id: user.id, role: user.role }).from(user).where(eq(user.email, email));
    const target =
      byEmail ??
      (
        await tx
          .insert(user)
          .values({
            id: randomUUID(),
            name: profile?.real_name || info.user?.name || slackUserId,
            email,
            emailVerified: Boolean(profile?.email),
            image: profile?.image_192 ?? null,
          })
          .returning({ id: user.id, role: user.role })
      )[0];
    await tx
      .insert(account)
      .values({ id: randomUUID(), userId: target.id, providerId: "slack", accountId: slackUserId })
      .onConflictDoNothing();
    return target;
  });
}
