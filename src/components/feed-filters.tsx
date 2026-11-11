"use client";
// Feed filters: they live in the URL (shareable links); changing one updates it right away.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";
import type { FeedOptions } from "@/lib/shipments/queries";
import { Icon } from "./ui";

const PERIODS = [
  ["", "Qualquer data"],
  ["7", "Últimos 7 dias"],
  ["30", "Últimos 30 dias"],
  ["90", "Últimos 90 dias"],
] as const;

export function FeedFilters({ options, count }: { options: FeedOptions; count: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  const value = (key: string) => params.get(key) ?? "";

  return (
    <div className="filters" role="group" aria-label="Filtros" aria-busy={pending}>
      <label className="search" htmlFor="f-q">
        <Icon name="search" />
        <input
          id="f-q"
          type="search"
          placeholder="Buscar issue, título, label…"
          defaultValue={value("q")}
          onChange={(e) => {
            clearTimeout(searchTimer.current);
            const q = e.target.value;
            searchTimer.current = setTimeout(() => set("q", q.trim()), 300);
          }}
        />
      </label>
      <label className="sr" htmlFor="f-ver">
        Verificação
      </label>
      <select className="sel" id="f-ver" value={value("verification")} onChange={(e) => set("verification", e.target.value)}>
        <option value="">Qualquer status</option>
        <option value="unverified">Aguardando verificação</option>
        <option value="verified">Verificado</option>
        <option value="issue_reported">Problema relatado</option>
      </select>
      <div className="seg" role="group" aria-label="Branch">
        {["", ...options.branches].map((b) => (
          <button key={b || "all"} type="button" aria-pressed={value("branch") === b} onClick={() => set("branch", b)}>
            {b || "Todas"}
          </button>
        ))}
      </div>
      <label className="sr" htmlFor="f-dev">
        Desenvolvedor
      </label>
      <select className="sel" id="f-dev" value={value("dev")} onChange={(e) => set("dev", e.target.value)}>
        <option value="">Qualquer dev</option>
        {options.devs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <label className="sr" htmlFor="f-req">
        Solicitante
      </label>
      <select className="sel" id="f-req" value={value("requester")} onChange={(e) => set("requester", e.target.value)}>
        <option value="">Qualquer solicitante</option>
        {options.requesters.map((r) => (
          <option key={r.slackId} value={r.slackId}>
            {r.name}
          </option>
        ))}
      </select>
      <label className="sr" htmlFor="f-days">
        Período
      </label>
      <select className="sel" id="f-days" value={value("days")} onChange={(e) => set("days", e.target.value)}>
        {PERIODS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <span className="muted tab" style={{ marginLeft: "auto", fontSize: 13 }}>
        {count} {count === 1 ? "entrega" : "entregas"}
      </span>
    </div>
  );
}

export function ViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const list = params.get("view") === "list";
  const go = (view: "grid" | "list") => {
    const next = new URLSearchParams(params);
    if (view === "list") next.set("view", "list");
    else next.delete("view");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  return (
    <div className="seg icons" role="group" aria-label="Visualização">
      <button type="button" aria-pressed={!list} aria-label="Cards" onClick={() => go("grid")}>
        <Icon name="grid_view" />
      </button>
      <button type="button" aria-pressed={list} aria-label="Lista" onClick={() => go("list")}>
        <Icon name="view_list" />
      </button>
    </div>
  );
}
