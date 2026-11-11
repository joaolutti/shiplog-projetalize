"use server";
/**
 * Web mutations: each re-checks the session, then runs one command and queues its follow-ups
 * (the same commands the Slack buttons use, D39).
 */
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { actorOf, requireViewer } from "@/lib/auth/viewer";
import { addComment, CommandError, reportIssue, requestReverification, unverify, verify } from "@/lib/shipments/commands";
import { execute } from "@/lib/shipments/effects";

export async function signOutAction() {
  await auth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

const id = (formData: FormData, key: string) => {
  const n = Number(formData.get(key));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function verifyAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = id(formData, "shipmentId");
  if (!shipmentId) return;
  await execute((tx) => verify(tx, { actor: actorOf(viewer), shipmentId }));
  refresh();
}

export async function unverifyAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = id(formData, "shipmentId");
  if (!shipmentId) return;
  await execute((tx) => unverify(tx, { actor: actorOf(viewer), shipmentId }));
  refresh();
}

export async function reportAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = id(formData, "shipmentId");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!shipmentId || !comment) return;
  await execute((tx) => reportIssue(tx, { actor: actorOf(viewer), shipmentId, comment, source: "web" }));
  refresh();
}

export async function commentAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = id(formData, "shipmentId");
  const body = String(formData.get("body") ?? "").trim();
  if (!shipmentId || !body) return;
  await execute(async (tx) => (await addComment(tx, { actor: actorOf(viewer), shipmentId, body, source: "web" })).step);
  refresh();
}

export async function reverifyAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = id(formData, "shipmentId");
  if (!shipmentId) return;
  try {
    await execute((tx) => requestReverification(tx, { actor: actorOf(viewer), shipmentId }));
  } catch (err) {
    // The button only shows for the recipient and leads; anyone else gets nothing.
    if (!(err instanceof CommandError)) throw err;
  }
  refresh();
}
