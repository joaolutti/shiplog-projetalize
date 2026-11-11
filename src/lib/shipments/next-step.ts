// What should happen after ingest or a command. effects.ts turns these into jobs in the same transaction.
import type { ShipmentStatus } from "./state";

export type NextStep =
  | { kind: "unclaimed"; shipmentId: number }
  | { kind: "nudge_missing_branch"; shipmentId: number }
  | { kind: "nudge_open_mrs"; shipmentId: number; openMrIds: number[] }
  | { kind: "send_draft"; shipmentId: number; weightMismatch: WeightMismatch | null }
  | { kind: "held"; shipmentId: number }
  | { kind: "published"; shipmentId: number }
  // Notes or requester changed while the shipment waits or after it published: refresh messages.
  | { kind: "refresh"; shipmentId: number }
  | { kind: "verification_changed"; shipmentId: number }
  | { kind: "issue_reported"; shipmentId: number; commentId: number }
  | { kind: "comment_added"; shipmentId: number; commentId: number }
  | { kind: "reverification_requested"; shipmentId: number; commentId: number }
  | { kind: "noop"; reason: string };

// Native weight field vs `Weight: X` label. The native field wins; the dev DM says so (D21).
export interface WeightMismatch {
  native: number;
  label: number;
}

export function weightMismatch(native: number | null, label: number | null): WeightMismatch | null {
  return native !== null && label !== null && native !== label ? { native, label } : null;
}

export function nextStepFor(
  shipmentId: number,
  status: ShipmentStatus,
  extra: { openMrIds: number[]; weightMismatch: WeightMismatch | null },
): NextStep {
  switch (status) {
    case "unclaimed":
      return { kind: "unclaimed", shipmentId };
    case "needs_branch":
      return { kind: "nudge_missing_branch", shipmentId };
    case "awaiting_hold_decision":
      return { kind: "nudge_open_mrs", shipmentId, openMrIds: extra.openMrIds };
    case "pending_confirmation":
      return { kind: "send_draft", shipmentId, weightMismatch: extra.weightMismatch };
    case "held":
      return { kind: "held", shipmentId };
    case "published":
      return { kind: "published", shipmentId };
  }
}
