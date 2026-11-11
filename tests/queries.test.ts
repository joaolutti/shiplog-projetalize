// M4 read models against a real database: feed filters, overview totals, ticket page roles.
import { beforeEach, describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/auth/viewer";
import { devImpersonationAllowed } from "@/lib/auth/viewer";
import { db } from "@/lib/db/client";
import { account, comments, shipmentMergeRequests, shipments, tickets, user, verifications, weightReviews } from "@/lib/db/schema";
import { feedOptions, listFeed, overview, ticketDetail } from "@/lib/shipments/queries";
import { hasDb, resetDb } from "./helpers/db";

const viewer = (id: string, role: Viewer["role"]): Viewer => ({ id, name: id, email: `${id}@x.test`, image: null, role, gitlabId: null });
const HOUR = 3600e3;

async function seed() {
  await db().insert(user).values([
    { id: "dev", name: "Ana Dev", email: "dev@x.test", role: "dev" },
    { id: "lead", name: "Lia Lead", email: "lead@x.test", role: "lead" },
    { id: "req", name: "Rui Suporte", email: "req@x.test", role: "member" },
  ]);
  await db().insert(account).values([{ id: "a1", userId: "req", providerId: "slack", accountId: "U_REQ" }]);
  const [t1, t2] = await db()
    .insert(tickets)
    .values([
      { gitlabIssueId: 1, gitlabProjectId: 7, projectPath: "acme/app", iid: 101, title: "Corrigir login SSO", webUrl: "u1", gitlabState: "closed", requesterSlackId: "U_REQ", labels: ["Bug", "Branch: Main"] },
      { gitlabIssueId: 2, gitlabProjectId: 7, projectPath: "acme/api", iid: 102, title: "Exportar PDF", webUrl: "u2", gitlabState: "closed" },
    ])
    .returning();
  const now = Date.now();
  const [s1, s2, s3] = await db()
    .insert(shipments)
    .values([
      { ticketId: t1.id, branch: "Main", status: "published", publishedVia: "confirmed", publishedAt: new Date(now - HOUR), recipientUserId: "dev", notesFinal: "SSO voltou", verificationStatus: "verified" },
      { ticketId: t2.id, branch: "Staging", status: "published", publishedVia: "auto", publishedAt: new Date(now - 40 * 24 * HOUR), recipientUserId: "dev", notesDraft: "PDF novo" },
      { ticketId: t2.id, branch: "Main", status: "pending_confirmation", recipientUserId: "dev" },
    ])
    .returning();
  await db().insert(verifications).values({ shipmentId: s1.id, userId: "req", kind: "verified" });
  await db().insert(shipmentMergeRequests).values([
    { shipmentId: s1.id, gitlabMrId: 1, projectPath: "acme/app", iid: 1, title: "mr", webUrl: "m", state: "merged", additions: 10, deletions: 2 },
    { shipmentId: s1.id, gitlabMrId: 2, projectPath: "acme/lib", iid: 2, title: "mr", webUrl: "m", state: "merged", additions: 3, deletions: 0 },
  ]);
  await db().insert(comments).values({ ticketId: t1.id, shipmentId: s1.id, authorUserId: "req", body: "Testei, ok" });
  await db().insert(weightReviews).values({ shipmentId: s1.id, verdict: "agree", suggestedWeight: 3, confidence: "high", rationale: "ok" });
  return { t1, t2, s1, s2, s3 };
}

describe.skipIf(!hasDb)("listFeed", () => {
  beforeEach(resetDb);

  it("lists published shipments newest first, with MR totals, verifiers and the viewer's own verification", async () => {
    const { s1 } = await seed();
    const items = await listFeed(viewer("req", "member"));
    expect(items.map((i) => i.title)).toEqual(["Corrigir login SSO", "Exportar PDF"]);
    expect(items[0]).toMatchObject({
      shipmentId: s1.id,
      notes: "SSO voltou",
      mrCount: 2,
      repoCount: 2,
      lines: 15,
      devName: "Ana Dev",
      requesterName: "Rui Suporte",
      verifiers: [{ name: "Rui Suporte" }],
      mine: "verified",
    });
    expect(items[1]).toMatchObject({ notes: "PDF novo", lines: null, mine: null, publishedVia: "auto" });
  });

  it("filters by branch, verification, dev, requester, period and search", async () => {
    await seed();
    const v = viewer("lead", "lead");
    const titles = async (f: Parameters<typeof listFeed>[1]) => (await listFeed(v, f)).map((i) => i.iid);
    expect(await titles({ branch: "Staging" })).toEqual([102]);
    expect(await titles({ verification: "verified" })).toEqual([101]);
    expect(await titles({ dev: "dev" })).toEqual([101, 102]);
    expect(await titles({ requester: "U_REQ" })).toEqual([101]);
    expect(await titles({ days: 7 })).toEqual([101]);
    expect(await titles({ q: "pdf" })).toEqual([102]);
    expect(await titles({ q: "#101" })).toEqual([101]);
    expect(await titles({ q: "bug" })).toEqual([101]);
    expect(await titles({ q: "100%_" })).toEqual([]);
  });

  it("offers filter values from what was published", async () => {
    await seed();
    expect(await feedOptions()).toEqual({
      devs: [{ id: "dev", name: "Ana Dev" }],
      requesters: [{ slackId: "U_REQ", name: "Rui Suporte" }],
      branches: ["Main", "Staging"],
    });
  });
});

describe.skipIf(!hasDb)("overview", () => {
  beforeEach(resetDb);

  it("counts this week's team deliveries and what needs attention", async () => {
    await seed();
    const o = await overview(viewer("lead", "lead"));
    expect(o.week).toMatchObject({ total: 1, today: expect.any(Number), verified: 1, waiting: 0, issues: 0, verifiedPct: 100, requesterPct: 100 });
    expect(o.week.byBranch).toEqual({ Main: 1 });
    expect(o.last7).toHaveLength(7);
    expect(o.drafts).toEqual({ pending: 1, blocked: 0 });
    expect(o.attention.map((a) => a.title)).toEqual(["Rascunho aguardando confirmação"]);
    expect([...o.activity.values()].reduce((a, b) => a + b, 0)).toBe(2);
    expect(o.recent).toHaveLength(2);
  });
});

describe.skipIf(!hasDb)("ticketDetail", () => {
  beforeEach(resetDb);

  it("shows weight reviews to devs and leads only (D23)", async () => {
    const { t1 } = await seed();
    expect((await ticketDetail(viewer("dev", "dev"), t1.id))!.weightReviews).toHaveLength(1);
    expect((await ticketDetail(viewer("req", "member"), t1.id))!.weightReviews).toEqual([]);
  });

  it("has the shipments, verifications, thread and requester", async () => {
    const { t1, s1 } = await seed();
    const t = (await ticketDetail(viewer("req", "member"), t1.id))!;
    expect(t.requesterName).toBe("Rui Suporte");
    expect(t.shipments[0]).toMatchObject({ id: s1.id, mine: "verified", canRequestReverify: false });
    expect(t.shipments[0].verifications).toMatchObject([{ name: "Rui Suporte", kind: "verified" }]);
    expect(t.comments).toMatchObject([{ body: "Testei, ok", authorName: "Rui Suporte", branch: "Main", isReport: false }]);
  });

  it("lets the recipient or a lead ask for reverification only while a problem is reported", async () => {
    const { t1, s1 } = await seed();
    const { eq } = await import("drizzle-orm");
    await db().update(shipments).set({ verificationStatus: "issue_reported" }).where(eq(shipments.id, s1.id));
    expect((await ticketDetail(viewer("dev", "dev"), t1.id))!.shipments[0].canRequestReverify).toBe(true);
    expect((await ticketDetail(viewer("lead", "lead"), t1.id))!.shipments[0].canRequestReverify).toBe(true);
    expect((await ticketDetail(viewer("req", "member"), t1.id))!.shipments[0].canRequestReverify).toBe(false);
    await db().update(shipments).set({ lastReverifyRequestedAt: new Date() }).where(eq(shipments.id, s1.id));
    expect((await ticketDetail(viewer("dev", "dev"), t1.id))!.shipments[0].canRequestReverify).toBe(false);
  });

  it("returns null for an unknown ticket", async () => {
    expect(await ticketDetail(viewer("dev", "dev"), 999)).toBeNull();
  });
});

describe("devImpersonationAllowed (ver como)", () => {
  const h = (entries: Record<string, string>) => new Headers(entries);

  it("allows requests made on this machine", () => {
    expect(devImpersonationAllowed(h({ host: "localhost:3000", "x-forwarded-for": "::1" }))).toBe(true);
    expect(devImpersonationAllowed(h({ host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("refuses anything that came through the tunnel or another host", () => {
    expect(devImpersonationAllowed(h({ host: "shiplog-dev.lutti.dev", "cf-ray": "x" }))).toBe(false);
    expect(devImpersonationAllowed(h({ host: "localhost:3000", "cf-connecting-ip": "1.2.3.4" }))).toBe(false);
    expect(devImpersonationAllowed(h({ host: "localhost:3000", "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    expect(devImpersonationAllowed(h({ host: "shiplog-dev.lutti.dev" }))).toBe(false);
  });
});
