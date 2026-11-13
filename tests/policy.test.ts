// Data policy + redaction (SCOPE.md §8).
import { describe, expect, it } from "vitest";
import { loadDataPolicy, resolvePolicy, type DataPolicy } from "@/lib/policy/data-policy";
import { redactText } from "@/lib/policy/redact";

const policy: DataPolicy = {
  default: "metadata",
  groups: { acme: "diff", "acme/infra": "excluded" },
  projects: { "acme/infra/docs": "metadata" },
  excludePaths: [],
  maxDiffBytes: 1000,
};

describe("resolvePolicy", () => {
  it("falls back to default for unknown namespaces (deny by default)", () => {
    expect(resolvePolicy(policy, "other/app")).toBe("metadata");
    expect(resolvePolicy(policy, "acmecorp/app")).toBe("metadata");
  });

  it("project rule beats subgroup rule beats group rule", () => {
    expect(resolvePolicy(policy, "acme/app")).toBe("diff");
    expect(resolvePolicy(policy, "acme/infra/terraform")).toBe("excluded");
    expect(resolvePolicy(policy, "ACME/infra/docs")).toBe("metadata");
  });

  it("loads the repo's config file", () => {
    expect(loadDataPolicy().default).toBe("metadata");
  });

  it.todo("applies each MR's own repo policy on multi-repo tickets (weight review, after v1)");
});

describe("redactText", () => {
  it("removes API keys, tokens, connection strings and private keys", () => {
    const text = [
      "token glpat-abcdefghijklmnopqrstuv e xoxb-1234567890-abc",
      "postgres://app:s3cr3t@db.internal:5432/prod",
      "OPENROUTER api_key=sk-or-v1-abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
    ].join("\n");
    const r = redactText(text);
    expect(r.text).not.toMatch(/glpat-|xoxb-|s3cr3t|sk-or|MIIE/);
    expect(r.text).toContain("api_key=[segredo]");
    expect(r.counts).toMatchObject({ token: 3, connection_string: 1, secret: 1, private_key: 1 });
  });

  it("removes emails and phone numbers from issue text", () => {
    const r = redactText("Cliente ana.ribeiro@cliente.com.br ligou de (11) 91234-5678 e +55 21 3456-7890.");
    expect(r.text).toBe("Cliente [email] ligou de [telefone] e [telefone].");
    expect(r.counts).toEqual({ email: 1, phone: 2 });
  });

  it("leaves ordinary text alone", () => {
    const text = "Lista de sistemas no Manual não ordena títulos com acento (#5129), versão 2.4.1.";
    expect(redactText(text)).toEqual({ text, counts: {} });
  });

  it.todo("drops excluded paths and downgrades oversized diffs to metadata (weight review, after v1)");
});
