/** Publish: web feed + channel card + requester DM (SCOPE.md §4, step 4). */
import { notImplemented } from "@/lib/not-implemented";

export async function publishShipment(
  _shipmentId: number,
  _via: "confirmed" | "auto" | "lead",
): Promise<void> {
  return notImplemented("publishShipment", "M3");
}
