/**
 * Until M2 ("Connect GitLab"), links a GitLab user to a Shiplog user by hand, so ingest
 * can resolve recipients. Use the person's Slack email: M2's Slack sign-in links to the
 * same user by email.
 *
 *   bun run scripts/link-gitlab.ts <gitlab-user-id> <email> "<name>" [member|dev|lead]
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, user } from "@/lib/db/schema";

const [gitlabId, email, name, role = "dev"] = process.argv.slice(2);
if (!gitlabId || !/^\d+$/.test(gitlabId) || !email || !name) {
  console.error('usage: bun run scripts/link-gitlab.ts <gitlab-user-id> <email> "<name>" [member|dev|lead]');
  process.exit(1);
}
if (!["member", "dev", "lead"].includes(role)) {
  console.error(`unknown role: ${role}`);
  process.exit(1);
}

const [existing] = await db().select().from(user).where(eq(user.email, email));
const userId = existing?.id ?? randomUUID();
if (!existing) {
  // Marked verified: a lead vouches for the email, so Slack sign-in with it attaches here.
  await db()
    .insert(user)
    .values({ id: userId, email, name, emailVerified: true, role: role as "member" | "dev" | "lead" });
}

await db()
  .insert(account)
  .values({ id: randomUUID(), accountId: gitlabId, providerId: "gitlab", userId })
  .onConflictDoUpdate({ target: [account.providerId, account.accountId], set: { userId } });

console.log(`linked GitLab user ${gitlabId} → ${email} (${userId}${existing ? ", existing" : ", new"})`);
process.exit(0);
