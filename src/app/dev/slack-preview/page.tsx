/**
 * Development only: every Slack message rendered from fixtures, with a link to open each one
 * in Slack's Block Kit Builder. 404 in production.
 */
import { notFound } from "next/navigation";
import {
  commentModal,
  commentReply,
  editNotesModal,
  feedCard,
  issueReportedDm,
  leadsUnclaimedDm,
  recipientDm,
  reminderReply,
  reportIssueModal,
  requesterDm,
} from "@/lib/slack/blocks";
import { FIXTURES } from "@/lib/slack/fixtures";

const opts = { branchChoices: ["Main", "Staging"], autoPublishHours: 24 };

const SAMPLES: Array<{ title: string; payload: object; modal?: boolean }> = [
  { title: "Rascunho (DM do dev)", payload: recipientDm(FIXTURES.draft, opts) },
  { title: "Rascunho: solicitante não encontrado", payload: recipientDm(FIXTURES.draftUnresolvedRequester, opts) },
  { title: "Rascunho: peso diferente do rótulo", payload: recipientDm(FIXTURES.draftWeightMismatch, opts) },
  { title: "Rascunho: pessoas marcadas", payload: recipientDm(FIXTURES.draftWithMentions, opts) },
  { title: "Sem branch", payload: recipientDm(FIXTURES.needsBranch, opts) },
  { title: "MRs abertos", payload: recipientDm(FIXTURES.openMrs, opts) },
  { title: "Aguardando merge", payload: recipientDm(FIXTURES.held, opts) },
  { title: "Publicada (DM do dev)", payload: recipientDm(FIXTURES.published, opts) },
  { title: "Lembrete (thread)", payload: reminderReply(FIXTURES.draft, 20) },
  { title: "Sem responsável (DM dos leads)", payload: leadsUnclaimedDm(FIXTURES.unclaimed, "https://shiplog.example.com/unclaimed") },
  { title: "Card no canal", payload: feedCard(FIXTURES.published) },
  { title: "Card no canal: publicação automática", payload: feedCard(FIXTURES.publishedAuto) },
  { title: "DM do solicitante", payload: requesterDm(FIXTURES.published, null) },
  { title: "DM do solicitante: verificou", payload: requesterDm(FIXTURES.published, "verified") },
  { title: "Comentário (thread do rascunho)", payload: commentReply("U0QA", "Ana", "Testei em staging, ok!") },
  { title: "Problema reportado (DM do dev)", payload: issueReportedDm(FIXTURES.published, "U0REQUESTER", "O botão ainda falha no iPhone.") },
  { title: "Modal: editar notas", payload: editNotesModal(FIXTURES.draft), modal: true },
  { title: "Modal: comentar", payload: commentModal(7), modal: true },
  { title: "Modal: reportar problema", payload: reportIssueModal(7), modal: true },
];

function builderUrl(payload: object, modal: boolean): string {
  const blocks = modal ? payload : { blocks: (payload as { blocks: unknown[] }).blocks };
  return `https://app.slack.com/block-kit-builder#${encodeURIComponent(JSON.stringify(blocks))}`;
}

export default function SlackPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Mensagens do Slack (dev)</h1>
      <p className="mt-2 text-sm text-muted">Geradas por src/lib/slack/blocks.ts a partir de fixtures.</p>
      <ul className="mt-8 space-y-6">
        {SAMPLES.map((s) => (
          <li key={s.title} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold">{s.title}</h2>
              <a href={builderUrl(s.payload, Boolean(s.modal))} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                Abrir no Block Kit Builder
              </a>
            </div>
            <pre className="mt-3 max-h-64 overflow-auto rounded bg-background p-3 text-xs text-muted">
              {JSON.stringify(s.payload, null, 2)}
            </pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
