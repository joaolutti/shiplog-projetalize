/**
 * Shipment state machine (docs/ARCHITECTURE.md §3, D40). Pure: no I/O.
 *
 * Gates run in order: recipient → branch → open MRs → draft. A new shipment, and every
 * transition that answers a gate, lands on the first gate that still applies.
 */
import type { shipmentStatus } from "@/lib/db/schema";

export type ShipmentStatus = (typeof shipmentStatus.enumValues)[number];
export type PublishedVia = "confirmed" | "auto" | "lead";

export interface GateContext {
  recipientUserId: string | null;
  branch: string | null;
  /** Related MRs still open. MRs closed without merging don't count. */
  openMrCount: number;
}

export type ShipmentEvent =
  | "assign_recipient"
  | "pick_branch"
  | "hold_until_merged"
  | "publish_anyway"
  | "release_held"
  | "confirm"
  | "auto_publish"
  | "lead_publish"
  | "reship";

export type TransitionError =
  | { code: "invalid_transition"; from: ShipmentStatus; event: ShipmentEvent }
  | { code: "mrs_still_open"; openMrCount: number }
  | { code: "branch_required" };

export type TransitionResult =
  | { ok: true; status: ShipmentStatus; publishedVia?: PublishedVia }
  | { ok: false; error: TransitionError };

/** The first gate that applies; `pending_confirmation` when all are answered. */
export function gateStatus(ctx: GateContext): ShipmentStatus {
  if (!ctx.recipientUserId) return "unclaimed";
  if (ctx.branch === null) return "needs_branch";
  if (ctx.openMrCount > 0) return "awaiting_hold_decision";
  return "pending_confirmation";
}

const ok = (status: ShipmentStatus, publishedVia?: PublishedVia): TransitionResult =>
  publishedVia ? { ok: true, status, publishedVia } : { ok: true, status };

export function transition(
  from: ShipmentStatus,
  event: ShipmentEvent,
  ctx: GateContext,
): TransitionResult {
  const invalid: TransitionResult = { ok: false, error: { code: "invalid_transition", from, event } };

  switch (event) {
    case "assign_recipient":
      return from === "unclaimed" && ctx.recipientUserId ? ok(gateStatus(ctx)) : invalid;

    case "pick_branch":
      if (from !== "needs_branch" && !(from === "unclaimed" && ctx.branch !== null)) return invalid;
      if (ctx.branch === null) return { ok: false, error: { code: "branch_required" } };
      return ok(gateStatus(ctx));

    case "hold_until_merged":
      return from === "awaiting_hold_decision" ? ok("held") : invalid;

    case "publish_anyway":
      return from === "awaiting_hold_decision" ? ok("pending_confirmation") : invalid;

    case "release_held":
      // An unanswered hold question is moot once every MR has merged, so it releases too.
      if (from !== "held" && from !== "awaiting_hold_decision") return invalid;
      if (ctx.openMrCount > 0) {
        return { ok: false, error: { code: "mrs_still_open", openMrCount: ctx.openMrCount } };
      }
      return ok("pending_confirmation");

    case "confirm":
      return from === "pending_confirmation" ? ok("published", "confirmed") : invalid;

    case "auto_publish":
      return from === "pending_confirmation" ? ok("published", "auto") : invalid;

    case "lead_publish":
      if (from === "published") return invalid;
      if (ctx.branch === null) return { ok: false, error: { code: "branch_required" } };
      return ok("published", "lead");

    case "reship":
      // D7: reopened and marked Done again on the same branch → a new draft cycle.
      return from === "published" ? ok(gateStatus(ctx)) : invalid;
  }
}
