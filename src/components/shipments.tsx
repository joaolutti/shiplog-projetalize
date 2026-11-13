// Shipment lists for the overview and the feed: cards and a table (ported from the prototype).
import Image from "next/image";
import Link from "next/link";
import { unverifyAction, verifyAction } from "@/app/(app)/actions";
import { shortDate } from "@/lib/dates";
import type { FeedItem } from "@/lib/shipments/queries";
import { Avatar, BranchTag, Empty, Icon, VerificationBadge, ViaFlag } from "./ui";


// The viewer's verify control for a published shipment.
export function VerifyControl({ item, variant = "text" }: { item: Pick<FeedItem, "shipmentId" | "ticketId" | "mine">; variant?: "text" | "button" }) {
  if (item.mine === "verified") {
    return (
      <form action={unverifyAction}>
        <input type="hidden" name="shipmentId" value={item.shipmentId} />
        <button className={variant === "text" ? "btn text" : "btn sm done"} style={variant === "text" ? { color: "var(--color-ok-text)" } : undefined} title="Desfazer">
          <Icon name="check" />
          Você verificou
        </button>
      </form>
    );
  }
  if (item.mine === "issue_reported") {
    return (
      <Link className={variant === "text" ? "btn text dim" : "btn sm neutral"} href={`/tickets/${item.ticketId}`}>
        Ver seu relato
      </Link>
    );
  }
  return (
    <form action={verifyAction}>
      <input type="hidden" name="shipmentId" value={item.shipmentId} />
      <button className={variant === "text" ? "btn text" : "btn sm neutral"}>
        <Icon name={variant === "text" ? "task_alt" : "check"} />
        Verificar
      </button>
    </form>
  );
}

// Where a card or row leads: the side panel for that shipment, on the current page.
export type PanelHref = (shipmentId: number) => string;

// `tech`: project path and GitLab link, for devs and leads only. MR, repo and line counts aren't shown in v1 (D51).
export function ShipmentCard({ item, href, tech }: { item: FeedItem; href: PanelHref; tech: boolean }) {
  return (
    <article className="ac">
      <div className="ac-h">
        <div className="ac-tt">
          <span className="iid">
            #{item.iid}
            {tech && ` · ${item.projectPath}`}
          </span>
          <Link className="stretch" href={href(item.shipmentId)} scroll={false}>
            {item.title}
          </Link>
          <div className="row" style={{ gap: 10 }}>
            <BranchTag branch={item.branch} />
            <VerificationBadge status={item.verification} small />
            {item.verifiers.length > 0 && (
              <span className="avatars">
                {item.verifiers.map((v) => (
                  <Avatar key={v.name} name={v.name} image={v.image} size="sm" />
                ))}
              </span>
            )}
          </div>
        </div>
        {item.bug ? (
          <Image className="mascot" src="/patch-investigation.png" alt="Bug" title="Bug" width={56} height={60} />
        ) : (
          <Image className="mascot" src="/patch-shipping.png" alt="" width={56} height={59} />
        )}
      </div>
      {item.notes && <p className="ac-notes">{item.notes}</p>}
      {item.requesterName && <p className="ac-who">Solicitado por {item.requesterName}</p>}
      {tech && (
        <div className="ac-box">
          <a className="ac-url" href={item.webUrl} target="_blank" rel="noreferrer">
            <span>{item.webUrl.replace(/^https?:\/\//, "")}</span>
            <Icon name="open_in_new" />
          </a>
        </div>
      )}
      {item.publishedVia === "auto" && (
        <div className="ac-tags">
          <ViaFlag via={item.publishedVia} />
        </div>
      )}
      <div className="ac-f">
        <span className="when">
          <Icon name="schedule" />
          Entregue <b>{shortDate(item.publishedAt)}</b>
        </span>
        <span className="row" style={{ gap: 4 }}>
          {!item.mine && (
            <Link className="btn text dim" href={href(item.shipmentId)} scroll={false}>
              Relatar
            </Link>
          )}
          <VerifyControl item={item} />
        </span>
      </div>
    </article>
  );
}

export function ShipmentTable({ items, actions, href, tech }: { items: FeedItem[]; actions?: boolean; href: PanelHref; tech: boolean }) {
  if (items.length === 0) return <Empty>Nenhuma entrega com esses filtros.</Empty>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Status</th>
            <th>{tech ? "Issue · projeto" : "Issue"}</th>
            <th>Branch</th>
            <th>Entregue</th>
            <th className="n">{actions ? "Ação" : "Abrir"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.shipmentId}>
              <td>
                <VerificationBadge status={item.verification} />
              </td>
              <td>
                <div className="iss">
                  <span className="iid">#{item.iid}</span>
                  <Link href={href(item.shipmentId)} scroll={false} title={item.title}>
                    {item.title}
                  </Link>
                </div>
                {tech && (
                  <div className="proj" style={{ marginTop: 2 }}>
                    {item.projectPath}
                  </div>
                )}
              </td>
              <td>
                <BranchTag branch={item.branch} />
              </td>
              <td className="muted tab">{shortDate(item.publishedAt)}</td>
              <td className="n">
                {actions ? (
                  <VerifyControl item={item} variant="button" />
                ) : (
                  <Link className="go" href={href(item.shipmentId)} scroll={false} aria-label={`Abrir #${item.iid}`}>
                    <Icon name="arrow_outward" />
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
