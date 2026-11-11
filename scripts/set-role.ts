/**
 * Sets a user's role by email, e.g. to make the first lead before anyone can use
 * Configurações. The user must have signed in once (or been created by link-gitlab.ts).
 *
 *   bun run scripts/set-role.ts <email> <member|dev|lead>
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";

const [email, role] = process.argv.slice(2);
if (!email || !["member", "dev", "lead"].includes(role ?? "")) {
  console.error("usage: bun run scripts/set-role.ts <email> <member|dev|lead>");
  process.exit(1);
}

const updated = await db()
  .update(user)
  .set({ role: role as "member" | "dev" | "lead" })
  .where(eq(user.email, email))
  .returning({ id: user.id });
console.log(updated.length ? `${email} → ${role}` : `no user with email ${email}`);
process.exit(updated.length ? 0 : 1);
