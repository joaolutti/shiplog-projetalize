/**
 * Redaction applied to everything sent to a model:
 *   - secret patterns (API keys, tokens, connection strings, private keys)
 *   - PII in issue text (emails, phone numbers: HubSpot-sourced bugs)
 * Returns counts per rule for llm_audit_log.redactions. Excluded paths and the diff size cap
 * apply to diffs, which nothing sends yet (weight review, after v1).
 */

export interface RedactionResult {
  text: string;
  counts: Record<string, number>;
}

// In order: a private key or connection string must go before its parts look like other matches.
const RULES: Array<[rule: string, pattern: RegExp, replacement: string]> = [
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[chave privada]"],
  ["connection_string", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@\S+/gi, "[conexão]"],
  [
    "token",
    /\b(?:glpat-[\w-]{20,}|xox[abpors]-[\w-]{10,}|sk-[\w-]{20,}|gh[pousr]_\w{30,}|github_pat_\w{30,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g,
    "[token]",
  ],
  ["secret", /\b(api[_-]?key|secret|token|password|senha)(\s*[:=]\s*)\S+/gi, "$1$2[segredo]"],
  ["email", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  ["phone", /(?:\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}\b/g, "[telefone]"],
];

export function redactText(text: string): RedactionResult {
  const counts: Record<string, number> = {};
  let out = text;
  for (const [rule, pattern, replacement] of RULES) {
    out = out.replace(pattern, (...m) => {
      counts[rule] = (counts[rule] ?? 0) + 1;
      return replacement.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
    });
  }
  return { text: out, counts };
}
