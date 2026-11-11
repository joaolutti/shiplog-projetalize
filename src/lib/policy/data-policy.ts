/**
 * Per-repo LLM data policy from config/data-policy.yaml (SCOPE.md §8).
 * Deny-by-default: unknown namespaces resolve to `default`.
 */
import { notImplemented } from "@/lib/not-implemented";

export type PolicyLevel = "diff" | "metadata" | "excluded";

export interface DataPolicy {
  default: PolicyLevel;
  groups: Record<string, PolicyLevel>;
  projects: Record<string, PolicyLevel>;
  excludePaths: string[];
  maxDiffBytes: number;
}

export function loadDataPolicy(_path = "config/data-policy.yaml"): DataPolicy {
  return notImplemented("loadDataPolicy", "v1.5");
}

// Most specific wins: project → deepest matching group → default.
export function resolvePolicy(_policy: DataPolicy, _projectPath: string): PolicyLevel {
  return notImplemented("resolvePolicy", "v1.5");
}
