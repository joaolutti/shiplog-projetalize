// Ship trigger: Done label or a trigger Status (D44).
import { describe, expect, it } from "vitest";
import { shipChange, shipState, type TriggerConfig } from "@/lib/gitlab/trigger";

const config: TriggerConfig = {
  labels: { done: "Development: Done", branchPrefix: "Branch: ", weightPrefix: "Weight: " },
  statuses: ["Done", "Deployed Main", "Deployed Staging"],
  deployedPrefix: "Deployed ",
};
const state = (labels: string[], status: string | null) => shipState(labels, status, config);

describe("shipState", () => {
  it("is triggered by the Done label or a trigger status", () => {
    expect(state(["Development: Done"], "In progress").triggered).toBe(true);
    expect(state([], "Done").triggered).toBe(true);
    expect(state([], "deployed main").triggered).toBe(true);
    expect(state(["Development: Doing"], "In progress").triggered).toBe(false);
    expect(state([], null).triggered).toBe(false);
  });

  it("ignores done-category statuses that aren't configured", () => {
    expect(state([], "Development Done").triggered).toBe(false);
    expect(state([], "Deployed Develop").triggered).toBe(false);
  });

  it("takes the branch from a Deployed status, else from Branch labels", () => {
    expect(state(["Branch: Staging"], "Deployed Main").branches).toEqual(["Main"]);
    expect(state(["Branch: Staging", "Branch: Main"], "Done").branches).toEqual(["Staging", "Main"]);
    expect(state([], "Done").branches).toEqual([]);
  });
});

describe("shipChange", () => {
  it("starts when an issue becomes triggered", () => {
    expect(shipChange(state([], "In progress"), state([], "Deployed Staging"))).toEqual({
      started: true,
      newBranches: [],
    });
  });

  it("promotes Deployed Staging → Deployed Main as a new branch", () => {
    expect(shipChange(state([], "Deployed Staging"), state([], "Deployed Main"))).toEqual({
      started: false,
      newBranches: ["Main"],
    });
  });

  it("doesn't start again when the trigger switches from label to status", () => {
    expect(
      shipChange(state(["Development: Done", "Branch: Main"], "In progress"), state(["Development: Done", "Branch: Main"], "Done")),
    ).toEqual({ started: false, newBranches: [] });
  });

  it("does nothing when an issue leaves the trigger", () => {
    expect(shipChange(state([], "Deployed Main"), state([], "In progress"))).toEqual({
      started: false,
      newBranches: [],
    });
  });
});
