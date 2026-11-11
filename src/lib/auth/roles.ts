/** Role changes (D17). Only leads change roles; the last lead can't step down. */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { CommandError, type Actor } from "@/lib/shipments/commands";
import type { Role } from "./viewer";

export async function setRole(args: { actor: Actor; userId: string; role: Role }): Promise<void> {
  if (args.actor.kind !== "user" || args.actor.role !== "lead") {
    throw new CommandError("forbidden", "only leads change roles");
  }

  await db().transaction(async (tx) => {
    const [target] = await tx.select({ role: user.role }).from(user).where(eq(user.id, args.userId)).for("update");
    if (!target) throw new CommandError("not_found", `user ${args.userId} not found`);

    if (target.role === "lead" && args.role !== "lead") {
      const others = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, "lead"), ne(user.id, args.userId)))
        .for("update");
      if (others.length === 0) throw new CommandError("forbidden", "the last lead can't step down");
    }

    await tx.update(user).set({ role: args.role }).where(eq(user.id, args.userId));
  });
}
