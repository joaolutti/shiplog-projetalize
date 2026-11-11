/**
 * Ticket page (M4): the GitLab issue, each shipment (per branch) with its notes, MRs and
 * verification, the ticket's discussion thread (D13), and its history. Weight reviews show for
 * dev and lead only (D23).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { commentAction, reverifyAction, verifyAction } from "@/app/(app)/actions";
import { ReportButton } from "@/components/report-form";
import { VerifyControl } from "@/components/shipments";
import { Avatar, BranchTag, Empty, Icon, VerificationBadge, ViaFlag } from "@/components/ui";
import { requireViewer, type Viewer } from "@/lib/auth/viewer";
import { ago, shortDate, when } from "@/lib/dates";
import type { TimelineEntry } from "@/lib/db/schema";
import { ticketDetail, type TicketDetail, type TicketShipment } from "@/lib/shipments/queries";

export default function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  return (
    <main className="view">
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <Ticket params={params} />
      </Suspense>
    </main>
  );
}

async function Ticket({ params }: Pick<PageProps<"/tickets/[id]">, "params">) {
  const viewer = await requireViewer();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const t = await ticketDetail(viewer, id);
  if (!t) notFound();

  const published = t.shipments.filter((s) => s.status === "published");
  const inProgress = t.shipments.filter((s) => s.status !== "published");

  return (
    <>
      <section className="band">
        <div className="pad">
          <Link className="back" href="/feed">
            <Icon name="arrow_back" />
            Entregas
          </Link>
          <div className="tk-head">
            <span className="eyebrow">
              {t.projectPath} · Issue #{t.iid}
            </span>
            <h1>{t.title}</h1>
            <div className="row">
              {t.labels.map((l) => (
                <span className="label" key={l}>
                  {l}
                </span>
              ))}
              {t.gitlabStatus && <span className="label">Status: {t.gitlabStatus}</span>}
            </div>
            <dl className="kv">
              <div>
                <dt>Responsável</dt>
                <dd>{t.assignees.length ? t.assignees.join(", ") : <span className="muted">Ninguém</span>}</dd>
              </div>
              <div>
                <dt>Solicitante</dt>
                <dd>{t.requesterName ?? <span className="muted">Nenhum</span>}</dd>
              </div>
              {t.hubspotUrls.length > 0 && (
                <div>
                  <dt>Ticket do cliente</dt>
                  <dd>
                    {t.hubspotUrls.map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        HubSpot{t.hubspotUrls.length > 1 ? ` ${i + 1}` : ""}{" "}
                      </a>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt>Origem</dt>
                <dd>
                  <a href={t.webUrl} target="_blank" rel="noreferrer">
                    Abrir no GitLab <Icon name="open_in_new" />
                  </a>
                </dd>
              </div>
            </dl>
            {published.length > 0 && <Track shipments={published} />}
          </div>
        </div>
      </section>

      <section className="tk-grid">
        <div className="col">
          {inProgress.map((s) => (
            <InProgress key={s.id} shipment={s} />
          ))}
          {published.length ? (
            [...published].reverse().map((s) => <ShipmentBox key={s.id} shipment={s} viewer={viewer} />)
          ) : (
            <Empty>Este ticket ainda não foi publicado.</Empty>
          )}
          <Discussion ticket={t} />
        </div>
        <aside className="col" aria-label="Detalhes">
          {(viewer.role === "dev" || viewer.role === "lead") && <WeightPanel ticket={t} />}
          <History ticket={t} />
        </aside>
      </section>
    </>
  );
}

// Staging → Main promotion, from the branches that have published.
function Track({ shipments }: { shipments: TicketShipment[] }) {
  const branches = [...new Set([...["Staging", "Main"], ...shipments.map((s) => s.branch ?? "")])].filter(Boolean);
  const done = (b: string) => shipments.some((s) => s.branch?.toLowerCase() === b.toLowerCase());
  return (
    <div className="track" aria-label="Promoção entre branches">
      {branches.map((b, i) => (
        <span key={b} style={{ display: "contents" }}>
          {i > 0 && <span className={`line ${done(b) ? "ok" : ""}`} />}
          <span className={`step ${done(b) ? "ok" : ""}`}>
            <span className="num">{done(b) ? <Icon name="check" /> : i + 1}</span>
            {b}
          </span>
        </span>
      ))}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  unclaimed: "Sem responsável: aguardando um líder atribuir",
  needs_branch: "Aguardando a escolha da branch",
  awaiting_hold_decision: "Há MRs abertos: aguardando a decisão do dev",
  held: "Aguardando o merge dos MRs abertos",
  pending_confirmation: "Rascunho enviado por DM, aguardando confirmação",
};

function InProgress({ shipment: s }: { shipment: TicketShipment }) {
  return (
    <section className="box">
      <div className="box-h">
        <BranchTag branch={s.branch} />
        <h2>Em andamento</h2>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
          {STATUS_TEXT[s.status]}
        </span>
      </div>
      {s.notes && (
        <div className="box-b">
          <div>
            <span className="k">Rascunho das notas</span>
            <p className="notes-text">{s.notes}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function ShipmentBox({ shipment: s, viewer }: { shipment: TicketShipment; viewer: Viewer }) {
  const item = { shipmentId: s.id, ticketId: 0, mine: s.mine };
  return (
    <section className="box" id={`entrega-${s.id}`} aria-labelledby={`h-${s.id}`}>
      <div className="box-h">
        <BranchTag branch={s.branch} />
        <h2 id={`h-${s.id}`}>
          Entregue em {s.branch} {s.publishedAt && <span className="muted" style={{ fontWeight: 400 }}>{when(s.publishedAt)}</span>}
        </h2>
        <ViaFlag via={s.publishedVia} />
        <span style={{ marginLeft: "auto" }}>
          <VerificationBadge status={s.verification} small />
        </span>
      </div>
      <div className="box-b">
        <div>
          <span className="k">O que mudou</span>
          <p className="notes-text">{s.notes ?? <span className="muted">Sem notas.</span>}</p>
        </div>
        {s.mergeRequests.length > 0 && (
          <div>
            <span className="k" style={{ display: "block", marginBottom: 8 }}>
              Merge requests
            </span>
            <div className="tbl-wrap">
              <table className="mr">
                <thead>
                  <tr>
                    <th>MR</th>
                    <th>Estado</th>
                    <th className="n">Arquivos</th>
                    <th className="n">Linhas</th>
                    <th className="n">Mergeado</th>
                  </tr>
                </thead>
                <tbody>
                  {s.mergeRequests.map((m) => (
                    <tr key={m.ref}>
                      <td>
                        <a href={m.webUrl} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>
                          {m.ref}
                        </a>
                        <br />
                        <span className="muted" style={{ fontSize: 12 }}>
                          {m.title}
                        </span>
                      </td>
                      <td>
                        <span className={`mr-state ${m.state}`}>
                          <Icon name={m.state === "merged" ? "merge" : m.state === "closed" ? "close" : "pending"} />
                          {m.state === "merged" ? "Mergeado" : m.state === "closed" ? "Fechado" : "Aberto"}
                        </span>
                      </td>
                      <td className="n">{m.filesChanged ?? "—"}</td>
                      <td className="n">
                        {m.additions !== null ? (
                          <>
                            <span className="add">+{m.additions}</span> <span className="del">−{m.deletions}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="n">{m.mergedAt ? shortDate(m.mergedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="verify" id={`relatar-${s.id}`}>
          <span className="k">Verificação</span>
          {s.verifications.length ? (
            <ul className="vlist">
              {s.verifications.map((v) => (
                <li key={v.userId}>
                  <Icon name={v.kind === "verified" ? "check_circle" : "report"} className={v.kind === "verified" ? "ok" : "warn"} />
                  <span>
                    <b style={{ fontWeight: 500 }}>{v.name}</b> {v.kind === "verified" ? "verificou" : "relatou um problema"}{" "}
                    <span className="muted">{ago(v.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Ninguém verificou ainda.
            </p>
          )}
          <div className="row">
            {s.mine === "issue_reported" ? (
              <>
                <span className="muted" style={{ fontSize: 13 }}>
                  Você relatou um problema.
                </span>
                <form action={verifyAction}>
                  <input type="hidden" name="shipmentId" value={s.id} />
                  <button className="btn neutral sm">
                    <Icon name="check" />
                    Agora está ok
                  </button>
                </form>
              </>
            ) : s.mine === "verified" ? (
              <VerifyControl item={item} variant="button" />
            ) : (
              <>
                <form action={verifyAction}>
                  <input type="hidden" name="shipmentId" value={s.id} />
                  <button className="btn primary sm">
                    <Icon name="check" />
                    Verificar
                  </button>
                </form>
                <ReportButton shipmentId={s.id} devName={s.devName} />
              </>
            )}
            {s.canRequestReverify && (
              <form action={reverifyAction}>
                <input type="hidden" name="shipmentId" value={s.id} />
                <button className="btn neutral sm" title="Manda uma DM para quem relatou problema">
                  <Icon name="refresh" />
                  Pedir nova verificação
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
      <div className="box-f">
        {s.devName && <span>{s.devName}</span>}
        <span>
          {s.publishedVia === "auto"
            ? "Publicado automaticamente 24 h após o rascunho"
            : s.publishedVia === "lead"
              ? "Publicado por líder"
              : "Publicado com confirmação do dev"}
        </span>
        {viewer.role !== "member" && <span>Shiplog #{s.id}</span>}
      </div>
    </section>
  );
}

const SOURCE: Record<string, [string, string]> = {
  web: ["language", "Shiplog"],
  slack_dm: ["chat", "pela DM do Slack"],
  slack_thread: ["forum", "pelo Slack"],
};

function Discussion({ ticket: t }: { ticket: TicketDetail }) {
  const targets = t.shipments.filter((s) => s.status === "published" || s.status === "pending_confirmation");
  const latest = targets.at(-1) ?? t.shipments.at(-1);
  return (
    <section className="box" aria-labelledby="thread-h">
      <div className="box-h">
        <h2 id="thread-h">Discussão</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          Uma discussão por ticket
        </span>
      </div>
      <div className="box-b">
        {t.comments.length ? (
          <ol className="thread">
            {t.comments.map((c) => {
              const [icon, label] = SOURCE[c.source] ?? SOURCE.web;
              return (
                <li className="cmt" key={c.id}>
                  <Avatar name={c.authorName} image={c.authorImage} />
                  <div className="cmt-b">
                    <div className="cmt-h">
                      <b>{c.authorName}</b>
                      {c.branch && t.shipments.length > 1 && <BranchTag branch={c.branch} />}
                      {c.isReport && (
                        <span className="flag">
                          <Icon name="report" />
                          Relato de problema
                        </span>
                      )}
                      <time dateTime={c.at.toISOString()}>{ago(c.at)}</time>
                      <span className="src">
                        <Icon name={icon} />
                        {label}
                      </span>
                    </div>
                    <p>{c.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Nenhum comentário ainda. Dúvidas sobre este ticket ficam aqui, não em threads do Slack.
          </p>
        )}
        {latest && (
          <form className="composer" action={commentAction}>
            <label className="sr" htmlFor="cmt-text">
              Comentário
            </label>
            <textarea id="cmt-text" name="body" rows={2} required maxLength={4000} placeholder="Escreva um comentário" />
            <div className="row">
              {targets.length > 1 ? (
                <>
                  <label className="sr" htmlFor="cmt-ship">
                    Sobre
                  </label>
                  <select className="sel sm" id="cmt-ship" name="shipmentId" defaultValue={latest.id}>
                    {targets.map((s) => (
                      <option key={s.id} value={s.id}>
                        Entrega em {s.branch ?? "sem branch"}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <input type="hidden" name="shipmentId" value={latest.id} />
              )}
              <button className="btn primary sm" type="submit" style={{ marginLeft: "auto" }}>
                Comentar
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function WeightPanel({ ticket: t }: { ticket: TicketDetail }) {
  return (
    <section className="box" aria-labelledby="w-h">
      <div className="box-h">
        <h2 id="w-h">Segunda opinião de peso</h2>
        <span className="label" style={{ height: 22, fontSize: 10 }}>
          V1.5
        </span>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          <Icon name="lock" /> Só devs e líderes
        </span>
      </div>
      <div className="box-b">
        {t.weightReviews.length ? (
          t.weightReviews.map((w) => (
            <div key={w.id}>
              <div className="tab" style={{ fontSize: 16 }}>
                {w.branch}: atribuído {w.assignedWeight ?? "—"} → Shiplog {w.suggestedWeight}
              </div>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {w.rationale}
              </p>
            </div>
          ))
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            A revisão de peso chega na versão 1.5.
          </p>
        )}
      </div>
    </section>
  );
}

// Timeline entries → pt-BR history lines (only the ones people care about).
function historyLine(e: TimelineEntry, branch: string | null): { icon: string; text: string } | null {
  const b = branch ?? "sem branch";
  switch (e.event) {
    case "created":
      return { icon: "flag", text: `${b}: marcado como pronto no GitLab` };
    case "pick_branch":
      return { icon: "call_split", text: `${b}: branch escolhida` };
    case "hold_until_merged":
      return { icon: "pause", text: `${b}: aguardando o merge dos MRs` };
    case "release_held":
      return { icon: "merge", text: `${b}: MRs mergeados, rascunho enviado` };
    case "assign_recipient":
      return { icon: "person_add", text: `${b}: um líder atribuiu o responsável` };
    case "notes_edited":
      return { icon: "edit", text: `${b}: notas editadas` };
    case "confirm":
      return { icon: "task_alt", text: `${b}: confirmado e publicado` };
    case "auto_publish":
      return { icon: "schedule", text: `${b}: publicado automaticamente após 24 h` };
    case "lead_publish":
      return { icon: "verified_user", text: `${b}: publicado por um líder` };
    case "reship":
      return { icon: "replay", text: `${b}: reaberto e entregue de novo` };
    case "issue_reopened":
      return { icon: "undo", text: `${b}: issue reaberta no GitLab` };
    case "reverification_requested":
      return { icon: "refresh", text: `${b}: pediu nova verificação` };
    default:
      return null;
  }
}

function History({ ticket: t }: { ticket: TicketDetail }) {
  const lines = t.shipments
    .flatMap((s) => s.timeline.map((e) => ({ e, line: historyLine(e, s.branch) })))
    .filter((x): x is { e: TimelineEntry; line: { icon: string; text: string } } => x.line !== null)
    .sort((a, b) => a.e.at.localeCompare(b.e.at));
  return (
    <section className="band pad" aria-labelledby="hist-h">
      <h2 id="hist-h" style={{ fontSize: 14, marginBottom: 6 }}>
        Histórico
      </h2>
      {lines.length ? (
        <ul className="hist">
          {lines.map(({ e, line }, i) => (
            <li key={i}>
              <Icon name={line.icon} />
              <span>
                {line.text} <span className="faint">{when(new Date(e.at))}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Nada ainda.
        </p>
      )}
    </section>
  );
}
