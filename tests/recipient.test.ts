// Recipient resolution (D4 order, first linked candidate).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { account, user } from "@/lib/db/schema";
import { candidateOrder, pickRecipient, resolveRecipient } from "@/lib/shipments/recipient";
import { hasDb, resetDb } from "./helpers/db";

const candidates = { assigneeGitlabIds: [11], mrAuthorGitlabIds: [22, 11], labelAppliedByGitlabId: 33 };

describe("pickRecipient", () => {
  it("orders assignee → MR author → label applier without repeats", () => {
    expect(candidateOrder(candidates)).toEqual([11, 22, 33]);
  });

  it("prefers the issue assignee", () => {
    const linked = new Map([[11, "u11"], [22, "u22"], [33, "u33"]]);
    expect(pickRecipient(candidates, linked)).toEqual({ gitlabId: 11, userId: "u11" });
  });

  it("falls back to the linked MR author, then to the label applier", () => {
    expect(pickRecipient(candidates, new Map([[22, "u22"], [33, "u33"]]))).toEqual({
      gitlabId: 22,
      userId: "u22",
    });
    expect(pickRecipient(candidates, new Map([[33, "u33"]]))).toEqual({ gitlabId: 33, userId: "u33" });
  });

  it("returns null when no candidate is linked", () => {
    expect(pickRecipient(candidates, new Map())).toBeNull();
  });

  it("returns null when there are no candidates at all", () => {
    expect(
      pickRecipient({ assigneeGitlabIds: [], mrAuthorGitlabIds: [], labelAppliedByGitlabId: null }, new Map()),
    ).toBeNull();
  });
});

describe.skipIf(!hasDb)("resolveRecipient (database)", () => {
  beforeEach(async () => {
    await resetDb();
    await db().insert(user).values({ id: "u22", email: "dev22@example.com", name: "Dev 22", role: "dev" });
    await db().insert(account).values([
      { id: "a1", accountId: "22", providerId: "gitlab", userId: "u22" },
      // A Slack account with the same numeric-looking ID must not count as a GitLab link.
      { id: "a2", accountId: "11", providerId: "slack", userId: "u22" },
    ]);
  });

  it("resolves through GitLab links only", async () => {
    expect(await resolveRecipient(candidates)).toEqual({ gitlabId: 22, userId: "u22" });
  });
});
