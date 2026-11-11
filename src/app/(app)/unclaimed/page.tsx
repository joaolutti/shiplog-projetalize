/**
 * Sem responsável (M2, leads): shipments whose recipient has no linked account (D10).
 * A lead sends the draft to a dev or lead, or publishes it as is.
 */
import Link from "next/link";
import { Suspense } from "react";
import { assignAction, publishAction } from "./actions";
import { BranchTag, Empty, Icon } from "@/components/ui";
import { requireRole } from "@/lib/auth/viewer";
import { ago } from "@/lib/dates";
import { listAssignable, listUnclaimed } from "@/lib/shipments/queries";

export default function UnclaimedPage() {
  return (
    <main className="view">
      <section className="band">
        <div className="pad">
          <div className="sec-h" style={{ margin: 0 }}>
            <div>
              <h2>Rascunhos sem responsável</h2>
              <p>O Shiplog não encontrou a conta do dev no Shiplog, então o rascunho espera aqui. Eles não aparecem no canal.</p>
            </div>
          </div>
        </div>
      </section>
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <Queue />
      </Suspense>
    </main>
  );
}

async function Queue() {
  const viewer = await requireRole("lead");
  const [unclaimed, assignable] = await Promise.all([listUnclaimed(viewer), listAssignable(viewer)]);
  if (unclaimed.length === 0) return <Empty>Nada sem responsável. Todos os rascunhos chegaram a um dev.</Empty>;

  return (
    <section className="ulist">
      {unclaimed.map((s) => (
        <article className="uc" key={s.id}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <BranchTag branch={s.branch} />
              <span className="iid">
                #{s.ticket.iid} · {s.ticket.projectPath}
              </span>
            </div>
            <Link className="tl" href={`/tickets/${s.ticket.id}`}>
              {s.ticket.title}
            </Link>
            {s.notes && <p>{s.notes}</p>}
            <div className="meta">
              <span>
                <Icon name="link_off" />
                {s.intendedGitlabId
                  ? `O responsável no GitLab (usuário ${s.intendedGitlabId}) ainda não conectou o GitLab ao Shiplog`
                  : "Não deu para saber de quem é"}
              </span>
              <span>
                <Icon name="schedule" />
                {ago(s.createdAt)}
              </span>
            </div>
          </div>
          <div className="row">
            <form action={assignAction} className="row">
              <input type="hidden" name="shipmentId" value={s.id} />
              <label className="sr" htmlFor={`as-${s.id}`}>
                Enviar rascunho para
              </label>
              <select className="sel sm" id={`as-${s.id}`} name="userId" required defaultValue="">
                <option value="" disabled>
                  Enviar para…
                </option>
                {assignable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn neutral sm">Enviar rascunho</button>
            </form>
            <form action={publishAction}>
              <input type="hidden" name="shipmentId" value={s.id} />
              <button className="btn primary sm" disabled={!s.branch} title={s.branch ? undefined : "Escolha a branch antes de publicar"}>
                Publicar como líder
              </button>
            </form>
          </div>
        </article>
      ))}
    </section>
  );
}
