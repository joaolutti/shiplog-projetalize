/**
 * Label conventions (SCOPE.md §4):
 *   "Development: Done"   → the only ship trigger
 *   "Branch: <name>"      → target branch (one shipment per ticket + branch)
 *   "Weight: <n>"         → mirrors the native weight field; native wins on mismatch
 *
 * Pure functions over label titles. Webhook payloads carry label objects; callers map
 * them to `title` first. Matching ignores case and surrounding whitespace.
 */
import { env } from "@/lib/env";

export interface ParsedLabels {
  done: boolean;
  branches: string[];
  labelWeight: number | null;
}

export interface LabelConfig {
  done: string;
  branchPrefix: string;
  weightPrefix: string;
}

export function labelConfig(): LabelConfig {
  return {
    done: env("LABEL_DONE"),
    branchPrefix: env("LABEL_BRANCH_PREFIX"),
    weightPrefix: env("LABEL_WEIGHT_PREFIX"),
  };
}

/** Value after `prefix` when `label` starts with it, else null. */
function valueAfter(label: string, prefix: string): string | null {
  const l = label.trim();
  const p = prefix.trim().toLowerCase();
  if (!l.toLowerCase().startsWith(p)) return null;
  return l.slice(p.length).trim();
}

export function parseLabels(labels: string[], config: LabelConfig = labelConfig()): ParsedLabels {
  const done = labels.some((l) => l.trim().toLowerCase() === config.done.trim().toLowerCase());

  const branches: string[] = [];
  for (const label of labels) {
    const name = valueAfter(label, config.branchPrefix);
    if (name && !branches.some((b) => b.toLowerCase() === name.toLowerCase())) branches.push(name);
  }

  let labelWeight: number | null = null;
  for (const label of labels) {
    const value = valueAfter(label, config.weightPrefix);
    if (value && /^\d+$/.test(value)) {
      labelWeight = Number(value);
      break;
    }
  }

  return { done, branches, labelWeight };
}

/** True only when the Done label was *added* in this event (uses `changes.labels`). */
export function doneLabelAdded(
  previous: string[],
  current: string[],
  config: LabelConfig = labelConfig(),
): boolean {
  return !parseLabels(previous, config).done && parseLabels(current, config).done;
}

/**
 * Branch labels added in this event: drives branch promotion. A label present in both
 * lists is not "added". A remove in one event and re-add in a later one does return the
 * branch again; the (ticket, branch) unique index keeps that from duplicating a shipment.
 */
export function branchesAdded(
  previous: string[],
  current: string[],
  config: LabelConfig = labelConfig(),
): string[] {
  const before = parseLabels(previous, config).branches.map((b) => b.toLowerCase());
  return parseLabels(current, config).branches.filter((b) => !before.includes(b.toLowerCase()));
}
