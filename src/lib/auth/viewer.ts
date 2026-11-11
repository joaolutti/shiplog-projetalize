/**
 * The signed-in user for pages, server actions and route handlers (the Data Access Layer
 * entry point). Reads the session per request, so callers sit behind <Suspense>.
 * The role is read from the database each time, so a role change applies immediately.
 */
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db/client";
import { account, user } from "@/lib/db/schema";
import type { Actor } from "@/lib/shipments/commands";
import { auth } from "./auth";

export type Role = "member" | "dev" | "lead";

export interface Viewer {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  // Linked GitLab user ID, or null before "Conectar GitLab".
  gitlabId: number | null;
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const [row] = await db()
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: user.role })
    .from(user)
    .where(eq(user.id, session.user.id));
  if (!row) return null;

  const [gitlab] = await db()
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, row.id), eq(account.providerId, "gitlab")));

  return { ...row, gitlabId: gitlab ? Number(gitlab.accountId) : null };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

// Sends viewers without one of `roles` back to the feed.
export async function requireRole(...roles: Role[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!roles.includes(viewer.role)) redirect("/");
  return viewer;
}

export function actorOf(viewer: Viewer): Actor {
  return { kind: "user", userId: viewer.id, role: viewer.role };
}
