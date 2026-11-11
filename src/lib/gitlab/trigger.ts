/**
 * What makes an issue ship (D2, revised by D44): the "Development: Done" label, or a work
 * item Status in STATUS_TRIGGERS (default "Done", "Deployed Main", "Deployed Staging").
 *
 * A "Deployed <branch>" status also names the branch, so it ships there without a Branch
 * label. Otherwise the branches come from the "Branch: X" labels.
 *
 * Pure functions. Status comes from the webhook payload: the REST API doesn't return it.
 */
import { env } from "@/lib/env";
import { labelConfig, parseLabels, type LabelConfig } from "./labels";

export interface TriggerConfig {
  labels: LabelConfig;
  statuses: string[];
  deployedPrefix: string;
}

export function triggerConfig(): TriggerConfig {
  return {
    labels: labelConfig(),
    statuses: env("STATUS_TRIGGERS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    deployedPrefix: env("STATUS_DEPLOYED_PREFIX"),
  };
}

export interface ShipState {
  /** Done label present or a trigger Status set. */
  triggered: boolean;
  /** Where it ships: the Deployed status's branch, else the Branch labels. */
  branches: string[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function shipState(
  labels: string[],
  status: string | null,
  config: TriggerConfig = triggerConfig(),
): ShipState {
  const parsed = parseLabels(labels, config.labels);
  const statusTriggers = status !== null && config.statuses.some((s) => same(s, status));

  const prefix = config.deployedPrefix.trim().toLowerCase();
  const statusBranch =
    statusTriggers && status.trim().toLowerCase().startsWith(prefix)
      ? status.trim().slice(prefix.length).trim()
      : "";

  return {
    triggered: parsed.done || statusTriggers,
    branches: statusBranch ? [statusBranch] : parsed.branches,
  };
}

export interface ShipChange {
  /** Became triggered in this event: ship every branch (or ask for one). Re-ships a published branch. */
  started: boolean;
  /** Already triggered, and these branches are new (branch promotion). */
  newBranches: string[];
}

export function shipChange(previous: ShipState, current: ShipState): ShipChange {
  const started = !previous.triggered && current.triggered;
  const newBranches =
    current.triggered && !started
      ? current.branches.filter((b) => !previous.branches.some((p) => same(p, b)))
      : [];
  return { started, newBranches };
}
