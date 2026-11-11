/**
 * Read models for pages (docs/ARCHITECTURE.md §2). Each takes the viewer and returns only
 * what that role may see. No function groups by person (D24).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { account, shipments, tickets, user } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/viewer";

export interface UnclaimedShipment {
  id: number;
  branch: string | null;
  createdAt: Date;
  // GitLab user the shipment was meant for (assignee → MR author → label applier).
  intendedGitlabId: number | null;
  ticket: { iid: number; title: string; webUrl: string; projectPath: string };
}

// Leads only; empty for anyone else. Oldest first.
export async function listUnclaimed(viewer: Viewer): Promise<UnclaimedShipment[]> {
  if (viewer.role !== "lead") return [];
  const rows = await db()
    .select({
      id: shipments.id,
      branch: shipments.branch,
      createdAt: shipments.createdAt,
      intendedGitlabId: shipments.recipientGitlabId,
      iid: tickets.iid,
      title: tickets.title,
      webUrl: tickets.webUrl,
      projectPath: tickets.projectPath,
    })
    .from(shipments)
    .innerJoin(tickets, eq(tickets.id, shipments.ticketId))
    .where(eq(shipments.status, "unclaimed"))
    .orderBy(asc(shipments.createdAt));
  return rows.map(({ iid, title, webUrl, projectPath, ...s }) => ({
    ...s,
    ticket: { iid, title, webUrl, projectPath },
  }));
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Viewer["role"];
  gitlabId: number | null;
}

// Leads see everyone (to manage roles); others see nobody. Sorted by name.
export async function listTeam(viewer: Viewer): Promise<TeamMember[]> {
  if (viewer.role !== "lead") return [];
  const users = await db()
    .select({ id: user.id, name: user.name, email: user.email, role: user.role })
    .from(user)
    .orderBy(asc(user.name));
  const links = await db()
    .select({ userId: account.userId, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.providerId, "gitlab"),
        inArray(
          account.userId,
          users.map((u) => u.id),
        ),
      ),
    );
  const gitlabByUser = new Map(links.map((l) => [l.userId, Number(l.accountId)]));
  return users.map((u) => ({ ...u, gitlabId: gitlabByUser.get(u.id) ?? null }));
}

// Who a lead can assign an unclaimed shipment to: devs and leads with GitLab linked.
export async function listAssignable(viewer: Viewer): Promise<TeamMember[]> {
  return (await listTeam(viewer)).filter((m) => m.role !== "member" && m.gitlabId !== null);
}
