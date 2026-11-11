// Behaviour spec for M1 label handling (SCOPE.md §4).
import { describe, expect, it } from "vitest";
import { branchesAdded, doneLabelAdded, parseLabels, type LabelConfig } from "@/lib/gitlab/labels";

const config: LabelConfig = {
  done: "Development: Done",
  branchPrefix: "Branch: ",
  weightPrefix: "Weight: ",
};

describe("parseLabels", () => {
  it("detects 'Development: Done'", () => {
    expect(parseLabels(["Development: Done"], config).done).toBe(true);
    expect(parseLabels(["development: done "], config).done).toBe(true);
    expect(parseLabels(["Development: Doing"], config).done).toBe(false);
  });

  it("extracts every 'Branch: X' label", () => {
    const parsed = parseLabels(["Branch: Staging", "Bug", "Branch: Main", "branch: main"], config);
    expect(parsed.branches).toEqual(["Staging", "Main"]);
  });

  it("ignores an empty 'Branch:' label", () => {
    expect(parseLabels(["Branch:"], config).branches).toEqual([]);
  });

  it("parses 'Weight: 5' and ignores non-numeric weights", () => {
    expect(parseLabels(["Weight: 5"], config).labelWeight).toBe(5);
    expect(parseLabels(["Weight: big"], config).labelWeight).toBeNull();
    expect(parseLabels(["Weight: big", "Weight: 8"], config).labelWeight).toBe(8);
    expect(parseLabels([], config).labelWeight).toBeNull();
  });
});

describe("doneLabelAdded", () => {
  it("is true only when Done is in current and not in previous labels", () => {
    expect(doneLabelAdded(["Branch: Main"], ["Branch: Main", "Development: Done"], config)).toBe(true);
    expect(doneLabelAdded(["Development: Done"], [], config)).toBe(false);
  });

  it("is false on unrelated label edits of an already-Done issue", () => {
    expect(
      doneLabelAdded(["Development: Done"], ["Development: Done", "Bug"], config),
    ).toBe(false);
  });
});

describe("branchesAdded", () => {
  it("returns 'Main' when Branch: Main is added to a ticket already shipped to Staging", () => {
    expect(
      branchesAdded(
        ["Development: Done", "Branch: Staging"],
        ["Development: Done", "Branch: Staging", "Branch: Main"],
        config,
      ),
    ).toEqual(["Main"]);
  });

  it("returns nothing when a branch label is in both lists (no duplicate shipment)", () => {
    expect(branchesAdded(["Branch: Main"], ["Branch: Main", "Bug"], config)).toEqual([]);
    expect(branchesAdded(["Branch: Main"], ["branch: main"], config)).toEqual([]);
  });

  it("returns nothing when a branch label is removed", () => {
    expect(branchesAdded(["Branch: Main"], [], config)).toEqual([]);
  });
});
