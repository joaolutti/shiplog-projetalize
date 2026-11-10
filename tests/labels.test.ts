/** Behaviour spec for M1 label handling: fill in as parseLabels & co. are implemented. */
import { describe, it } from "vitest";

describe("parseLabels", () => {
  it.todo("detects 'Development: Done'");
  it.todo("extracts every 'Branch: X' label");
  it.todo("parses 'Weight: 5' and ignores non-numeric weights");
});

describe("doneLabelAdded", () => {
  it.todo("is true only when Done is in current and not in previous labels");
  it.todo("is false on unrelated label edits of an already-Done issue");
});

describe("branchesAdded", () => {
  it.todo("returns 'Main' when Branch: Main is added to a ticket already shipped to Staging");
  it.todo("returns nothing when a branch label is removed and re-added (no duplicate shipment)");
});
