/**
 * Who may sign in and who may connect GitLab (D14, D15). Called by Better Auth's
 * `user.validateUserInfo` just before it creates a user, links an account or signs in.
 *
 *   Slack:  everyone signs in with it, but only from our workspace (team ID check).
 *   GitLab: never signs in or creates a user; only links to a signed-in user, and only
 *           for members of the top-level group.
 *   Other:  rejected.
 */
import { env } from "@/lib/env";
import { getMemberAccessLevel, GitlabApiError } from "@/lib/gitlab/client";

export type IdentityAction = "create-user" | "link-account" | "sign-in";

export interface IdentitySource {
  action: IdentityAction;
  oauth?: { providerId: string; profile?: Record<string, unknown> };
}

export type IdentityRejection = { error: string; message: string };

export interface IdentityRules {
  slackTeamId: string;
  isOrgMember: (gitlabUserId: number) => Promise<boolean>;
}

/** Slack's OIDC claim for the workspace. */
const SLACK_TEAM_CLAIM = "https://slack.com/team_id";

export async function checkIdentity(
  source: IdentitySource,
  rules: IdentityRules,
): Promise<IdentityRejection | undefined> {
  const provider = source.oauth?.providerId;
  const profile = source.oauth?.profile ?? {};

  if (provider === "slack") {
    if (profile[SLACK_TEAM_CLAIM] !== rules.slackTeamId) {
      return { error: "wrong_workspace", message: "Entre com a sua conta do Slack da empresa." };
    }
    return undefined;
  }

  if (provider === "gitlab") {
    if (source.action !== "link-account") {
      return {
        error: "gitlab_link_only",
        message: "Entre com o Slack e conecte o GitLab em Configurações.",
      };
    }
    const gitlabUserId = Number(profile.id);
    if (!Number.isInteger(gitlabUserId) || !(await rules.isOrgMember(gitlabUserId))) {
      return { error: "not_in_group", message: "Essa conta do GitLab não faz parte do grupo da empresa." };
    }
    return undefined;
  }

  return { error: "provider_not_allowed", message: "Use o Slack para entrar." };
}

/** Developer access or above. Guests and minimal access don't count as team members. */
const DEVELOPER = 30;

/**
 * Member of GITLAB_GROUP_PATH (inherited included). When the token can't list group
 * members (403, a project token in development), GITLAB_MEMBERSHIP_PROJECT is checked.
 */
export async function isOrgMember(gitlabUserId: number): Promise<boolean> {
  try {
    const level = await getMemberAccessLevel({ group: env("GITLAB_GROUP_PATH") }, gitlabUserId);
    return level !== null && level >= DEVELOPER;
  } catch (err) {
    const fallback = env("GITLAB_MEMBERSHIP_PROJECT");
    if (!(err instanceof GitlabApiError && err.status === 403 && fallback)) throw err;
    const level = await getMemberAccessLevel({ project: fallback }, gitlabUserId);
    return level !== null && level >= DEVELOPER;
  }
}

export function identityRules(): IdentityRules {
  return { slackTeamId: env("SLACK_TEAM_ID"), isOrgMember };
}
