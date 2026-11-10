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

/** `Solicitante: Ana Ribeiro`, `**Solicitante:** Ana`, `Solicitante: @ana.ribeiro`. Null when absent or empty. */
export function parseRequester(description: string | null | undefined): RequesterRef | null {
  if (!description) return null;
  const match = stripComments(description).match(
    /^[\s>*_-]*solicitante\s*(?::\s*[*_]*|[*_]+\s*:)[ \t]*(.*)$/im,
  );
  if (!match) return null;

  const value = match[1].replace(/[*_]+$/g, "").replace(/^[*_]+/g, "").trim();
  if (NO_REQUESTER.has(value.toLowerCase())) return null;

  const handle = value.match(/^@([\w.-]+)$/);
  if (handle) return { kind: "handle", value: handle[1] };
  return { kind: "name", value };
}

/** Body of the `## Notas de entrega` section (any heading level), or null when missing or empty. */
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

/** HubSpot links referenced in an issue (displayed only; no HubSpot integration). */
export function extractHubspotUrls(description: string | null | undefined): string[] {
  if (!description) return [];
  const urls = description.match(/https?:\/\/[\w.-]*hubspot\.com\/[^\s)>\]"']*/gi) ?? [];
  return [...new Set(urls)];
}
