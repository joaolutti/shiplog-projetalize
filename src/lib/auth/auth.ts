/**
 * Better Auth (M2):
 *   - socialProviders.slack  → everyone; restrict to SLACK_TEAM_ID
 *   - socialProviders.gitlab → "Connect GitLab" via account linking (devs + leads), read_user;
 *                              verify membership of GITLAB_GROUP_PATH on link
 *   - drizzle adapter over src/lib/db/auth-schema.ts
 *   - user.role as an additional field (member | dev | lead)
 */
import { notImplemented } from "@/lib/not-implemented";

export function auth(): never {
  return notImplemented("Better Auth configuration", "M2");
}
