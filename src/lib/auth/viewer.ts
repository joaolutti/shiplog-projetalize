/**
 * The signed-in user for pages, server actions and route handlers (the Data Access Layer
 * entry point). Reads the session per request, so callers sit behind <Suspense>.
 * The role is read from the database each time, so a role change applies immediately.
 */
import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
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

export const DEV_AS_COOKIE = "shiplog_dev_as";

/**
 * "Ver como" (docs/ARCHITECTURE.md §7): in development, a cookie can stand in for a session to
 * see the app as another user. Only for requests made on this machine: the dev server is also
 * reachable through the Cloudflare tunnel, and anything that came through it is refused.
 */
export function devImpersonationAllowed(h: Headers): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if ([...h.keys()].some((k) => k.startsWith("cf-"))) return false;
  const loopback = (ip: string) => ["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(ip.trim());
  const forwarded = h.get("x-forwarded-for");
  if (forwarded && !forwarded.split(",").every(loopback)) return false;
  const host = (h.get("host") ?? "").replace(/:\d+$/, "");
  return host === "localhost" || host === "127.0.0.1";
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const h = await headers();
  const session = await auth().api.getSession({ headers: h });
  const devAs = !session && devImpersonationAllowed(h) ? (await cookies()).get(DEV_AS_COOKIE)?.value : undefined;
  const userId = session?.user.id ?? devAs;
  if (!userId) return null;

  const [row] = await db()
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: user.role })
    .from(user)
    .where(eq(user.id, userId));
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
