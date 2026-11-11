"use server";
import { refresh } from "next/cache";
import { actorOf, requireViewer } from "@/lib/auth/viewer";
import { db } from "@/lib/db/client";
import { assignRecipient, leadPublish } from "@/lib/shipments/commands";

/** Leads only (enforced in the commands). M3 sends the follow-up DMs. */
export async function assignAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = Number(formData.get("shipmentId"));
  const userId = String(formData.get("userId") ?? "");
  if (!Number.isInteger(shipmentId) || !userId) return;
  const step = await db().transaction((tx) =>
    assignRecipient(tx, { actor: actorOf(viewer), shipmentId, userId }),
  );
  console.log(`[unclaimed] assign ${shipmentId}:`, JSON.stringify(step));
  refresh();
}

export async function publishAction(formData: FormData) {
  const viewer = await requireViewer();
  const shipmentId = Number(formData.get("shipmentId"));
  if (!Number.isInteger(shipmentId)) return;
  const step = await db().transaction((tx) => leadPublish(tx, { actor: actorOf(viewer), shipmentId }));
  console.log(`[unclaimed] publish ${shipmentId}:`, JSON.stringify(step));
  refresh();
}
