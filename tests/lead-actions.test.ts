// M2: role changes and role-aware queries (database).
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setRole } from "@/lib/auth/roles";
import type { Viewer } from "@/lib/auth/viewer";
import { db } from "@/lib/db/client";
import { account, user } from "@/lib/db/schema";
import type { Actor } from "@/lib/shipments/commands";
import { listTeam } from "@/lib/shipments/queries";
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
}

describe.skipIf(!hasDb)("listTeam", () => {
  it("shows the team to leads only", async () => {
    await resetDb();
    await seed();
    expect(await listTeam(viewer("member", "member"))).toEqual([]);
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
