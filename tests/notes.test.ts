// LLM notes draft (D50): policy, redaction and audit log around the model call, and the fallback.
import { MockLanguageModelV4 } from "ai/test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { llmAuditLog } from "@/lib/db/schema";
import { draftNotes, type NotesSource } from "@/lib/notes/draft";
import { hasDb, resetDb } from "./helpers/db";

const source: NotesSource = {
  issue: {
    projectPath: "p1429/predialize",
    iid: 5129,
    title: "Produção - Bug: Alta > PDF > Manuais > Lista de sistemas não ordena títulos com acento",
    description: "Cliente ana@cliente.com.br relatou: a lista sai fora de ordem.<!-- dica do template -->",
  },
  mrs: [{ projectPath: "p1429/predialize", iid: 12, title: "Ordena com localeCompare", notes: null }],
};

function model(reply: () => string) {
  let prompt = "";
  let providerOptions: unknown;
  const m = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompt = JSON.stringify(options.prompt);
      providerOptions = options.providerOptions;
      return {
        content: [{ type: "text", text: reply() }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 30, text: 30, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { m, prompt: () => prompt, providerOptions: () => providerOptions };
}

beforeAll(() => {
  process.env.LLM_ENABLED = "true";
  process.env.LLM_MODEL = "test/model";
});

describe.skipIf(!hasDb)("draftNotes", () => {
  beforeEach(resetDb);

  it("returns the model's text, sends redacted issue text and logs the call", async () => {
    const notes = "A lista de sistemas do manual agora ordena corretamente títulos com acento no PDF.";
    const { m, prompt, providerOptions } = model(() => `"${notes}"\n`);
    expect(await draftNotes(source, "fallback", m)).toBe(notes);
    // Reasoning models would spend the token budget thinking and return no text.
    expect(providerOptions()).toEqual({ openrouter: { reasoning: { enabled: false } } });

    expect(prompt()).toContain("[email]");
    expect(prompt()).not.toContain("ana@cliente");
    expect(prompt()).not.toContain("dica do template");
    expect(prompt()).toContain("Ordena com localeCompare");

    const [row] = await db().select().from(llmAuditLog);
    expect(row).toMatchObject({
      purpose: "notes_draft",
      model: "test/model",
      redactions: { email: 1 },
      inputTokens: 120,
      outputTokens: 30,
      error: null,
      sources: [
        { project: "p1429/predialize", iid: 5129, kind: "issue", level: "metadata" },
        { project: "p1429/predialize", iid: 12, kind: "mr", level: "metadata" },
      ],
    });
    expect(row.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back and logs the error when the model fails or answers badly", async () => {
    const failing = model(() => {
      throw new Error("429 rate limited");
    });
    expect(await draftNotes(source, "fallback", failing.m)).toBe("fallback");
    expect(await draftNotes(source, "fallback", model(() => "  ").m)).toBe("fallback");
    const rows = await db().select().from(llmAuditLog);
    expect(rows.map((r) => Boolean(r.error))).toEqual([true, true]);
  });
});
