/** Who may sign in and connect GitLab (D14, D15). */
import { describe, expect, it, vi } from "vitest";
import { checkIdentity, type IdentityRules, type IdentitySource } from "@/lib/auth/identity";

const rules = (members: number[] = [11]): IdentityRules => ({
  slackTeamId: "T123",
  isOrgMember: vi.fn(async (id: number) => members.includes(id)),
});

const slack = (action: IdentitySource["action"], team: string): IdentitySource => ({
  action,
  oauth: { providerId: "slack", profile: { "https://slack.com/team_id": team } },
});

const gitlab = (action: IdentitySource["action"], id: number): IdentitySource => ({
  action,
  oauth: { providerId: "gitlab", profile: { id, username: "dev" } },
});

describe("checkIdentity", () => {
  it("lets our Slack workspace sign in and sign up", async () => {
    expect(await checkIdentity(slack("create-user", "T123"), rules())).toBeUndefined();
    expect(await checkIdentity(slack("sign-in", "T123"), rules())).toBeUndefined();
  });

  it("rejects other Slack workspaces, including on later sign-ins", async () => {
    expect(await checkIdentity(slack("create-user", "T999"), rules())).toMatchObject({ error: "wrong_workspace" });
    expect(await checkIdentity(slack("sign-in", "T999"), rules())).toMatchObject({ error: "wrong_workspace" });
    expect(
      await checkIdentity({ action: "sign-in", oauth: { providerId: "slack", profile: {} } }, rules()),
    ).toMatchObject({ error: "wrong_workspace" });
  });

  it("never lets GitLab create a user or sign in", async () => {
    expect(await checkIdentity(gitlab("create-user", 11), rules())).toMatchObject({ error: "gitlab_link_only" });
    expect(await checkIdentity(gitlab("sign-in", 11), rules())).toMatchObject({ error: "gitlab_link_only" });
  });

  it("links GitLab only for group members", async () => {
    const r = rules([11]);
    expect(await checkIdentity(gitlab("link-account", 11), r)).toBeUndefined();
    expect(await checkIdentity(gitlab("link-account", 22), r)).toMatchObject({ error: "not_in_group" });
    expect(r.isOrgMember).toHaveBeenCalledWith(22);
  });

  it("rejects any other provider or method", async () => {
    expect(await checkIdentity({ action: "create-user" }, rules())).toMatchObject({ error: "provider_not_allowed" });
    expect(
      await checkIdentity({ action: "sign-in", oauth: { providerId: "google" } }, rules()),
    ).toMatchObject({ error: "provider_not_allowed" });
  });
});
