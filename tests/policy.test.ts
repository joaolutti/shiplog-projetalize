/** Behaviour spec for v1.5 data policy + redaction (SCOPE.md §8). */
import { describe, it } from "vitest";

describe("resolvePolicy", () => {
  it.todo("falls back to default for unknown namespaces (deny by default)");
  it.todo("project rule beats subgroup rule beats group rule");
  it.todo("applies each MR's own repo policy on multi-repo tickets");
});

describe("redactText", () => {
  it.todo("removes API keys, tokens, connection strings and private keys");
  it.todo("removes emails and phone numbers from issue text");
  it.todo("drops excluded paths and downgrades oversized diffs to metadata");
});
