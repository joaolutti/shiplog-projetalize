/**
 * Visão geral (M4): how the team is shipping this week. Team totals only, never per person
 * (D24, D38). Everything reads the viewer, so the page streams in behind Suspense.
 */
import Link from "next/link";
import { Suspense } from "react";
import { ActivityHeatmap, DayBars, Ring } from "@/components/charts";
import { ShipmentDrawer } from "@/components/shipment-drawer";
import { ShipmentTable } from "@/components/shipments";
import { Chip, Empty, Icon, plural } from "@/components/ui";
import { requireViewer } from "@/lib/auth/viewer";
import { overview } from "@/lib/shipments/queries";

export default function OverviewPage({ searchParams }: PageProps<"/">) {
  return (
    <main className="view">
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Title and icon, a line of detail, then the number or, for Entregas, the week's bars.
function Tile(props: { icon: string; label: string; sub: string; warn?: boolean; value?: number; hot?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`t stat s3 ${props.hot ? "hot" : ""}`}>
      <div className="stat-h">
        <h3>{props.label}</h3>
        <Icon name={props.icon} />
      </div>
      <span className={`sub ${props.warn ? "warn" : ""}`}>{props.sub}</span>
      <div className="v-row">
        {props.value !== undefined && <span className="v">{props.value}</span>}
        {props.children}
      </div>
    </div>
  );
}

async function Overview({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const viewer = await requireViewer();
  const [o, sp] = await Promise.all([overview(viewer), searchParams]);
  const open = Number(Array.isArray(sp.s) ? sp.s[0] : sp.s);
  const w = o.week;
  const head = w.issues ? "Atenção" : w.waiting ? "Em andamento" : "Em dia";
  const line =
    [
      w.issues ? plural(w.issues, "entrega com problema relatado", "entregas com problema relatado") : "",
      w.waiting ? `${w.waiting} aguardando verificação` : "",
    ]
      .filter(Boolean)
      .join(" e ") || (w.total ? "Tudo o que foi entregue esta semana foi verificado" : "Nada entregue nos últimos 7 dias");
  const bars = [
    ...w.pctByBranch.map((b) => ({ label: `Em ${b.branch}`, pct: b.pct })),
    ...(w.requesterPct !== null ? [{ label: "Pelo solicitante", pct: w.requesterPct }] : []),
  ];

  return (
    <div className="bento">
      <Tile icon="deployed_code" label="Entregas" sub={`Últimos 7 dias${w.today ? ` · +${w.today} hoje` : ""}`}>
        <DayBars days={o.last7} />
      </Tile>
      <Tile icon="task_alt" label="Verificadas" sub={`${w.verifiedPct}% das entregas da semana`} value={w.verified} />
      <Tile
        icon="hourglass_empty"
        label="Aguardando verificação"
        sub={w.waitingOver24h ? `${w.waitingOver24h} há mais de 24 h` : "Nesta semana"}
        warn={w.waitingOver24h > 0}
        value={w.waiting}
      />
      <Tile
        icon="report"
        label="Problema relatado"
        sub={w.issues ? "Precisa de atenção" : "Nesta semana"}
        warn={w.issues > 0}
        value={w.issues}
        hot={w.issues > 0}
      />
      <section className="t pad s12" aria-labelledby="recent-h">
        <div className="sec-h">
          <div className="ttl">
            <h2 id="recent-h">Entregas recentes</h2>
            <span className="sep" />
            <span className="muted" style={{ fontSize: 13 }}>
              Últimas publicadas
            </span>
          </div>
          <Link className="link-u" href="/feed">
            Ver todas
          </Link>
        </div>
        <ShipmentTable items={o.recent} href={(id) => `/?s=${id}`} tech={viewer.role !== "member"} />
      </section>
      <section className="t pad s7 fill" id="attention" aria-labelledby="att-h">
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

      <section className="t pad s12" aria-labelledby="contrib-h">
        <div className="sec-h" style={{ marginBottom: 8 }}>
          <div className="ttl">
            <h2 id="contrib-h">Ritmo do time</h2>
            <span className="sep" />
            <span className="muted" style={{ fontSize: 13 }}>
              Entregas por dia, todas as branches
            </span>
          </div>
          <Link className="link-u" href="/feed">
            Ver entregas
          </Link>
        </div>
        <ActivityHeatmap activity={o.activity} />
      </section>

      {Number.isInteger(open) && open > 0 && <ShipmentDrawer viewer={viewer} shipmentId={open} closeHref="/" />}
    </div>
  );
}
