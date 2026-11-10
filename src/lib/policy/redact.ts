/**
 * Redaction applied to everything sent to a model:
 *   - secret patterns (API keys, tokens, connection strings, private keys)
 *   - excluded paths (from data policy)
 *   - PII in issue text (emails, phone numbers: HubSpot-sourced bugs)
 *   - size cap: oversized diffs downgrade to `metadata`
 * Returns counts per rule for llm_audit_log.redactions.
 */
import { notImplemented } from "@/lib/not-implemented";

export interface RedactionResult {
  text: string;
  counts: Record<string, number>;
}

export function redactText(_text: string): RedactionResult {
  return notImplemented("redactText", "v1.5");
}
