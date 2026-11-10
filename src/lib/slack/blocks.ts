/**
 * Block Kit builders. Action IDs are the contract between the messages we send
 * and /api/slack/interactions, so they're defined once here.
 */
import { notImplemented } from "@/lib/not-implemented";

export const ACTIONS = {
  confirmPublish: "shipment.confirm_publish",
  editNotes: "shipment.edit_notes",
  addComment: "shipment.add_comment",
  holdUntilMerged: "shipment.hold_until_merged",
  publishAnyway: "shipment.publish_anyway",
  pickBranch: "shipment.pick_branch",
  weightAgree: "weight.agree",
  weightKeepAssigned: "weight.keep_assigned",
  weightOther: "weight.other",
  verify: "shipment.verify",
  reportIssue: "shipment.report_issue",
  requestReverification: "shipment.request_reverification",
} as const;

export type ActionId = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Dev DM: draft + Confirm / Edit / Comment (+ weight opinion in v1.5). */
export function draftDmBlocks(_shipmentId: number): unknown[] {
  return notImplemented("draftDmBlocks", "M3");
}

/** Nudge: open MRs remain, or no Branch label. */
export function nudgeBlocks(_kind: "open_mrs" | "missing_branch", _shipmentId: number): unknown[] {
  return notImplemented("nudgeBlocks", "M3");
}

/** Read-only channel card: same shape as today's message, plus "Open in Shiplog". */
export function feedCardBlocks(_shipmentId: number): unknown[] {
  return notImplemented("feedCardBlocks", "M3");
}

/** Requester DM: "Your fix shipped to <branch>" + Verify / Open. */
export function requesterDmBlocks(_shipmentId: number): unknown[] {
  return notImplemented("requesterDmBlocks", "M3");
}
