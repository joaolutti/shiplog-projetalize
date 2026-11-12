// The side panel for one shipment: what shipped, its verification and the ticket's discussion.
import Link from "next/link";
import type { Viewer } from "@/lib/auth/viewer";
import { when } from "@/lib/dates";
import { ticketDetail, ticketIdOfShipment } from "@/lib/shipments/queries";
import { DrawerFrame } from "./drawer-frame";
import { Discussion, VerificationBlock } from "./ticket-parts";
import { BranchTag, Icon, VerificationBadge, ViaFlag } from "./ui";

export async function ShipmentDrawer({ viewer, shipmentId, closeHref }: { viewer: Viewer; shipmentId: number; closeHref: string }) {
  const ticketId = await ticketIdOfShipment(shipmentId);
  const ticket = ticketId ? await ticketDetail(viewer, ticketId) : null;
  const s = ticket?.shipments.find((x) => x.id === shipmentId);
  if (!ticket || !s) return null;

  return (
    <DrawerFrame closeHref={closeHref} labelledBy="drawer-title">
      <div className="drawer-h">
        <span className="eyebrow">
          #{ticket.iid} · {ticket.projectPath}
        </span>
        <h2 id="drawer-title">{ticket.title}</h2>
        <div className="row">
          <BranchTag branch={s.branch} />
          <VerificationBadge status={s.verification} small />
          <ViaFlag via={s.publishedVia} />
        </div>
        {s.publishedAt && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Entregue {when(s.publishedAt)}
            {s.devName ? ` por ${s.devName}` : ""}
          </p>
        )}
      </div>
      <div className="drawer-b">
        <div>
          <span className="k">O que mudou</span>
          <p className="notes-text">{s.notes ?? <span className="muted">Sem notas.</span>}</p>
        </div>
        {s.status === "published" && <VerificationBlock shipment={s} />}
        <Discussion ticket={ticket} shipmentId={s.id} />
      </div>
      <div className="drawer-f">
        <Link className="btn primary" href={`/tickets/${ticket.id}`}>
          Ver detalhes
          <Icon name="arrow_forward" />
        </Link>
        <a className="btn ghost" href={ticket.webUrl} target="_blank" rel="noreferrer">
          Abrir no GitLab
          <Icon name="open_in_new" />
        </a>
      </div>
    </DrawerFrame>
  );
}
