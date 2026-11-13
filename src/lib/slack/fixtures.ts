// Sample shipments for /dev/slack-preview and the Block Kit snapshot tests.
import type { ShipmentView } from "./blocks";

const base: ShipmentView = {
  id: 7,
  status: "pending_confirmation",
  branch: "Staging",
  notes: "Corrige o login com SSO para clientes enterprise.\nO botão \"Entrar\" volta a funcionar no Safari.",
  publishedVia: null,
  // 19:30 in São Paulo: "Boa noite".
  publishedAt: new Date("2026-10-03T22:30:00Z"),
  url: "https://shiplog.example.com/tickets/3",
  ticket: {
    iid: 412,
    title: "Corrigir login com SSO",
    webUrl: "https://gitlab.com/acme/billing-svc/-/issues/412",
    projectPath: "acme/billing-svc",
    nativeWeight: 3,
    labelWeight: 3,
    hubspotUrls: ["https://app.hubspot.com/contacts/123/record/0-5/456"],
  },
  requester: { kind: "resolved", slackUserId: "U0REQUESTER" },
  mergeRequests: [
    { ref: "acme/billing-svc!45", title: "Corrige SSO", webUrl: "https://gitlab.com/acme/billing-svc/-/merge_requests/45", state: "merged" },
  ],
  mentions: [],
};

export const FIXTURES = {
  draft: base,
  draftUnresolvedRequester: { ...base, requester: { kind: "unresolved", raw: "Ana Ribeiro" } },
  draftWeightMismatch: { ...base, ticket: { ...base.ticket, nativeWeight: 5, labelWeight: 3 } },
  needsBranch: { ...base, status: "needs_branch", branch: null },
  openMrs: {
    ...base,
    status: "awaiting_hold_decision",
    mergeRequests: [
      ...base.mergeRequests,
      { ref: "acme/app!46", title: "Tela de login", webUrl: "https://gitlab.com/acme/app/-/merge_requests/46", state: "opened" },
    ],
  },
  held: { ...base, status: "held" },
  published: { ...base, status: "published", publishedVia: "confirmed", mentions: ["U0QA"] },
  publishedAuto: { ...base, status: "published", publishedVia: "auto", requester: { kind: "none" } },
} satisfies Record<string, ShipmentView>;
