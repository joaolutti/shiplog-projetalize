/**
 * Small presentational pieces shared by the pages (docs/ARCHITECTURE.md §7). Server-safe: no
 * state, no hooks. Class names come from globals.css.
 */
import type { ReactNode } from "react";
import type { VerificationStatus } from "@/lib/shipments/queries";

export function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`ms ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

export function BranchTag({ branch }: { branch: string | null }) {
  if (!branch) return <span className="branch">Sem branch</span>;
  const main = branch.toLowerCase() === "main";
  return (
    <span className={`branch ${main ? "main" : ""}`}>
      {main && <Icon name="rocket_launch" />}
      {branch}
    </span>
  );
}

const VERIFICATION: Record<VerificationStatus, { label: string; tone: string }> = {
  issue_reported: { label: "Problema relatado", tone: "warn" },
  verified: { label: "Verificado", tone: "ok" },
  unverified: { label: "Aguardando verificação", tone: "wait" },
};

export function VerificationBadge({ status, small }: { status: VerificationStatus; small?: boolean }) {
  const v = VERIFICATION[status];
  return (
    <span className={`dot ${small ? "sm" : ""} ${v.tone}`}>
      <i />
      {v.label}
    </span>
  );
}

export function ViaFlag({ via }: { via: "confirmed" | "auto" | null }) {
  if (via === "auto") {
    return (
      <span className="flag" title="Ninguém confirmou as notas do rascunho em 24 horas">
        <Icon name="schedule" />
        Notas não confirmadas
      </span>
    );
  }
  return null;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function Avatar({ name, image, size, me }: { name: string; image?: string | null; size?: "sm"; me?: boolean }) {
  return (
    <span className={`avatar ${size ?? ""} ${me ? "me" : ""}`} title={name} aria-hidden="true">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- Slack avatar URLs, already small
        <img src={image} alt="" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Chip({ tone, children }: { tone: "issue" | "warn" | "ok" | "roxo"; children: ReactNode }) {
  return (
    <span className={`chip c-${tone}`}>
      <i />
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
