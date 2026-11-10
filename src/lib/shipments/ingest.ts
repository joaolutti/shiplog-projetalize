/**
 * Turns a stored GitLab event into ticket/shipment state (SCOPE.md §4, step 2).
 *
 * Issue Hook:
 *   - Done label added      → upsert ticket, upsert shipment per Branch label, decide next step
 *   - Branch label added    → (ticket already Done) new shipment for that branch
 *   - reopened              → mark shipments "re-ship pending" in timeline
 * Merge Request Hook:
 *   - update MR state on shipment_merge_requests; release "held" shipments when all are merged
 */
import { notImplemented } from "@/lib/not-implemented";

export type NextStep =
  | { kind: "nudge_missing_branch"; shipmentId: number }
  | { kind: "nudge_open_mrs"; shipmentId: number; openMrIds: number[] }
  | { kind: "unclaimed"; shipmentId: number }
  | { kind: "send_draft"; shipmentId: number }
  | { kind: "noop"; reason: string };

export async function ingestGitlabEvent(_eventId: number): Promise<NextStep[]> {
  return notImplemented("ingestGitlabEvent", "M1");
}
