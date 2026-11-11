"use server";
import { refresh } from "next/cache";
import { actorOf, requireViewer } from "@/lib/auth/viewer";
import { assignRecipient, leadPublish } from "@/lib/shipments/commands";
import { execute } from "@/lib/shipments/effects";

/** Leads only (enforced in the commands). The follow-up DMs are queued by execute. */
export async function assignAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = Number(formData.get("shipmentId"));
  const userId = String(formData.get("userId") ?? "");
  if (!Number.isInteger(shipmentId) || !userId) return;
  await execute((tx) => assignRecipient(tx, { actor: actorOf(viewer), shipmentId, userId }));
  refresh();
}

export async function publishAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = Number(formData.get("shipmentId"));
  if (!Number.isInteger(shipmentId)) return;
  await execute((tx) => leadPublish(tx, { actor: actorOf(viewer), shipmentId }));
  refresh();
}
