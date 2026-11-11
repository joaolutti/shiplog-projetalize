/**
 * Read models for pages (docs/ARCHITECTURE.md §2). Each takes the viewer and returns only
 * what that role may see. No function groups by person (D24).
 */
import { and, asc, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  account,
  comments,
  shipmentMergeRequests,
  shipments,
  tickets,
  user,
  verifications,
  weightReviews,
  type TimelineEntry,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/viewer";
import { addDays, ago, dayKey, startOfDayAgo } from "@/lib/dates";

export interface UnclaimedShipment {
  id: number;
  branch: string | null;
  createdAt: Date;
  // GitLab user the shipment was meant for (assignee → MR author → label applier).
  intendedGitlabId: number | null;
  notes: string | null;
  ticket: { id: number; iid: number; title: string; webUrl: string; projectPath: string };
}

// Leads only; empty for anyone else. Oldest first.
export async function listUnclaimed(viewer: Viewer): Promise<UnclaimedShipment[]> {
  if (viewer.role !== "lead") return [];
  const rows = await db()
    .select({
      id: shipments.id,
      branch: shipments.branch,
      createdAt: shipments.createdAt,
      intendedGitlabId: shipments.recipientGitlabId,
      notes: shipments.notesDraft,
      ticketId: tickets.id,
      iid: tickets.iid,
      title: tickets.title,
      webUrl: tickets.webUrl,
      projectPath: tickets.projectPath,
    })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .where(eq(shipments.status, "unclaimed"))
    .orderBy(asc(shipments.createdAt));
  return rows.map(({ ticketId, iid, title, webUrl, projectPath, ...s }) => ({
    ...s,
    ticket: { id: ticketId, iid, title, webUrl, projectPath },
  }));
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Viewer["role"];
  gitlabId: number | null;
}

// Leads see everyone (to manage roles); others see nobody. Sorted by name.
export async function listTeam(viewer: Viewer): Promise<TeamMember[]> {
  if (viewer.role !== "lead") return [];
  const users = await db()
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .orderBy(asc(user.name));
  const links = await db()
    .select({ userId: account.userId, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.providerId, "gitlab"),
        inArray(
          account.userId,
          users.map((u) => u.id),
        ),
      ),
    );
  const gitlabByUser = new Map(links.map((l) => [l.userId, Number(l.accountId)]));
  return users.map((u) => ({ ...u, gitlabId: gitlabByUser.get(u.id) ?? null }));
}

// Who a lead can assign an unclaimed shipment to: devs and leads with GitLab linked.
export async function listAssignable(viewer: Viewer): Promise<TeamMember[]> {
  return (await listTeam(viewer)).filter((m) => m.role !== "member" && m.gitlabId !== null);
}

// ── Shared ───────────────────────────────────────────────────────────

export type VerificationStatus = "unverified" | "verified" | "issue_reported";

// Shipments still on their way to being published (the "rascunhos").
const IN_PROGRESS = ["pending_confirmation", "held", "awaiting_hold_decision", "needs_branch"] as const;

// Shiplog user names for Slack user IDs (requesters may not have one: then the raw name is used).
async function namesBySlackId(slackIds: string[]): Promise<Map<string, string>> {
  if (slackIds.length === 0) return new Map();
  const rows = await db()
    .select({ slackId: account.accountId, name: user.name })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.providerId, "slack"), inArray(account.accountId, slackIds)));
  return new Map(rows.map((r) => [r.slackId, r.name]));
}

// ── Shell ────────────────────────────────────────────────────────────

export interface ShellSummary {
  unclaimed: number;
  weekVerified: number;
  weekTotal: number;
}

// Sidebar counters: this week's verification meter, and the unclaimed queue for leads.
export async function shellSummary(viewer: Viewer): Promise<ShellSummary> {
  const week = await db()
    .select({ status: shipments.verificationStatus })
    .from(shipments)
    .where(and(eq(shipments.status, "published"), gte(shipments.publishedAt, startOfDayAgo(6))));
  const [unclaimed] =
    viewer.role === "lead"
      ? await db().select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.status, "unclaimed"))
      : [{ n: 0 }];
  return {
    unclaimed: unclaimed.n,
    weekVerified: week.filter((w) => w.status === "verified").length,
    weekTotal: week.length,
  };
}

// ── Feed ─────────────────────────────────────────────────────────────

export interface FeedFilters {
  branch?: string;
  verification?: VerificationStatus;
  // Shiplog user ID of the dev who shipped it (a filter, not a score: D24).
  dev?: string;
  // Requester's Slack user ID.
  requester?: string;
  q?: string;
  // Only the last N days.
  days?: number;
  limit?: number;
}

export interface FeedItem {
  shipmentId: number;
  ticketId: number;
  iid: number;
  title: string;
  projectPath: string;
  webUrl: string;
  labels: string[];
  branch: string | null;
  notes: string | null;
  publishedAt: Date;
  publishedVia: "confirmed" | "auto" | "lead" | null;
  verification: VerificationStatus;
  mrCount: number;
  repoCount: number;
  // Lines added + removed across the MRs, when known.
  lines: number | null;
  reviewRounds: number | null;
  devName: string | null;
  requesterName: string | null;
  verifiers: Array<{ name: string; image: string | null }>;
  // The viewer's own verification, if any.
  mine: "verified" | "issue_reported" | null;
}

// Published shipments, newest first. Everyone may see the feed (D12).
export async function listFeed(viewer: Viewer, filters: FeedFilters = {}): Promise<FeedItem[]> {
  const where: SQL[] = [eq(shipments.status, "published")];
  if (filters.branch) where.push(eq(shipments.branch, filters.branch));
  if (filters.verification) where.push(eq(shipments.verificationStatus, filters.verification));
  if (filters.dev) where.push(eq(shipments.recipientUserId, filters.dev));
  if (filters.requester) where.push(eq(tickets.requesterSlackId, filters.requester));
  if (filters.days) where.push(gte(shipments.publishedAt, startOfDayAgo(filters.days - 1)));
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      or(
        ilike(tickets.title, like),
        ilike(tickets.projectPath, like),
        ilike(shipments.notesFinal, like),
        ilike(shipments.notesDraft, like),
        sql`${tickets.iid}::text = ${q.replace(/^#/, "")}`,
        sql`${tickets.labels}::text ilike ${like}`,
      )!,
    );
  }

  const rows = await db()
    .select({ s: shipments, t: tickets, devName: user.name })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .leftJoin(user, eq(user.id, shipments.recipientUserId))
    .where(and(...where))
    .orderBy(desc(shipments.publishedAt))
    .limit(filters.limit ?? 200);
  return hydrateFeed(viewer, rows);
}

async function hydrateFeed(
  viewer: Viewer,
  rows: Array<{ s: typeof shipments.$inferSelect; t: typeof tickets.$inferSelect; devName: string | null }>,
): Promise<FeedItem[]> {
  const ids = rows.map((r) => r.s.id);
  if (ids.length === 0) return [];

  const mrs = await db()
    .select({
      shipmentId: shipmentMergeRequests.shipmentId,
      projectPath: shipmentMergeRequests.projectPath,
      additions: shipmentMergeRequests.additions,
      deletions: shipmentMergeRequests.deletions,
      reviewRounds: shipmentMergeRequests.reviewRounds,
    })
    .from(shipmentMergeRequests)
    .where(inArray(shipmentMergeRequests.shipmentId, ids));
  const vers = await db()
    .select({ shipmentId: verifications.shipmentId, userId: verifications.userId, kind: verifications.kind, name: user.name, image: user.image })
    .from(verifications)
    .innerJoin(user, eq(user.id, verifications.userId))
    .where(inArray(verifications.shipmentId, ids));
  const requesters = await namesBySlackId(rows.map((r) => r.t.requesterSlackId).filter((x): x is string => !!x));

  return rows.map(({ s, t, devName }) => {
    const mine = mrs.filter((m) => m.shipmentId === s.id);
    const known = mine.filter((m) => m.additions !== null);
    const rounds = mine.filter((m) => m.reviewRounds !== null);
    const v = vers.filter((x) => x.shipmentId === s.id);
    return {
      shipmentId: s.id,
      ticketId: t.id,
      iid: t.iid,
      title: t.title,
      projectPath: t.projectPath,
      webUrl: t.webUrl,
      labels: t.labels,
      branch: s.branch,
      notes: s.notesFinal ?? s.notesDraft,
      publishedAt: s.publishedAt ?? s.updatedAt,
      publishedVia: s.publishedVia,
      verification: s.verificationStatus,
      mrCount: mine.length,
      repoCount: new Set(mine.map((m) => m.projectPath)).size,
      lines: known.length ? known.reduce((a, m) => a + (m.additions ?? 0) + (m.deletions ?? 0), 0) : null,
      reviewRounds: rounds.length ? rounds.reduce((a, m) => a + (m.reviewRounds ?? 0), 0) : null,
      devName,
      requesterName: t.requesterSlackId ? (requesters.get(t.requesterSlackId) ?? t.requesterRaw) : t.requesterRaw,
      verifiers: v.filter((x) => x.kind === "verified").map((x) => ({ name: x.name, image: x.image })),
      mine: v.find((x) => x.userId === viewer.id)?.kind ?? null,
    };
  });
}

export interface FeedOptions {
  devs: Array<{ id: string; name: string }>;
  requesters: Array<{ slackId: string; name: string }>;
  branches: string[];
}

// Values for the feed's filter menus, from what has been published.
export async function feedOptions(): Promise<FeedOptions> {
  const rows = await db()
    .selectDistinct({
      devId: shipments.recipientUserId,
      devName: user.name,
      branch: shipments.branch,
      requesterSlackId: tickets.requesterSlackId,
      requesterRaw: tickets.requesterRaw,
    })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .leftJoin(user, eq(user.id, shipments.recipientUserId))
    .where(eq(shipments.status, "published"));
  const names = await namesBySlackId(rows.map((r) => r.requesterSlackId).filter((x): x is string => !!x));
  const devs = new Map<string, string>();
  const requesters = new Map<string, string>();
  const branches = new Set<string>();
  for (const r of rows) {
    if (r.devId && r.devName) devs.set(r.devId, r.devName);
    if (r.requesterSlackId) requesters.set(r.requesterSlackId, names.get(r.requesterSlackId) ?? r.requesterRaw ?? r.requesterSlackId);
    if (r.branch) branches.add(r.branch);
  }
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "pt-BR");
  return {
    devs: [...devs].map(([id, name]) => ({ id, name })).sort(byName),
    requesters: [...requesters].map(([slackId, name]) => ({ slackId, name })).sort(byName),
    branches: [...branches].sort(),
  };
}

// ── Overview (team totals only: D24, D38) ────────────────────────────

export interface AttentionItem {
  icon: string;
  title: string;
  sub: string;
  chip: { tone: "issue" | "warn" | "roxo"; label: string };
  href: string;
  at: Date;
  severity: number;
}

export interface Overview {
  week: {
    total: number;
    today: number;
    byBranch: Record<string, number>;
    verified: number;
    waiting: number;
    waitingOver24h: number;
    issues: number;
    verifiedPct: number;
    // % verified per branch, and % verified by the requester among those with one.
    pctByBranch: Array<{ branch: string; pct: number }>;
    requesterPct: number | null;
  };
  last7: Array<{ key: string; count: number }>;
  drafts: { pending: number; blocked: number };
  attention: AttentionItem[];
  // Published per São Paulo day over the last 53 weeks.
  activity: Map<string, number>;
  recent: FeedItem[];
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export async function overview(viewer: Viewer): Promise<Overview> {
  const now = new Date();
  const today = dayKey(now);
  const yearAgo = startOfDayAgo(371, now);

  const published = await db()
    .select({
      id: shipments.id,
      branch: shipments.branch,
      at: shipments.publishedAt,
      via: shipments.publishedVia,
      verification: shipments.verificationStatus,
      requesterSlackId: tickets.requesterSlackId,
    })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .where(and(eq(shipments.status, "published"), gte(shipments.publishedAt, yearAgo)));

  const activity = new Map<string, number>();
  for (const p of published) if (p.at) activity.set(dayKey(p.at), (activity.get(dayKey(p.at)) ?? 0) + 1);

  const weekStart = startOfDayAgo(6, now);
  const week = published.filter((p) => p.at && p.at >= weekStart);
  const byBranch: Record<string, number> = {};
  for (const w of week) if (w.branch) byBranch[w.branch] = (byBranch[w.branch] ?? 0) + 1;
  const verified = week.filter((w) => w.verification === "verified");
  const waiting = week.filter((w) => w.verification === "unverified");
  const issues = week.filter((w) => w.verification === "issue_reported");

  // Requester verification: did the requester's own Shiplog user verify?
  const withRequester = week.filter((w) => w.requesterSlackId);
  let requesterOk = 0;
  if (withRequester.length) {
    const rows = await db()
      .select({ shipmentId: verifications.shipmentId, slackId: account.accountId })
      .from(verifications)
      .innerJoin(account, and(eq(account.userId, verifications.userId), eq(account.providerId, "slack")))
      .where(and(inArray(verifications.shipmentId, withRequester.map((w) => w.id)), eq(verifications.kind, "verified")));
    requesterOk = withRequester.filter((w) => rows.some((r) => r.shipmentId === w.id && r.slackId === w.requesterSlackId)).length;
  }

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(today, i - 6);
    return { key, count: activity.get(key) ?? 0 };
  });

  const [drafts] = await db()
    .select({
      pending: sql<number>`count(*) filter (where ${shipments.status} in ('pending_confirmation','held','awaiting_hold_decision','needs_branch'))::int`,
      blocked: sql<number>`count(*) filter (where ${shipments.status} in ('held','awaiting_hold_decision','needs_branch'))::int`,
    })
    .from(shipments);

  return {
    week: {
      total: week.length,
      today: week.filter((w) => w.at && dayKey(w.at) === today).length,
      byBranch,
      verified: verified.length,
      waiting: waiting.length,
      waitingOver24h: waiting.filter((w) => w.at && now.getTime() - w.at.getTime() > 24 * 3600e3).length,
      issues: issues.length,
      verifiedPct: pct(verified.length, week.length),
      pctByBranch: Object.keys(byBranch)
        .sort()
        .map((branch) => {
          const all = week.filter((w) => w.branch === branch);
          return { branch, pct: pct(all.filter((w) => w.verification === "verified").length, all.length) };
        }),
      requesterPct: withRequester.length ? pct(requesterOk, withRequester.length) : null,
    },
    last7,
    drafts,
    attention: await attention(viewer, now),
    activity,
    recent: await listFeed(viewer, { limit: 6 }),
  };
}

// What needs someone: problems, unconfirmed notes, blocked and waiting drafts.
async function attention(viewer: Viewer, now: Date): Promise<AttentionItem[]> {
  const rows = await db()
    .select({
      id: shipments.id,
      status: shipments.status,
      via: shipments.publishedVia,
      verification: shipments.verificationStatus,
      at: shipments.updatedAt,
      publishedAt: shipments.publishedAt,
      intendedGitlabId: shipments.recipientGitlabId,
      ticketId: tickets.id,
      iid: tickets.iid,
      title: tickets.title,
      devName: user.name,
    })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .leftJoin(user, eq(user.id, shipments.recipientUserId))
    .where(
      or(
        inArray(shipments.status, [...IN_PROGRESS, "unclaimed"]),
        and(eq(shipments.status, "published"), ne(shipments.verificationStatus, "verified"), gte(shipments.publishedAt, startOfDayAgo(13, now))),
      ),
    )
    .orderBy(desc(shipments.updatedAt))
    .limit(50);

  const items: AttentionItem[] = [];
  for (const r of rows) {
    const who = r.devName ?? (r.intendedGitlabId ? `usuário ${r.intendedGitlabId} do GitLab` : "sem responsável");
    const base = { sub: `#${r.iid} ${r.title} · ${who} · ${ago(r.at, now)}`, href: `/tickets/${r.ticketId}`, at: r.at };
    if (r.status === "published" && r.verification === "issue_reported") {
      items.push({ ...base, severity: 0, icon: "report", title: "Problema relatado", chip: { tone: "issue", label: "Problema" } });
    } else if (r.status === "published" && r.via === "auto") {
      items.push({ ...base, severity: 2, icon: "schedule", title: "Notas publicadas sem confirmação", chip: { tone: "warn", label: "Não confirmadas" } });
    } else if (r.status === "held" || r.status === "awaiting_hold_decision") {
      items.push({ ...base, severity: 1, icon: "merge", title: "MR relacionado ainda aberto", chip: { tone: "warn", label: "Bloqueado" } });
    } else if (r.status === "needs_branch") {
      items.push({ ...base, severity: 1, icon: "call_split", title: "Falta a label de branch", chip: { tone: "warn", label: "Bloqueado" } });
    } else if (r.status === "unclaimed") {
      const href = viewer.role === "lead" ? "/unclaimed" : base.href;
      items.push({ ...base, href, severity: 1, icon: "person_off", title: "Rascunho sem responsável", chip: { tone: "roxo", label: "Líderes" } });
    } else if (r.status === "pending_confirmation") {
      items.push({ ...base, severity: 3, icon: "edit_note", title: "Rascunho aguardando confirmação", chip: { tone: "roxo", label: "Pendente" } });
    }
  }
  return items.sort((a, b) => a.severity - b.severity || b.at.getTime() - a.at.getTime());
}

// ── Ticket page ──────────────────────────────────────────────────────

export interface TicketShipment {
  id: number;
  branch: string | null;
  status: (typeof shipments.$inferSelect)["status"];
  notes: string | null;
  publishedAt: Date | null;
  publishedVia: "confirmed" | "auto" | "lead" | null;
  verification: VerificationStatus;
  devName: string | null;
  mergeRequests: Array<{
    ref: string;
    title: string;
    webUrl: string;
    state: string;
    filesChanged: number | null;
    additions: number | null;
    deletions: number | null;
    reviewRounds: number | null;
    mergedAt: Date | null;
  }>;
  verifications: Array<{ userId: string; name: string; kind: "verified" | "issue_reported"; at: Date }>;
  mine: "verified" | "issue_reported" | null;
  // The viewer may ask the reporters to check again now (D41).
  canRequestReverify: boolean;
  timeline: TimelineEntry[];
}

export interface TicketComment {
  id: number;
  body: string;
  source: string;
  at: Date;
  authorName: string;
  authorImage: string | null;
  branch: string | null;
  isReport: boolean;
}

export interface TicketDetail {
  id: number;
  iid: number;
  title: string;
  projectPath: string;
  webUrl: string;
  labels: string[];
  gitlabStatus: string | null;
  assignees: string[];
  requesterName: string | null;
  hubspotUrls: string[];
  shipments: TicketShipment[];
  comments: TicketComment[];
  // Weight reviews: dev and lead only (D23); always empty for members.
  weightReviews: Array<typeof weightReviews.$inferSelect & { branch: string | null }>;
}

const REVERIFY_EVERY_MS = 60 * 60 * 1000;

export async function ticketDetail(viewer: Viewer, ticketId: number): Promise<TicketDetail | null> {
  const [t] = await db().select().from(tickets).where(eq(tickets.id, ticketId));
  if (!t) return null;

  const ships = await db()
    .select({ s: shipments, devName: user.name })
    .from(shipments)
    .leftJoin(user, eq(user.id, shipments.recipientUserId))
    .where(eq(shipments.ticketId, ticketId))
    .orderBy(asc(shipments.createdAt));
  const ids = ships.map((x) => x.s.id);

  const mrs = ids.length
    ? await db().select().from(shipmentMergeRequests).where(inArray(shipmentMergeRequests.shipmentId, ids)).orderBy(asc(shipmentMergeRequests.projectPath))
    : [];
  const vers = ids.length
    ? await db()
        .select({ shipmentId: verifications.shipmentId, userId: verifications.userId, kind: verifications.kind, at: verifications.updatedAt, name: user.name })
        .from(verifications)
        .innerJoin(user, eq(user.id, verifications.userId))
        .where(inArray(verifications.shipmentId, ids))
        .orderBy(asc(verifications.updatedAt))
    : [];
  const reportComments = new Set(
    ids.length
      ? (
          await db()
            .select({ commentId: verifications.commentId })
            .from(verifications)
            .where(and(inArray(verifications.shipmentId, ids), eq(verifications.kind, "issue_reported")))
        ).map((r) => r.commentId)
      : [],
  );
  const thread = await db()
    .select({ c: comments, authorName: user.name, authorImage: user.image })
    .from(comments)
    .innerJoin(user, eq(user.id, comments.authorUserId))
    .where(eq(comments.ticketId, ticketId))
    .orderBy(asc(comments.createdAt));

  const assigneeRows = t.assigneeGitlabIds.length
    ? await db()
        .select({ gitlabId: account.accountId, name: user.name })
        .from(account)
        .innerJoin(user, eq(user.id, account.userId))
        .where(and(eq(account.providerId, "gitlab"), inArray(account.accountId, t.assigneeGitlabIds.map(String))))
    : [];
  const requesterName = t.requesterSlackId
    ? ((await namesBySlackId([t.requesterSlackId])).get(t.requesterSlackId) ?? t.requesterRaw)
    : t.requesterRaw;

  const isTeam = viewer.role === "dev" || viewer.role === "lead";
  const reviews = isTeam && ids.length ? await db().select().from(weightReviews).where(inArray(weightReviews.shipmentId, ids)) : [];
  const branchOf = new Map(ships.map((x) => [x.s.id, x.s.branch]));
  const now = Date.now();

  return {
    id: t.id,
    iid: t.iid,
    title: t.title,
    projectPath: t.projectPath,
    webUrl: t.webUrl,
    labels: t.labels,
    gitlabStatus: t.gitlabStatus,
    assignees: t.assigneeGitlabIds.map(
      (id) => assigneeRows.find((a) => a.gitlabId === String(id))?.name ?? `Usuário ${id} do GitLab`,
    ),
    requesterName,
    hubspotUrls: t.hubspotUrls,
    shipments: ships.map(({ s, devName }) => {
      const v = vers.filter((x) => x.shipmentId === s.id);
      const mayAsk = viewer.role === "lead" || viewer.id === s.recipientUserId;
      const last = s.lastReverifyRequestedAt?.getTime() ?? 0;
      return {
        id: s.id,
        branch: s.branch,
        status: s.status,
        notes: s.notesFinal ?? s.notesDraft,
        publishedAt: s.publishedAt,
        publishedVia: s.publishedVia,
        verification: s.verificationStatus,
        devName,
        mergeRequests: mrs
          .filter((m) => m.shipmentId === s.id)
          .map((m) => ({
            ref: `${m.projectPath}!${m.iid}`,
            title: m.title,
            webUrl: m.webUrl,
            state: m.state,
            filesChanged: m.filesChanged,
            additions: m.additions,
            deletions: m.deletions,
            reviewRounds: m.reviewRounds,
            mergedAt: m.mergedAt,
          })),
        verifications: v.map((x) => ({ userId: x.userId, name: x.name, kind: x.kind, at: x.at })),
        mine: v.find((x) => x.userId === viewer.id)?.kind ?? null,
        canRequestReverify: mayAsk && s.verificationStatus === "issue_reported" && now - last >= REVERIFY_EVERY_MS,
        timeline: s.timeline,
      };
    }),
    comments: thread.map(({ c, authorName, authorImage }) => ({
      id: c.id,
      body: c.body,
      source: c.source,
      at: c.createdAt,
      authorName,
      authorImage,
      branch: c.shipmentId ? (branchOf.get(c.shipmentId) ?? null) : null,
      isReport: reportComments.has(c.id),
    })),
    weightReviews: reviews.map((r) => ({ ...r, branch: branchOf.get(r.shipmentId) ?? null })),
  };
}
