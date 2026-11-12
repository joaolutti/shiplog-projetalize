/**
 * Signed-in pages: the sidebar and top bar around them. The frame is static; the parts that
 * depend on who's viewing stream in behind Suspense (Cache Components).
 */
import Link from "next/link";
import { Suspense } from "react";
import { AppFrame, NavLinks, NavList, type NavItem } from "@/components/shell";
import { Avatar, Icon } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { shellSummary } from "@/lib/shipments/queries";

const BASE_NAV: NavItem[] = [
  { href: "/", label: "Visão geral", icon: "space_dashboard" },
  { href: "/feed", label: "Entregas", icon: "deployed_code" },
  { href: "/settings", label: "Sua conta", icon: "manage_accounts" },
];

const ROLE_LABEL = { member: "membro", dev: "dev", lead: "líder" } as const;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppFrame
      nav={
        <Suspense fallback={<NavList items={BASE_NAV} />}>
          <Nav />
        </Suspense>
      }
      meter={
        <Suspense fallback={null}>
          <Meter />
        </Suspense>
      }
      user={
        <Suspense fallback={null}>
          <UserBlock />
        </Suspense>
      }
      actions={
        <>
          <Link className="icon-btn" href="/feed" aria-label="Buscar entregas">
            <Icon name="search" />
          </Link>
          <Link className="cta" href="/feed?verification=unverified">
            <Icon name="task_alt" />
            <span className="lbl-l">Para verificar</span>
          </Link>
        </>
      }
    >
      {children}
      <p className="foot">O Shiplog só lê o GitLab. Discussão e verificação ficam aqui; o Slack avisa.</p>
    </AppFrame>
  );
}

// Highlights the current page; reads the URL, so it streams in behind Suspense.
function Nav() {
  return <NavLinks items={BASE_NAV} />;
}

async function Meter() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const { weekVerified, weekTotal } = await shellSummary();
  const pct = weekTotal ? Math.round((weekVerified / weekTotal) * 100) : 0;
  return (
    <>
      <div className="meter-h">
        <span className="muted">
          <span className="tab" style={{ color: "var(--color-text)" }}>
            {weekVerified} / {weekTotal}
          </span>{" "}
          verificadas
        </span>
        <Link href="/feed?verification=unverified">Pendentes</Link>
      </div>
      <div className="meter-bar" role="img" aria-label={`${weekVerified} de ${weekTotal} entregas da semana verificadas`}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

async function UserBlock() {
  const viewer = await getViewer();
  if (!viewer) return null;
  return (
    <Link className="user" href="/settings" title={viewer.name}>
      <Avatar name={viewer.name} image={viewer.image} me />
      <span className="nm">{viewer.name}</span>
      <span className="rolepill">{ROLE_LABEL[viewer.role]}</span>
    </Link>
  );
}
