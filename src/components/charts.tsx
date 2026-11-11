// Overview charts (ported from the prototype). Team totals only: nothing here is per person (D24, D38).
import { addDays, dayKey, fromDayKey, MONTHS, weekday } from "@/lib/dates";
import { plural } from "./ui";

const entregas = (n: number) => (n === 0 ? "Nenhuma entrega" : plural(n, "entrega", "entregas"));
const dateLabel = (key: string) => {
  const d = fromDayKey(key);
  return `${weekday(key)}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

export function DayBars({ days }: { days: Array<{ key: string; count: number }> }) {
  const today = dayKey(new Date());
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="days" role="img" aria-label={`Entregas por dia nos últimos 7 dias: ${days.map((d) => `${weekday(d.key)} ${d.count}`).join(", ")}`}>
      {days.map((d) => (
        <div key={d.key} className={`d ${d.key === today ? "today" : ""}`} title={`${entregas(d.count)} · ${dateLabel(d.key)}`}>
          <div className="col">
            {d.count > 0 && <span className="n">{d.count}</span>}
            <span className={`b ${d.count ? "" : "z"}`} style={{ height: d.count ? Math.max(8, (d.count / max) * 96) : 3 }} />
          </div>
          <span className="lb">{d.key === today ? "hoje" : weekday(d.key)}</span>
        </div>
      ))}
    </div>
  );
}

export function Ring({ pct }: { pct: number }) {
  const r = 80;
  const c = 2 * Math.PI * r;
  return (
    <div className="vring" role="img" aria-label={`${pct}% das entregas da semana verificadas`}>
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="6" />
        <circle
          cx="90"
          cy="90"
          r={r}
          fill="none"
          stroke="var(--color-roxo-text)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 90 90)"
        />
      </svg>
      <div className="c">
        <b>{pct}%</b>
        <span>verificadas</span>
      </div>
    </div>
  );
}

const level = (n: number) => (n === 0 ? "" : n === 1 ? "l1" : n === 2 ? "l2" : n <= 4 ? "l3" : "l4");

// A year of team deliveries, one cell per São Paulo day, Sunday-first weeks.
export function ActivityHeatmap({ activity }: { activity: Map<string, number> }) {
  const today = dayKey(new Date());
  let start = addDays(today, -364);
  start = addDays(start, -fromDayKey(start).getUTCDay());

  const cells: React.ReactNode[] = [];
  const months: React.ReactNode[] = [];
  let total = 0;
  let best = 0;
  let week = 0;
  let lastMonth = -1;
  for (let key = start; key <= today; key = addDays(key, 1)) {
    const d = fromDayKey(key);
    const dow = d.getUTCDay();
    if (dow === 0 && d.getUTCMonth() !== lastMonth && week < 51) {
      lastMonth = d.getUTCMonth();
      months.push(
        <span key={`m${key}`} className="m" style={{ gridColumn: `${week + 2} / span 4` }}>
          {MONTHS[lastMonth]}
        </span>,
      );
    }
    const n = activity.get(key) ?? 0;
    total += n;
    best = Math.max(best, n);
    cells.push(
      <span
        key={key}
        className={`c ${level(n)} ${key === today ? "today" : ""}`}
        style={{ gridColumn: week + 2, gridRow: dow + 2 }}
        title={`${entregas(n)} · ${dateLabel(key)} ${d.getUTCFullYear()}`}
      />,
    );
    if (dow === 6) week++;
  }

  return (
    <>
      <div className="contrib-h">
        <span>
          <span className="big">{total}</span> <span className="muted" style={{ fontSize: 14 }}>entregas no último ano</span>
        </span>
        <span className="legend-sq">
          Menos <i style={{ background: "var(--g0)" }} />
          <i style={{ background: "var(--g1)" }} />
          <i style={{ background: "var(--g2)" }} />
          <i style={{ background: "var(--g3)" }} />
          <i style={{ background: "var(--g4)" }} /> Mais
        </span>
      </div>
      <div className="contrib-scroll">
        <div className="cg" role="img" aria-label={`${total} entregas do time no último ano, por dia; o dia mais movimentado teve ${best}`}>
          {months}
          {[
            [1, "seg"],
            [3, "qua"],
            [5, "sex"],
          ].map(([row, label]) => (
            <span key={label} className="wd" style={{ gridRow: (row as number) + 2 }}>
              {label}
            </span>
          ))}
          {cells}
        </div>
      </div>
      <div className="contrib-f">
        <span>Total do time. O Shiplog nunca mostra esse número por pessoa.</span>
        <span>Contorno laranja: hoje</span>
      </div>
    </>
  );
}
