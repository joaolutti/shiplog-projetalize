/**
 * Label conventions (SCOPE.md §4):
 *   "Development: Done"   → the only ship trigger
 *   "Branch: <name>"      → target branch (one shipment per ticket + branch)
 *   "Weight: <n>"         → mirrors the native weight field; native wins on mismatch
 */
import { notImplemented } from "@/lib/not-implemented";

export interface ParsedLabels {
  done: boolean;
  branches: string[];
  labelWeight: number | null;
}

export function parseLabels(_labels: string[]): ParsedLabels {
  return notImplemented("parseLabels", "M1");
}

/** True only when the Done label was *added* in this event (uses `changes.labels`). */
export function doneLabelAdded(_previous: string[], _current: string[]): boolean {
  return notImplemented("doneLabelAdded", "M1");
}

/** Branch labels added in this event: drives branch promotion. */
export function branchesAdded(_previous: string[], _current: string[]): string[] {
  return notImplemented("branchesAdded", "M1");
}
