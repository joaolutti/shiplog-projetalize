/**
 * LLM draft of the shipping notes: the quoted line of the channel announcement (D50), written the
 * way the team's `pdz-generate-slack-communication` skill does it. The dev confirms or edits it
 * in the DM before it's published.
 *
 * Every call goes through the data policy and redaction (SCOPE.md §8) and is logged in
 * llm_audit_log. Any failure, a disabled LLM or an excluded project returns the fallback (today's notes).
 */
import { createHash } from "node:crypto";
import { generateText, type LanguageModel } from "ai";
import { db } from "@/lib/db/client";
import { llmAuditLog } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { languageModel } from "@/lib/llm/provider";
import { loadDataPolicy, resolvePolicy } from "@/lib/policy/data-policy";
import { redactText } from "@/lib/policy/redact";

export interface NotesSource {
  issue: { projectPath: string; iid: number; title: string; description: string | null };
  // MRs still relevant to the shipment (not closed), with their "## Notas de entrega" if any.
  mrs: Array<{ projectPath: string; iid: number; title: string; notes: string | null }>;
}

// Issue templates can be long; the gist is near the top.
const MAX_DESCRIPTION = 6000;

const SYSTEM = `Você escreve a descrição do anúncio de uma entrega no canal do Slack da Predialize: a linha
citada logo abaixo do título da task. Quem lê é o time (suporte, CS, produto), não só devs.

Regras:
- Português do Brasil, de 1 a 3 frases curtas, em tom informativo.
- Diga o que mudou ou foi corrigido para quem usa a plataforma, usando só o texto recebido. Não invente
  detalhes, telas, números ou causas que não estejam nele.
- Se houver notas de entrega do dev, elas são a base: corrija o português e melhore a legibilidade, sem
  mudar o sentido nem acrescentar informação.
- Sem notas, use o título e a descrição da issue. Num bug, diga o que agora funciona como deveria.
- Não repita o caminho do título ("Produção - Bug: Alta > PDF > ..."), nem links, nomes de pessoas ou de
  clientes, nem trechos substituídos como [email] ou [telefone].
- Responda só com o texto da descrição: sem introdução, markdown, emojis ou aspas em volta.

Exemplo: das notas "agora as informacoes da unidade sobe pro manual" sai
"Agora as informações da unidade são enviadas para o manual."`;

export async function draftNotes(source: NotesSource, fallback: string, model?: LanguageModel): Promise<string> {
  if (!env("LLM_ENABLED")) return fallback;
  const policy = loadDataPolicy();
  // Issue text follows the issue's project policy; each MR its own (SCOPE.md §8).
  const issueLevel = resolvePolicy(policy, source.issue.projectPath);
  if (issueLevel === "excluded") return fallback;
  const mrs = source.mrs
    .map((mr) => ({ ...mr, level: resolvePolicy(policy, mr.projectPath) }))
    .filter((mr) => mr.level !== "excluded");

  const redactions: Record<string, number> = {};
  const clean = (text: string) => {
    const r = redactText(text);
    for (const [rule, n] of Object.entries(r.counts)) redactions[rule] = (redactions[rule] ?? 0) + n;
    return r.text;
  };
  const description = (source.issue.description ?? "").replace(/<!--[\s\S]*?-->/g, "").trim().slice(0, MAX_DESCRIPTION);
  const prompt = [
    `Título da task: ${clean(source.issue.title)}`,
    `Descrição da issue:\n${description ? clean(description) : "(vazia)"}`,
    mrs.length
      ? `Notas de entrega dos MRs:\n${mrs.map((mr) => `- ${clean(mr.notes ?? mr.title)}`).join("\n")}`
      : "Notas de entrega dos MRs: (nenhuma)",
  ].join("\n\n");

  const payload = `${SYSTEM}\n\n${prompt}`;
  const audit = {
    purpose: "notes_draft",
    provider: env("LLM_PROVIDER_NAME"),
    model: env("LLM_MODEL") ?? "(unset)",
    sources: [
      { project: source.issue.projectPath, iid: source.issue.iid, kind: "issue" as const, level: issueLevel },
      ...mrs.map((mr) => ({ project: mr.projectPath, iid: mr.iid, kind: "mr" as const, level: mr.level })),
    ],
    redactions,
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    payloadBytes: Buffer.byteLength(payload),
  };

  const started = Date.now();
  try {
    const result = await generateText({
      model: model ?? languageModel(),
      system: SYSTEM,
      prompt,
      // Plain text, not a JSON schema: most free models don't support structured outputs (D52).
      maxOutputTokens: 1000,
      // Reasoning models otherwise spend the whole budget thinking and return no text. Sent to OpenRouter only.
      providerOptions: { openrouter: { reasoning: { enabled: false } } },
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30_000),
    });
    const notes = result.text.trim().replace(/^["“']([\s\S]*)["”']$/, "$1").trim();
    if (!notes || notes.length > 1000) throw new Error(`unusable answer (${notes.length} chars)`);
    await db()
      .insert(llmAuditLog)
      .values({
        ...audit,
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        latencyMs: Date.now() - started,
      });
    return notes;
  } catch (err) {
    console.warn(`[notes] draft for ${source.issue.projectPath}#${source.issue.iid} failed; using the fallback`, err);
    await db()
      .insert(llmAuditLog)
      .values({ ...audit, latencyMs: Date.now() - started, error: String(err).slice(0, 500) })
      .catch(() => undefined);
    return fallback;
  }
}
