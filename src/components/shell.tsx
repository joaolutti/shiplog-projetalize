"use client";
/**
 * The app frame (sidebar + top bar), ported from the prototype. Client-side only for what needs
 * the browser: collapsing the sidebar (remembered per browser), the mobile menu, and highlighting
 * the current page. Everything that reads the viewer is passed in as server-rendered slots.
 */
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "./ui";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  count?: number;
}

const COLLAPSED_KEY = "shiplog.side";
const COLLAPSED_EVENT = "shiplog:side";

// The collapsed sidebar is a per-browser preference in localStorage (absent on the server).
function subscribeCollapsed(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLLAPSED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLLAPSED_EVENT, onChange);
  };
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * No URL hooks here: the frame is part of every route's static shell, and reading the URL outside
 * <Suspense> would block prerendering (Cache Components). The crumb and the active link read it
 * inside their own boundaries.
 */
export function AppFrame(props: { nav: ReactNode; meter: ReactNode; user: ReactNode; actions: ReactNode; children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [navOpen, setNavOpen] = useState(false);

  const toggle = () => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {
      // not remembered, that's fine
    }
    window.dispatchEvent(new Event(COLLAPSED_EVENT));
  };

  return (
    <div className={`app ${collapsed ? "collapsed" : ""} ${navOpen ? "nav-open" : ""}`}>
      <aside className="side" aria-label="Navegação">
        <div className="side-h">
          <Link className="brand" href="/" aria-label="Início do Shiplog">
            <Image src="/patch-mark.png" alt="" width={32} height={32} priority />
            <span>shiplog</span>
          </Link>
          <button className="icon-btn side-toggle" onClick={toggle} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>
            <Icon name={collapsed ? "left_panel_open" : "left_panel_close"} />
          </button>
        </div>
        {/* Following a link closes the mobile menu. */}
        <nav className="snav" aria-label="Principal" onClick={(e) => (e.target as Element).closest("a") && setNavOpen(false)}>
          {props.nav}
        </nav>
        <div className="side-sp" />
        <div className="side-blk side-meter">{props.meter}</div>
        <div className="side-blk">{props.user}</div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="content">
        <header className="top">
          <button className="icon-btn menu" onClick={() => setNavOpen(true)} aria-label="Abrir menu">
            <Icon name="menu" />
          </button>
          <Suspense fallback={<div className="crumb" />}>
            <Crumb />
          </Suspense>
          <div className="top-r">{props.actions}</div>
        </header>
        {props.children}
      </div>
    </div>
  );
}

// With the current page highlighted. Reads the URL, so it renders inside a Suspense boundary.
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/feed" && pathname.startsWith("/tickets")));
  return <NavList items={items} active={active} />;
}

// The same links without a highlight, for the static shell.
export function NavList({ items, active = () => false }: { items: NavItem[]; active?: (href: string) => boolean }) {
  return (
    <>
      {items.map((item) => {
        const on = active(item.href);
        return (
          <Link key={item.href} href={item.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined} title={item.label}>
            <Icon name={item.icon} />
            <span className="lbl">{item.label}</span>
            {item.count ? <span className="count">{item.count}</span> : null}
            <Icon name="chevron_right" className="chev" />
          </Link>
        );
      })}
    </>
  );
}

const PAGES: Record<string, [string, string]> = {
  "/": ["Visão geral", "Como o time está entregando, em tempo real."],
  "/feed": ["Entregas", "Tudo o que foi entregue. Qualquer pessoa pode verificar."],
  "/unclaimed": ["Sem responsável", "Rascunhos que ainda não chegaram a um dev."],
  "/settings": ["Sua conta", "Conexões e o que o Shiplog nunca faz."],
  "/dev/slack-preview": ["Prévia do Slack", "As mensagens que o Shiplog envia por DM e no canal."],
};

function Crumb() {
  const pathname = usePathname();
  if (pathname.startsWith("/tickets/")) {
    return (
      <div className="crumb">
        <Link href="/feed">Entregas</Link>
        <span className="sep" />
        <span className="sub">Ticket</span>
      </div>
    );
  }
  const [title, sub] = PAGES[pathname] ?? ["Shiplog", ""];
  return (
    <div className="crumb">
      <span>{title}</span>
      {sub && <span className="sep" />}
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
