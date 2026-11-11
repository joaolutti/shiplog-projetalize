/** Behaviour spec for the issue/MR template readers (SCOPE.md §5, D16 revised, D16a). */
import { describe, expect, it } from "vitest";
import { extractHubspotUrls, parseDeliveryNotes, parseRequester } from "@/lib/gitlab/templates";

describe("parseRequester", () => {
  it("reads a plain 'Solicitante:' line", () => {
    expect(parseRequester("Bug no login\n\nSolicitante: Ana Ribeiro\n")).toEqual({
      kind: "name",
      value: "Ana Ribeiro",
    });
  });

  it("reads bold forms", () => {
    expect(parseRequester("**Solicitante:** Ana")).toEqual({ kind: "name", value: "Ana" });
    expect(parseRequester("**Solicitante**: Ana")).toEqual({ kind: "name", value: "Ana" });
    expect(parseRequester("- solicitante: João Évora")).toEqual({ kind: "name", value: "João Évora" });
  });

  it("reads a Slack @handle", () => {
    expect(parseRequester("Solicitante: @ana.ribeiro")).toEqual({ kind: "handle", value: "ana.ribeiro" });
  });

  it("treats empty, '-' and 'N/A' as no requester", () => {
    expect(parseRequester("Solicitante:")).toBeNull();
    expect(parseRequester("Solicitante: -")).toBeNull();
    expect(parseRequester("Solicitante: N/A")).toBeNull();
    expect(parseRequester("**Solicitante:** ")).toBeNull();
  });

  it("ignores template hints in HTML comments", () => {
    expect(parseRequester("Solicitante: <!-- nome de quem pediu -->")).toBeNull();
  });

  it("reads the team template's table (Solicitante column, first data row)", () => {
    const description = [
      "Contexto do chamado.",
      "",
      "|**Solicitante**|**Origem**|**Cliente**|**Empreendimento**|",
      "|-----------------|---------------|-------------|--------------------|",
      "|Ana Ribeiro|Suporte|Construtora X|-|",
      "| **Urgência** | **Projeto** | **Módulo** | **Tipo** |",
    ].join("\n");
    expect(parseRequester(description)).toEqual({ kind: "name", value: "Ana Ribeiro" });
  });

  it("reads the table column wherever it is, and treats '-' or a missing row as none", () => {
    const table = (row: string) =>
      ["| **Origem** | **Solicitante** |", "|:---|:---:|", row].join("\n");
    expect(parseRequester(table("| Suporte | @ana.ribeiro |"))).toEqual({ kind: "handle", value: "ana.ribeiro" });
    expect(parseRequester(table("| Suporte | - |"))).toBeNull();
    expect(parseRequester("| **Solicitante** |\n|---|")).toBeNull();
  });

  it("ignores a table header without the separator row", () => {
    expect(parseRequester("| Solicitante | Origem |\n| Ana | Suporte |")).toBeNull();
  });

  it("returns null when the line is missing or the word is only prose", () => {
    expect(parseRequester(null)).toBeNull();
    expect(parseRequester("Nova tela de relatórios")).toBeNull();
    expect(parseRequester("Solicitantes do cliente pediram isso")).toBeNull();
  });
});

describe("parseDeliveryNotes", () => {
  const mr = [
    "## O que mudou",
    "Refatoração interna.",
    "",
    "## Notas de entrega",
    "<!-- o que o usuário vai notar -->",
    "Corrige o login com SSO.",
    "",
    "- Também ajusta o logout",
    "### Detalhe",
    "Subseção continua dentro.",
    "## Checklist",
    "- [x] testes",
  ].join("\n");

  it("returns the section body up to the next heading of the same level", () => {
    expect(parseDeliveryNotes(mr)).toBe(
      "Corrige o login com SSO.\n\n- Também ajusta o logout\n### Detalhe\nSubseção continua dentro.",
    );
  });

  it("returns null when the section is missing or only has the template hint", () => {
    expect(parseDeliveryNotes("## Checklist\n- [ ] testes")).toBeNull();
    expect(parseDeliveryNotes("## Notas de entrega\n<!-- escreva aqui -->\n## Checklist")).toBeNull();
    expect(parseDeliveryNotes(null)).toBeNull();
  });
});

describe("extractHubspotUrls", () => {
  it("finds HubSpot links once each", () => {
    const text =
      "Ticket https://app.hubspot.com/contacts/123/ticket/456 e (https://app.hubspot.com/contacts/123/ticket/456)";
    expect(extractHubspotUrls(text)).toEqual(["https://app.hubspot.com/contacts/123/ticket/456"]);
  });
});
