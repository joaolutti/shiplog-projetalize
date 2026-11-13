/**
 * Reads the team's issue and MR templates (SCOPE.md §5, D16 revised, D16a):
 *   issue: optional "Solicitante: <name>" line (or "@handle")
 *   MR:    "## Notas de entrega" section
 *
 * Pure functions over Markdown descriptions. HTML comments (template hints) are ignored.
 */

export type RequesterRef = { kind: "name"; value: string } | { kind: "handle"; value: string };

const NO_REQUESTER = new Set(["", "-", "—", "n/a", "na", "nenhum", "não se aplica"]);

function stripComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

// Cells of a Markdown table row, or null when the line isn't one.
function tableCells(line: string | undefined): string[] | null {
  const t = line?.trim() ?? "";
  if (!t.startsWith("|")) return null;
  return t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

const unemphasize = (s: string) => s.replace(/^[*_]+|[*_]+$/g, "").trim();

/**
 * The team's issue template puts it in a table: a header row with a "Solicitante" column,
 * the separator row, then the data row. Returns the cell, or null when there's no such table.
 */
function requesterFromTable(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const column = tableCells(lines[i])?.findIndex((c) => unemphasize(c).toLowerCase() === "solicitante");
    if (column === undefined || column < 0) continue;
    const separator = tableCells(lines[i + 1]);
    if (!separator?.every((c) => /^:?-+:?$/.test(c))) continue;
    return tableCells(lines[i + 2])?.[column] ?? "";
  }
  return null;
}

/**
 * Requester from the issue description, in either form:
 *   table:  | **Solicitante** | **Origem** | …  /  |---|---| …  /  | Ana Ribeiro | Suporte | …
 *   line:   `Solicitante: Ana Ribeiro`, `**Solicitante:** Ana`, `Solicitante: @ana.ribeiro`
 * Null when absent or empty.
 */
export function parseRequester(description: string | null | undefined): RequesterRef | null {
  if (!description) return null;
  const text = stripComments(description);
  const line = text.match(/^[\s>*_-]*solicitante\s*(?::\s*[*_]*|[*_]+\s*:)[ \t]*(.*)$/im)?.[1];
  const raw = line ?? requesterFromTable(text.split(/\r?\n/));
  if (raw === null) return null;

  const value = unemphasize(raw);
  if (NO_REQUESTER.has(value.toLowerCase())) return null;

  const handle = value.match(/^@([\w.-]+)$/);
  if (handle) return { kind: "handle", value: handle[1] };
  return { kind: "name", value };
}

// Body of the `## Notas de entrega` section (any heading level), or null when missing or empty.
export function parseDeliveryNotes(description: string | null | undefined): string | null {
  if (!description) return null;
  const lines = stripComments(description).split(/\r?\n/);

  const start = lines.findIndex((l) => /^#{1,6}\s+notas de entrega\s*:?\s*#*\s*$/i.test(l.trim()));
  if (start === -1) return null;
  const level = lines[start].trim().match(/^#+/)![0].length;

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const heading = line.trim().match(/^(#{1,6})\s/);
    if (heading && heading[1].length <= level) break;
    body.push(line);
  }

  const text = body.join("\n").trim();
  return text === "" ? null : text;
}

// HubSpot links in an issue (displayed only; no HubSpot integration). The template's "Link do card
// no Hubspot" line wins; attachments (file previews) are never linked.
export function extractHubspotUrls(description: string | null | undefined): string[] {
  if (!description) return [];
  const find = (text: string) =>
    [...new Set(text.match(/https?:\/\/[\w.-]*hubspot\.com\/[^\s)>\]"'`]*/gi) ?? [])].filter((u) => !/\/file-preview\//i.test(u));
  const card = find(description.match(/^.*card no hubspot.*$/im)?.[0] ?? "");
  return card.length ? card : find(description);
}
