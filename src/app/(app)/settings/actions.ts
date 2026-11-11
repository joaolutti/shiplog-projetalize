"use server";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { setRole } from "@/lib/auth/roles";
import { actorOf, requireViewer, type Role } from "@/lib/auth/viewer";

// "Conectar GitLab" (D15): links the GitLab account to the signed-in user.
export async function connectGitlab() {
  await requireViewer();
  const { url } = await auth().api.linkSocialAccount({
    headers: await headers(),
    body: { provider: "gitlab", callbackURL: "/settings", errorCallbackURL: "/settings" },
  });
  redirect(url);
}

const ROLES: Role[] = ["member", "dev", "lead"];

// Leads only (enforced in setRole).
export async function changeRole(formData: FormData) {
  const viewer = await requireViewer();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!userId || !ROLES.includes(role)) return;
  await setRole({ actor: actorOf(viewer), userId, role });
  refresh();
}
