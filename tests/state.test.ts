// Shipment state machine (docs/ARCHITECTURE.md §3, D40): the full transition table.
import { describe, expect, it } from "vitest";
import {
  gateStatus,
  transition,
  type GateContext,
  type ShipmentEvent,
  type ShipmentStatus,
} from "@/lib/shipments/state";

const ready: GateContext = { recipientUserId: "u1", branch: "Main", openMrCount: 0 };

describe("gateStatus", () => {
  it("runs recipient → branch → open MRs → draft", () => {
    expect(gateStatus({ recipientUserId: null, branch: null, openMrCount: 2 })).toBe("unclaimed");
    expect(gateStatus({ recipientUserId: "u1", branch: null, openMrCount: 2 })).toBe("needs_branch");
    expect(gateStatus({ recipientUserId: "u1", branch: "Main", openMrCount: 2 })).toBe(
      "awaiting_hold_decision",
    );
    expect(gateStatus(ready)).toBe("pending_confirmation");
  });
});

const STATUSES: ShipmentStatus[] = [
  "unclaimed",
  "needs_branch",
  "awaiting_hold_decision",
  "held",
  "pending_confirmation",
  "published",
];

// Expected result with all gates answerable (`ready`); "x" = invalid transition.
const TABLE: Record<ShipmentEvent, Record<ShipmentStatus, ShipmentStatus | "x">> = {
  assign_recipient: {
    unclaimed: "pending_confirmation",
    needs_branch: "x",
    awaiting_hold_decision: "x",
    held: "x",
    pending_confirmation: "x",
    published: "x",
  },
  pick_branch: {
    unclaimed: "pending_confirmation",
    needs_branch: "pending_confirmation",
    awaiting_hold_decision: "x",
    held: "x",
    pending_confirmation: "x",
    published: "x",
  },
  hold_until_merged: {
    unclaimed: "x",
    needs_branch: "x",
    awaiting_hold_decision: "held",
    held: "x",
    pending_confirmation: "x",
    published: "x",
  },
  publish_anyway: {
    unclaimed: "x",
    needs_branch: "x",
    awaiting_hold_decision: "pending_confirmation",
    held: "x",
    pending_confirmation: "x",
    published: "x",
  },
  release_held: {
    unclaimed: "x",
    needs_branch: "x",
    awaiting_hold_decision: "pending_confirmation",
    held: "pending_confirmation",
    pending_confirmation: "x",
    published: "x",
  },
  confirm: {
    unclaimed: "x",
    needs_branch: "x",
    awaiting_hold_decision: "x",
    held: "x",
    pending_confirmation: "published",
    published: "x",
  },
  auto_publish: {
    unclaimed: "x",
    needs_branch: "x",
    awaiting_hold_decision: "x",
    held: "x",
    pending_confirmation: "published",
    published: "x",
  },
  lead_publish: {
    unclaimed: "published",
    needs_branch: "published",
    awaiting_hold_decision: "published",
    held: "published",
    pending_confirmation: "published",
    published: "x",
  },
  reship: {
    unclaimed: "x",
    needs_branch: "x",
    awaiting_hold_decision: "x",
    held: "x",
    pending_confirmation: "x",
    published: "pending_confirmation",
  },
};

describe("transition table", () => {
  for (const [event, row] of Object.entries(TABLE) as Array<[ShipmentEvent, (typeof TABLE)[ShipmentEvent]]>) {
    for (const from of STATUSES) {
      const expected = row[from];
      it(`${from} --${event}--> ${expected === "x" ? "rejected" : expected}`, () => {
        const result = transition(from, event, ready);
        if (expected === "x") {
          expect(result).toEqual({ ok: false, error: { code: "invalid_transition", from, event } });
        } else {
          expect(result.ok && result.status).toBe(expected);
        }
      });
    }
  }
});

describe("transition details", () => {
  it("records how a shipment was published", () => {
    expect(transition("pending_confirmation", "confirm", ready)).toMatchObject({ publishedVia: "confirmed" });
    expect(transition("pending_confirmation", "auto_publish", ready)).toMatchObject({ publishedVia: "auto" });
    expect(transition("unclaimed", "lead_publish", ready)).toMatchObject({ publishedVia: "lead" });
  });

  it("answering a gate lands on the next gate that still applies", () => {
    expect(transition("needs_branch", "pick_branch", { ...ready, openMrCount: 1 })).toMatchObject({
      status: "awaiting_hold_decision",
    });
    expect(transition("unclaimed", "assign_recipient", { ...ready, branch: null })).toMatchObject({
      status: "needs_branch",
    });
    // A lead picking the branch of an unclaimed shipment leaves it unclaimed.
    expect(transition("unclaimed", "pick_branch", { ...ready, recipientUserId: null })).toMatchObject({
      status: "unclaimed",
    });
  });

  it("assign_recipient needs a recipient", () => {
    expect(transition("unclaimed", "assign_recipient", { ...ready, recipientUserId: null }).ok).toBe(false);
  });

  it("pick_branch and lead_publish need a branch", () => {
    const noBranch = { ...ready, branch: null };
    expect(transition("needs_branch", "pick_branch", noBranch)).toEqual({
      ok: false,
      error: { code: "branch_required" },
    });
    expect(transition("unclaimed", "lead_publish", noBranch)).toEqual({
      ok: false,
      error: { code: "branch_required" },
    });
  });

  it("release_held refuses while an MR is still open", () => {
    expect(transition("held", "release_held", { ...ready, openMrCount: 1 })).toEqual({
      ok: false,
      error: { code: "mrs_still_open", openMrCount: 1 },
    });
  });

  it("a re-ship starts again at the first open gate", () => {
    expect(transition("published", "reship", { ...ready, recipientUserId: null })).toMatchObject({
      status: "unclaimed",
    });
    expect(transition("published", "reship", { ...ready, openMrCount: 2 })).toMatchObject({
      status: "awaiting_hold_decision",
    });
  });
});
