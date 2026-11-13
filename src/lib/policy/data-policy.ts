/**
 * Per-repo LLM data policy from config/data-policy.yaml (SCOPE.md §8).
 * Deny-by-default: unknown namespaces resolve to `default`.
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

export type PolicyLevel = "diff" | "metadata" | "excluded";

export interface DataPolicy {
  default: PolicyLevel;
  groups: Record<string, PolicyLevel>;
  projects: Record<string, PolicyLevel>;
  excludePaths: string[];
  maxDiffBytes: number;
}

const level = z.enum(["diff", "metadata", "excluded"]);
const file = z.object({
  default: level,
  // An all-commented section parses as null.
  groups: z.record(z.string(), level).nullish(),
  projects: z.record(z.string(), level).nullish(),
  exclude_paths: z.array(z.string()).nullish(),
  max_diff_bytes: z.number().int().positive(),
});

export function loadDataPolicy(path = "config/data-policy.yaml"): DataPolicy {
  const raw = file.parse(parse(readFileSync(path, "utf8")));
  return {
    default: raw.default,
    groups: raw.groups ?? {},
    projects: raw.projects ?? {},
    excludePaths: raw.exclude_paths ?? [],
    maxDiffBytes: raw.max_diff_bytes,
  };
}

// Most specific wins: project → deepest matching group → default.
export function resolvePolicy(policy: DataPolicy, projectPath: string): PolicyLevel {
  const path = projectPath.toLowerCase();
  const lower = (rules: Record<string, PolicyLevel>) => Object.entries(rules).map(([k, v]) => [k.toLowerCase(), v] as const);
  const project = lower(policy.projects).find(([k]) => k === path);
  if (project) return project[1];
  const group = lower(policy.groups)
    .filter(([k]) => path.startsWith(`${k}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return group?.[1] ?? policy.default;
}
