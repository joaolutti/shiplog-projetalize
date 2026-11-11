/**
 * Block Kit builders (pt-BR, D37). Action IDs and modal callback IDs are the contract between
 * the messages we send and /api/slack/interactions, so they're defined once here.
 *
 * Builders are pure: they take a ShipmentView (lib/shipments/view.ts) and return a message,
 * so they're snapshot-tested and shown in /dev/slack-preview without Slack.
 */
import type { ActionsBlock, Button, KnownBlock, ModalView } from "@slack/types";
import type { SlackMessage } from "./client";

export const ACTIONS = {
  confirmPublish: "shipment.confirm_publish",
  editNotes: "shipment.edit_notes",
  addComment: "shipment.add_comment",
  holdUntilMerged: "shipment.hold_until_merged",
  publishAnyway: "shipment.publish_anyway",
  pickBranch: "shipment.pick_branch",
  pickRequester: "shipment.pick_requester",
  pickMentions: "shipment.pick_mentions",
  weightAgree: "weight.agree",
  weightKeepAssigned: "weight.keep_assigned",
  weightOther: "weight.other",
  verify: "shipment.verify",
  reportIssue: "shipment.report_issue",
  requestReverification: "shipment.request_reverification",
  // Link buttons: Slack still sends a block_action, which is acknowledged and ignored.
  openLink: "shipment.open_link",
} as const;

export type ActionId = (typeof ACTIONS)[keyof typeof ACTIONS];

// Modal submissions: callback_id, with the shipment ID in private_metadata.
export const MODALS = {
  editNotes: "modal.edit_notes",
  addComment: "modal.add_comment",
  reportIssue: "modal.report_issue",
} as const;

export type ModalId = (typeof MODALS)[keyof typeof MODALS];

// Block ID prefixes of the pickers in the draft DM (select menus carry no value of their own).
export const REQUESTER_BLOCK = "requester:";
export const MENTIONS_BLOCK = "mentions:";

// Field IDs inside the modals (block_id and action_id).
export const FIELDS = { text: "text" } as const;

export interface ShipmentView {
  id: number;
  status: "unclaimed" | "needs_branch" | "awaiting_hold_decision" | "held" | "pending_confirmation" | "published";
  branch: string | null;
  notes: string | null;
  publishedVia: "confirmed" | "auto" | "lead" | null;
  // Page on the web app.
  url: string;
  ticket: {
    iid: number;
    title: string;
    webUrl: string;
    projectPath: string;
    nativeWeight: number | null;
    labelWeight: number | null;
  };
  requester:
    | { kind: "none" }
    | { kind: "resolved"; slackUserId: string }
    | { kind: "unresolved"; raw: string };
  mergeRequests: Array<{ ref: string; title: string; webUrl: string; state: string }>;
  // Slack users the dev chose to @mention on the channel card.
  mentions: string[];
  // GitLab user it was meant for, when unclaimed.
  intendedGitlabId: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

// Escapes text for mrkdwn (&, <, >).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const issueLink = (v: ShipmentView) => `<${v.ticket.webUrl}|#${v.ticket.iid} ${esc(v.ticket.title)}>`;

// Slack rejects a section over 3000 characters; this leaves room for a short heading.
const MAX_QUOTE = 2800;

// Quoted, escaped text, cut to MAX_QUOTE without splitting an escape like `&amp;`.
const quote = (text: string) => {
  const quoted = esc(text)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return quoted.length <= MAX_QUOTE ? quoted : `${quoted.slice(0, MAX_QUOTE).replace(/&[a-z]*$/, "")}…`;
};

function button(text: string, actionId: ActionId, value: string, style?: "primary" | "danger"): Button {
  return { type: "button", text: { type: "plain_text", text, emoji: true }, action_id: actionId, value, ...(style ? { style } : {}) };
}

function linkButton(text: string, url: string): Button {
  return { type: "button", text: { type: "plain_text", text, emoji: true }, action_id: ACTIONS.openLink, url };
}

function actions(blockId: string, elements: Button[]): ActionsBlock {
  return { type: "actions", block_id: blockId, elements };
}

function context(text: string): KnownBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

function section(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function requesterText(v: ShipmentView): string | null {
  switch (v.requester.kind) {
    case "resolved":
      return `Solicitante: <@${v.requester.slackUserId}>`;
    case "unresolved":
      return `Solicitante: "${esc(v.requester.raw)}" (não encontrado no Slack)`;
    case "none":
      return null;
  }
}

function mrText(v: ShipmentView): string | null {
  if (v.mergeRequests.length === 0) return null;
  return `MRs: ${v.mergeRequests.map((mr) => `<${mr.webUrl}|${esc(mr.ref)}> (${mr.state})`).join(", ")}`;
}

function detailsContext(v: ShipmentView): KnownBlock[] {
  const parts = [v.ticket.projectPath, mrText(v), requesterText(v)].filter(Boolean) as string[];
  return [context(parts.join(" · "))];
}

// "cc @a @b" for the people the dev tagged, or null.
function mentionsText(v: ShipmentView): string | null {
  return v.mentions.length ? `cc ${v.mentions.map((id) => `<@${id}>`).join(" ")}` : null;
}

function notesBlock(v: ShipmentView): KnownBlock {
  return section(`*Notas da entrega*\n${v.notes ? quote(v.notes) : "_Sem notas._"}`);
}

// ── Recipient DM: one message per shipment, updated in place as the status changes ──

// The recipient's DM for the shipment's current status.
export function recipientDm(v: ShipmentView, opts: { branchChoices: string[]; autoPublishHours: number }): SlackMessage {
  switch (v.status) {
    case "needs_branch":
      return missingBranchDm(v, opts.branchChoices);
    case "awaiting_hold_decision":
      return openMrsDm(v);
    case "held":
      return heldDm(v);
    case "pending_confirmation":
      return draftDm(v, opts.autoPublishHours);
    case "published":
      return publishedDm(v);
    case "unclaimed":
      // No recipient yet; leads get leadsUnclaimedDm instead.
      return { text: `Entrega sem responsável: #${v.ticket.iid}`, blocks: [section(`Entrega sem responsável: ${issueLink(v)}`)] };
  }
}

function missingBranchDm(v: ShipmentView, branchChoices: string[]): SlackMessage {
  return {
    text: `Para qual branch foi #${v.ticket.iid}?`,
    blocks: [
      section(`:compass: ${issueLink(v)} foi marcada como pronta, mas não tem o rótulo \`Branch:\`.\n*Para qual branch foi a entrega?*`),
      ...detailsContext(v),
      actions(
        "branch",
        branchChoices.map((b) => button(b, ACTIONS.pickBranch, JSON.stringify({ shipmentId: v.id, branch: b }))),
      ),
    ],
  };
}

function openMrsDm(v: ShipmentView): SlackMessage {
  const open = v.mergeRequests.filter((mr) => mr.state === "opened" || mr.state === "locked");
  return {
    text: `#${v.ticket.iid} ainda tem MRs abertos`,
    blocks: [
      section(
        `:hourglass_flowing_sand: ${issueLink(v)} → *${esc(v.branch ?? "?")}* foi marcada como pronta, mas ainda tem MRs abertos: ${open
          .map((mr) => `<${mr.webUrl}|${esc(mr.ref)}>`)
          .join(", ")}.`,
      ),
      ...detailsContext(v),
      actions("hold", [
        button("Aguardar o merge", ACTIONS.holdUntilMerged, String(v.id), "primary"),
        button("Publicar mesmo assim", ACTIONS.publishAnyway, String(v.id)),
      ]),
    ],
  };
}

function heldDm(v: ShipmentView): SlackMessage {
  return {
    text: `Aguardando o merge de #${v.ticket.iid}`,
    blocks: [
      section(`:hourglass: ${issueLink(v)} → *${esc(v.branch ?? "?")}*: aguardando o merge dos MRs abertos. O rascunho chega aqui logo depois.`),
      ...detailsContext(v),
    ],
  };
}

function draftDm(v: ShipmentView, autoPublishHours: number): SlackMessage {
  const blocks: KnownBlock[] = [
    section(`:package: *Entregando para ${esc(v.branch ?? "?")}*\n${issueLink(v)}`),
    ...detailsContext(v),
    notesBlock(v),
  ];

  const { nativeWeight, labelWeight } = v.ticket;
  if (nativeWeight !== null && labelWeight !== null && nativeWeight !== labelWeight) {
    blocks.push(context(`:scales: O peso no GitLab é ${nativeWeight}, mas o rótulo diz ${labelWeight}. Vale o campo de peso.`));
  }

  if (v.requester.kind === "unresolved") {
    blocks.push({
      type: "section",
      // users_select carries no value, so the block ID carries the shipment.
      block_id: `${REQUESTER_BLOCK}${v.id}`,
      text: { type: "mrkdwn", text: `Não achei *"${esc(v.requester.raw)}"* no Slack. Quem pediu essa entrega?` },
      accessory: {
        type: "users_select",
        action_id: ACTIONS.pickRequester,
        placeholder: { type: "plain_text", text: "Escolher pessoa" },
      },
    });
  }

  blocks.push({
    type: "section",
    block_id: `${MENTIONS_BLOCK}${v.id}`,
    text: { type: "mrkdwn", text: "*Marcar no anúncio*\nQuem mais deve ser marcado no card do canal?" },
    accessory: {
      type: "multi_users_select",
      action_id: ACTIONS.pickMentions,
      placeholder: { type: "plain_text", text: "Escolher pessoas" },
      ...(v.mentions.length ? { initial_users: v.mentions } : {}),
    },
  });

  blocks.push(
    actions("draft", [
      button("Confirmar e publicar", ACTIONS.confirmPublish, String(v.id), "primary"),
      button("Editar notas", ACTIONS.editNotes, String(v.id)),
      button("Comentar", ACTIONS.addComment, String(v.id)),
    ]),
    context(`Sem resposta, publico em ${autoPublishHours} h com as notas como estão.`),
  );

  return { text: `Rascunho da entrega de #${v.ticket.iid} para ${v.branch}`, blocks };
}

function publishedDm(v: ShipmentView): SlackMessage {
  const how =
    v.publishedVia === "auto"
      ? "publicada automaticamente (notas não confirmadas)"
      : v.publishedVia === "lead"
        ? "publicada por um lead"
        : "publicada";
  return {
    text: `#${v.ticket.iid} publicada em ${v.branch}`,
    blocks: [
      section(`:white_check_mark: ${issueLink(v)} → *${esc(v.branch ?? "?")}*: ${how}.`),
      notesBlock(v),
      ...(mentionsText(v) ? [context(mentionsText(v)!)] : []),
      actions("published", [linkButton("Abrir no Shiplog", v.url)]),
    ],
  };
}

// Thread reply under the draft DM, once, after REMINDER_AFTER_HOURS.
export function reminderReply(v: ShipmentView, hoursLeft: number): SlackMessage {
  return {
    text: `Lembrete: #${v.ticket.iid} ainda aguarda confirmação`,
    blocks: [
      section(
        `:bell: Lembrete: o rascunho de ${issueLink(v)} ainda aguarda confirmação. Sem resposta, publico em ~${hoursLeft} h com as notas como estão.`,
      ),
    ],
  };
}

// ── Leads ────────────────────────────────────────────────────────────

export function leadsUnclaimedDm(v: ShipmentView, unclaimedUrl: string): SlackMessage {
  const meantFor = v.intendedGitlabId
    ? `Era para o usuário ${v.intendedGitlabId} do GitLab, que ainda não conectou o Shiplog.`
    : "Não deu para saber de quem é.";
  return {
    text: `Entrega sem responsável: #${v.ticket.iid}`,
    blocks: [
      section(`:raised_hand: *Entrega sem responsável*: ${issueLink(v)} → *${esc(v.branch ?? "sem branch")}*\n${meantFor}`),
      ...detailsContext(v),
      actions("unclaimed", [linkButton("Abrir a fila", unclaimedUrl)]),
    ],
  };
}

// ── Published: channel card and requester DM ─────────────────────────

// Read-only card in the existing channel (D9): today's format, plus "Abrir no Shiplog".
export function feedCard(v: ShipmentView): SlackMessage {
  const requester = v.requester.kind === "resolved" ? ` (<@${v.requester.slackUserId}>)` : "";
  const unconfirmed = v.publishedVia === "auto" ? [context(":warning: Notas não confirmadas pelo dev.")] : [];
  return {
    text: `Entregue em ${v.branch}: #${v.ticket.iid} ${v.ticket.title}`,
    blocks: [
      section(`:ship: *Entregue em ${esc(v.branch ?? "?")}*\n${issueLink(v)}${requester}`),
      ...(v.notes ? [section(quote(v.notes))] : []),
      ...(mentionsText(v) ? [context(mentionsText(v)!)] : []),
      ...unconfirmed,
      actions("feed", [linkButton("Abrir no Shiplog", v.url)]),
    ],
  };
}

// DM to the requester (D11). After they answer, it's updated to show what they chose.
export function requesterDm(v: ShipmentView, answered: "verified" | "issue_reported" | null): SlackMessage {
  const blocks: KnownBlock[] = [
    section(`:tada: *O que você pediu foi entregue em ${esc(v.branch ?? "?")}*\n${issueLink(v)}`),
    ...(v.notes ? [section(quote(v.notes))] : []),
  ];
  if (answered === "verified") {
    blocks.push(context(":white_check_mark: Você verificou. Obrigado!"), actions("requester", [linkButton("Abrir no Shiplog", v.url)]));
  } else if (answered === "issue_reported") {
    blocks.push(
      context(":warning: Você reportou um problema; o dev foi avisado."),
      actions("requester", [
        button("Agora está ok", ACTIONS.verify, String(v.id), "primary"),
        linkButton("Abrir no Shiplog", v.url),
      ]),
    );
  } else {
    blocks.push(
      context("Confere se ficou como esperado?"),
      actions("requester", [
        button("Verificar", ACTIONS.verify, String(v.id), "primary"),
        button("Reportar problema", ACTIONS.reportIssue, String(v.id)),
        linkButton("Abrir no Shiplog", v.url),
      ]),
    );
  }
  return { text: `Entregue em ${v.branch}: #${v.ticket.iid} ${v.ticket.title}`, blocks };
}

// Thread reply under the recipient's DM when someone comments on the shipment.
export function commentReply(authorSlackId: string | null, authorName: string, body: string): SlackMessage {
  const who = authorSlackId ? `<@${authorSlackId}>` : esc(authorName);
  return {
    text: `Comentário de ${authorName}`,
    blocks: [section(`:speech_balloon: ${who} comentou:\n${quote(body)}`), context("Fica no histórico da entrega no Shiplog.")],
  };
}

// DM to the dev when someone reports a problem.
export function issueReportedDm(v: ShipmentView, reporterSlackId: string | null, comment: string): SlackMessage {
  const who = reporterSlackId ? `<@${reporterSlackId}>` : "Alguém";
  return {
    text: `Problema reportado em #${v.ticket.iid}`,
    blocks: [
      section(`:warning: ${who} reportou um problema em ${issueLink(v)} → *${esc(v.branch ?? "?")}*`),
      section(quote(comment)),
      actions("reported", [linkButton("Abrir no Shiplog", v.url)]),
    ],
  };
}

// ── Modals ───────────────────────────────────────────────────────────

function textModal(args: {
  callbackId: ModalId;
  shipmentId: number;
  title: string;
  label: string;
  submit: string;
  initial?: string | null;
  hint?: string;
}): ModalView {
  return {
    type: "modal",
    callback_id: args.callbackId,
    private_metadata: String(args.shipmentId),
    title: { type: "plain_text", text: args.title },
    submit: { type: "plain_text", text: args.submit },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      {
        type: "input",
        block_id: FIELDS.text,
        label: { type: "plain_text", text: args.label },
        ...(args.hint ? { hint: { type: "plain_text", text: args.hint } } : {}),
        element: {
          type: "plain_text_input",
          action_id: FIELDS.text,
          multiline: true,
          max_length: 2000,
          ...(args.initial ? { initial_value: args.initial } : {}),
        },
      },
    ],
  };
}

export function editNotesModal(v: Pick<ShipmentView, "id" | "notes">): ModalView {
  return textModal({
    callbackId: MODALS.editNotes,
    shipmentId: v.id,
    title: "Editar notas",
    label: "Notas da entrega",
    submit: "Salvar",
    // Slack refuses to open the modal when initial_value is longer than max_length.
    initial: v.notes?.slice(0, 2000),
    hint: "Aparece no feed e no canal. Escreva para quem não é dev.",
  });
}

export function commentModal(shipmentId: number): ModalView {
  return textModal({ callbackId: MODALS.addComment, shipmentId, title: "Comentar", label: "Comentário", submit: "Enviar" });
}

export function reportIssueModal(shipmentId: number): ModalView {
  return textModal({
    callbackId: MODALS.reportIssue,
    shipmentId,
    title: "Reportar problema",
    label: "O que não ficou certo?",
    submit: "Reportar",
  });
}
