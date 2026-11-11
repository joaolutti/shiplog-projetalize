/** M2: leads' unclaimed queue, role changes and role-aware queries (database). */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setRole } from "@/lib/auth/roles";
import type { Viewer } from "@/lib/auth/viewer";
import { db } from "@/lib/db/client";
import { account, shipments, tickets, user } from "@/lib/db/schema";
import { assignRecipient, CommandError, leadPublish, type Actor } from "@/lib/shipments/commands";
import { listAssignable, listTeam, listUnclaimed } from "@/lib/shipments/queries";
import { hasDb, resetDb } from "./helpers/db";

const LEAD: Actor = { kind: "user", userId: "lead", role: "lead" };
const DEV: Actor = { kind: "user", userId: "dev", role: "dev" };
const viewer = (id: string, role: Viewer["role"]): Viewer => ({
  id,
  name: id,
  email: `${id}@example.com`,
  image: null,
  role,
  gitlabId: null,
});

async function seed() {
  await db().insert(user).values([
    { id: "lead", name: "Lead", email: "lead@example.com", role: "lead" },
    { id: "dev", name: "Dev", email: "dev@example.com", role: "dev" },
    { id: "member", name: "Member", email: "member@example.com", role: "member" },
    { id: "nolink", name: "Dev sem GitLab", email: "nolink@example.com", role: "dev" },
  ]);
  await db().insert(account).values([
    { id: "a-dev", userId: "dev", providerId: "gitlab", accountId: "11" },
    { id: "a-member", userId: "member", providerId: "gitlab", accountId: "33" },
    { id: "a-lead", userId: "lead", providerId: "gitlab", accountId: "44" },
  ]);
  const [t] = await db()
    .insert(tickets)
    .values({ gitlabIssueId: 1, gitlabProjectId: 7, projectPath: "acme/app", iid: 5, title: "Fix", webUrl: "u", gitlabState: "opened" })
    .returning();
  const [s] = await db()
    .insert(shipments)
    .values({ ticketId: t.id, branch: "Main", status: "unclaimed", recipientGitlabId: 99, notesDraft: "Corrige X" })
    .returning();
  return s;
}

describe.skipIf(!hasDb)("unclaimed queue", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a lead assigns a linked dev, which moves the shipment on to the draft", async () => {
    const s = await seed();
    const step = await db().transaction((tx) =>
      assignRecipient(tx, { actor: LEAD, shipmentId: s.id, userId: "dev" }),
    );
    expect(step).toEqual({ kind: "send_draft", shipmentId: s.id, weightMismatch: null });
    const [row] = await db().select().from(shipments).where(eq(shipments.id, s.id));
    expect(row).toMatchObject({ status: "pending_confirmation", recipientUserId: "dev", recipientGitlabId: 11 });
    expect(row.timeline.at(-1)).toMatchObject({ event: "assign_recipient", data: { by: "lead" } });
  });

  it("only devs and leads with GitLab linked can be assigned", async () => {
    const s = await seed();
    for (const userId of ["member", "nolink"]) {
      await expect(
        db().transaction((tx) => assignRecipient(tx, { actor: LEAD, shipmentId: s.id, userId })),
      ).rejects.toBeInstanceOf(CommandError);
    }
  });

  it("only leads can assign or publish", async () => {
    const s = await seed();
    await expect(
      db().transaction((tx) => assignRecipient(tx, { actor: DEV, shipmentId: s.id, userId: "dev" })),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(db().transaction((tx) => leadPublish(tx, { actor: DEV, shipmentId: s.id }))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("a lead publishes as is: published_via lead, draft notes become final", async () => {
    const s = await seed();
    await db().transaction((tx) => leadPublish(tx, { actor: LEAD, shipmentId: s.id }));
    const [row] = await db().select().from(shipments).where(eq(shipments.id, s.id));
    expect(row).toMatchObject({ status: "published", publishedVia: "lead", notesFinal: "Corrige X" });
    expect(row.publishedAt).toBeInstanceOf(Date);
  });

  it("publishing needs a branch", async () => {
    const s = await seed();
    await db().update(shipments).set({ branch: null }).where(eq(shipments.id, s.id));
    const step = await db().transaction((tx) => leadPublish(tx, { actor: LEAD, shipmentId: s.id }));
    expect(step).toMatchObject({ kind: "noop" });
    expect((await db().select().from(shipments))[0].status).toBe("unclaimed");
  });

  it("queries show the queue and team to leads only", async () => {
    await seed();
    expect(await listUnclaimed(viewer("lead", "lead"))).toHaveLength(1);
    expect(await listUnclaimed(viewer("dev", "dev"))).toEqual([]);
    expect(await listTeam(viewer("member", "member"))).toEqual([]);
    expect((await listAssignable(viewer("lead", "lead"))).map((m) => m.id).sort()).toEqual(["dev", "lead"]);
  });
});

describe.skipIf(!hasDb)("setRole", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  it("leads change roles; others can't", async () => {
    await setRole({ actor: LEAD, userId: "member", role: "dev" });
    expect((await db().select().from(user).where(eq(user.id, "member")))[0].role).toBe("dev");
    await expect(setRole({ actor: DEV, userId: "member", role: "lead" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("the last lead can't step down", async () => {
    await expect(setRole({ actor: LEAD, userId: "lead", role: "dev" })).rejects.toMatchObject({ code: "forbidden" });
    await setRole({ actor: LEAD, userId: "dev", role: "lead" });
    await setRole({ actor: LEAD, userId: "lead", role: "dev" });
    expect((await db().select().from(user).where(eq(user.id, "lead")))[0].role).toBe("dev");
  });
});
