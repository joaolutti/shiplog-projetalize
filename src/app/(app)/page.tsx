/**
 * Visão geral (M4): how the team is shipping this week. Team totals only, never per person
 * (D24, D38). Everything reads the viewer, so the page streams in behind Suspense.
 */
import Link from "next/link";
import { Suspense } from "react";
import { ActivityHeatmap, DayBars, Ring } from "@/components/charts";
import { ShipmentTable } from "@/components/shipments";
import { Chip, Empty, Icon, plural } from "@/components/ui";
import { requireViewer } from "@/lib/auth/viewer";
import { overview } from "@/lib/shipments/queries";

export default function OverviewPage() {
  return (
    <main className="view">
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <Overview />
      </Suspense>
    </main>
  );
}

function Tile(props: { icon: string; label: string; value: number; chip?: React.ReactNode; hot?: boolean }) {
  return (
    <div className={`t stat s3 ${props.hot ? "hot" : ""}`}>
      <div className="stat-top">
        <Icon name={props.icon} />
        {props.chip}
      </div>
      <span className="k">{props.label}</span>
      <span className="v">{props.value}</span>
    </div>
  );
}

async function Overview() {
  const viewer = await requireViewer();
  const o = await overview(viewer);
  const w = o.week;
  const head = w.issues ? "Atenção" : w.waiting ? "Em andamento" : "Em dia";
  const line =
    [
      w.issues ? plural(w.issues, "entrega com problema relatado", "entregas com problema relatado") : "",
      w.waiting ? `${w.waiting} aguardando verificação` : "",
    ]
      .filter(Boolean)
      .join(" e ") || (w.total ? "Tudo o que foi entregue esta semana foi verificado" : "Nada entregue nos últimos 7 dias");
  const branchLine = Object.entries(w.byBranch)
    .map(([b, n]) => `${n} em ${b}`)
    .join(" · ");
  const bars = [
    ...w.pctByBranch.map((b) => ({ label: `Em ${b.branch}`, pct: b.pct })),
    ...(w.requesterPct !== null ? [{ label: "Pelo solicitante", pct: w.requesterPct }] : []),
  ];

  return (
    <div className="bento">
      <section className="t hero s6 r2" aria-labelledby="hero-h">
        <div className="stat-top" style={{ marginBottom: 0 }}>
          <Icon name="deployed_code" />
          {w.today > 0 && <span className="delta ok">+{w.today} hoje</span>}
        </div>
        <span className="k" id="hero-h" style={{ marginTop: 18, fontSize: 12, color: "var(--color-muted)" }}>
          Entregas · últimos 7 dias
        </span>
        <span className="v">{w.total}</span>
        <span className="cap">{branchLine ? `${branchLine} · time inteiro` : "Time inteiro"}</span>
        <DayBars days={o.last7} />
      </section>

      <Tile icon="task_alt" label="Verificadas" value={w.verified} chip={<span className="delta neu">{w.verifiedPct}%</span>} />
      <Tile
        icon="hourglass_empty"
        label="Aguardando verificação"
        value={w.waiting}
        chip={w.waitingOver24h ? <span className="delta warn">{w.waitingOver24h} há +24 h</span> : undefined}
      />
      <Tile
        icon="report"
        label="Problema relatado"
        value={w.issues}
        chip={w.issues ? <span className="delta warn">Atenção</span> : undefined}
        hot={w.issues > 0}
      />
      <Tile
        icon="edit_note"
        label="Rascunhos pendentes"
        value={o.drafts.pending}
        chip={o.drafts.blocked ? <span className="delta warn">{plural(o.drafts.blocked, "bloqueado", "bloqueados")}</span> : undefined}
      />

      <section className="t pad s5" aria-labelledby="score-h">
        <div className="sec-h">
          <h2 id="score-h">Verificação da semana</h2>
          <Link className="link-u" href="/feed?verification=unverified">
            Ver pendentes
          </Link>
        </div>
        <div className="score">
          <Ring pct={w.verifiedPct} />
          <div className="score-b">
            <h3>{head}</h3>
            <p>{line}.</p>
          </div>
        </div>
        {bars.length > 0 && (
          <ul className="bars">
            {bars.map((b) => (
              <li key={b.label}>
                <span>{b.label}</span>
                <span className="bar" aria-hidden="true">
                  <i style={{ width: `${b.pct}%` }} />
                </span>
                <b>{b.pct}%</b>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="t pad s7" id="attention" aria-labelledby="att-h">
        <div className="sec-h">
          <h2 id="att-h">Precisa de atenção</h2>
          {o.attention.length > 5 && <span className="muted">{o.attention.length} no total</span>}
        </div>
        {o.attention.length ? (
          <ul className="att">
            {o.attention.slice(0, 5).map((a) => (
              <li key={`${a.href}-${a.title}-${a.sub}`}>
                <Link href={a.href}>
                  <span className="ib">
                    <Icon name={a.icon} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div className="att-t">{a.title}</div>
                    <div className="att-s">{a.sub}</div>
                  </span>
                  <Chip tone={a.chip.tone}>{a.chip.label}</Chip>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nada pendente. Todas as entregas estão confirmadas e sem problemas.</Empty>
        )}
      </section>

      <section className="t pad s12" aria-labelledby="contrib-h">
        <div className="sec-h" style={{ marginBottom: 8 }}>
          <div className="ttl">
            <h2 id="contrib-h">Ritmo do time</h2>
            <span className="sep" />
            <span className="muted" style={{ fontSize: 14 }}>
              Entregas por dia, todas as branches
            </span>
          </div>
          <Link className="link-u" href="/feed">
            Ver entregas
          </Link>
        </div>
        <ActivityHeatmap activity={o.activity} />
      </section>

      <section className="t pad s12" aria-labelledby="recent-h">
        <div className="sec-h">
          <div className="ttl">
            <h2 id="recent-h">Entregas recentes</h2>
            <span className="sep" />
            <span className="muted" style={{ fontSize: 14 }}>
              Últimas publicadas
            </span>
          </div>
          <Link className="link-u" href="/feed">
            Ver todas
          </Link>
        </div>
        <ShipmentTable items={o.recent} />
      </section>
    </div>
  );
}
