// Pieces shared by the ticket page and the shipment side panel: verification and discussion.
import { commentAction, reverifyAction, verifyAction } from "@/app/(app)/actions";
import { ago } from "@/lib/dates";
import type { TicketDetail, TicketShipment } from "@/lib/shipments/queries";
import { ReportButton } from "./report-form";
import { VerifyControl } from "./shipments";
import { Avatar, BranchTag, Icon } from "./ui";

// Who verified or reported, and the viewer's own controls (verify, report, undo, reverify).
export function VerificationBlock({ shipment: s }: { shipment: TicketShipment }) {
  return (
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
          <VerifyControl item={{ shipmentId: s.id, ticketId: 0, mine: s.mine }} variant="button" />
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
  );
}

const SOURCE: Record<string, [string, string]> = {
  web: ["language", "Shiplog"],
  slack_dm: ["chat", "pela DM do Slack"],
  slack_thread: ["forum", "pelo Slack"],
};

export function Discussion({ ticket: t, shipmentId }: { ticket: TicketDetail; shipmentId?: number }) {
  const targets = t.shipments.filter((s) => s.status === "published" || s.status === "pending_confirmation");
  // The composer defaults to the shipment in view (the side panel), else the latest one.
  const latest = targets.find((s) => s.id === shipmentId) ?? targets.at(-1) ?? t.shipments.at(-1);
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
