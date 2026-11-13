"use client";
// Feed filters: they live in the URL (shareable links); changing one updates it right away.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";
import type { FeedOptions } from "@/lib/shipments/queries";
import { Combobox } from "./combobox";
import { Icon } from "./ui";

const STATUSES = [
  { value: "unverified", label: "Aguardando verificação" },
  { value: "verified", label: "Verificado" },
  { value: "issue_reported", label: "Problema relatado" },
];

const PERIODS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
];

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
      <Combobox label="Status" icon="task_alt" all="Qualquer status" options={STATUSES} value={value("verification")} onChange={(v) => set("verification", v)} />
      <Combobox
        label="Branch"
        icon="alt_route"
        all="Todas as branches"
        options={options.branches.map((b) => ({ value: b, label: b }))}
        value={value("branch")}
        onChange={(v) => set("branch", v)}
      />
      <Combobox
        label="Dev"
        icon="person"
        all="Qualquer dev"
        search
        options={options.devs.map((d) => ({ value: d.id, label: d.name }))}
        value={value("dev")}
        onChange={(v) => set("dev", v)}
      />
      <Combobox
        label="Solicitante"
        icon="person_raised_hand"
        all="Qualquer solicitante"
        search
        options={options.requesters.map((r) => ({ value: r.slackId, label: r.name }))}
        value={value("requester")}
        onChange={(v) => set("requester", v)}
      />
      <Combobox label="Período" icon="calendar_today" all="Qualquer data" options={PERIODS} value={value("days")} onChange={(v) => set("days", v)} />
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
