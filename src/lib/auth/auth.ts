/**
 * Better Auth (M2, D14–D17):
 *   - Slack (OIDC) is the only way to sign in, restricted to SLACK_TEAM_ID
 *   - GitLab (read_user) is linked once from Sua conta; group members only.
 *     Linking promotes a `member` to `dev`. Leads are set by a lead or scripts/set-role.ts.
 *   - Drizzle adapter over src/lib/db/auth-schema.ts; `user.role` is an additional field
 *
 * Created lazily, so `next build` works without secrets.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, session, user, verification } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { checkIdentity, identityRules } from "./identity";

function create() {
  return betterAuth({
    baseURL: env("APP_URL"),
    secret: env("BETTER_AUTH_SECRET"),
    database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification } }),
    user: {
      additionalFields: {
        role: { type: ["member", "dev", "lead"], required: false, defaultValue: "member", input: false },
      },
      validateUserInfo: async ({ source }) => checkIdentity(source, identityRules()),
    },
    account: {
      accountLinking: {
        enabled: true,
        // Slack sign-in attaches to a user created by scripts/link-gitlab.ts with the same email.
        trustedProviders: ["slack"],
        // GitLab accounts often use a personal email. Linking still needs a Slack session
        // and group membership (identity.ts).
        allowDifferentEmails: true,
      },
    },
    socialProviders: {
      slack: { clientId: env("SLACK_CLIENT_ID"), clientSecret: env("SLACK_CLIENT_SECRET") },
      gitlab: {
        clientId: env("GITLAB_OAUTH_CLIENT_ID"),
        clientSecret: env("GITLAB_OAUTH_CLIENT_SECRET"),
        disableSignUp: true,
        // GitLab's /api/v4/user has no email_verified, so Better Auth would treat every GitLab
        // email as unverified and refuse to link. confirmed_at is set once the email is confirmed.
        mapProfileToUser: (profile) => ({ emailVerified: Boolean(profile.confirmed_at) }),
      },
    },
    databaseHooks: {
      account: {
        create: {
          // Connecting GitLab (only possible for group members) makes a member a dev (D17).
          after: async (created) => {
            if (created.providerId !== "gitlab") return;
            await db()
              .update(user)
              .set({ role: "dev" })
              .where(and(eq(user.id, created.userId), eq(user.role, "member")));
          },
        },
      },
    },
    onAPIError: { errorURL: "/sign-in" },
    plugins: [nextCookies()], // must stay last
  });
}

let instance: ReturnType<typeof create> | undefined;

export function auth() {
  instance ??= create();
  return instance;
}
