/**
 * Entregas (M4): everything published, newest first. Anyone can verify or report a problem.
 * Filters (date, branch, dev, requester, verification, search) come from the URL.
 */
import { Suspense } from "react";
import { FeedFilters, ViewToggle } from "@/components/feed-filters";
import { ShipmentDrawer } from "@/components/shipment-drawer";
import { ShipmentCard, ShipmentTable } from "@/components/shipments";
import { Empty } from "@/components/ui";
import { requireViewer } from "@/lib/auth/viewer";
import { feedOptions, listFeed, type FeedFilters as Filters, type VerificationStatus } from "@/lib/shipments/queries";

const VERIFICATIONS: VerificationStatus[] = ["unverified", "verified", "issue_reported"];

export default function FeedPage({ searchParams }: PageProps<"/feed">) {
  return (
    <main className="view">
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function Feed({ searchParams }: Pick<PageProps<"/feed">, "searchParams">) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const verification = one(sp.verification) as VerificationStatus | undefined;
  const days = Number(one(sp.days));
  const filters: Filters = {
    branch: one(sp.branch),
    verification: verification && VERIFICATIONS.includes(verification) ? verification : undefined,
    dev: one(sp.dev),
    requester: one(sp.requester),
    q: one(sp.q),
    days: Number.isInteger(days) && days > 0 ? days : undefined,
  };
  const [items, options] = await Promise.all([listFeed(viewer, filters), feedOptions()]);
  const list = one(sp.view) === "list";
  const tech = viewer.role !== "member";

  // The side panel is ?s=<shipment>, on top of the current filters.
  const base = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (k === "s" || v === undefined ? [] : [[k, String(one(v))]])));
  const panelHref = (shipmentId: number) => `/feed?${new URLSearchParams([...base, ["s", String(shipmentId)]])}`;
  const closeHref = `/feed${base.size ? `?${base}` : ""}`;
  const open = Number(one(sp.s));

  return (
    <>
      <section className="band">
        <div className="pad">
          <div className="sec-h" style={{ marginBottom: 20 }}>
            <div>
              <h2>Todas as entregas</h2>
              <p>Do mais recente ao mais antigo. Verifique o que você testou ou relate um problema para o dev receber uma DM.</p>
            </div>
            <ViewToggle />
          </div>
          <FeedFilters options={options} count={items.length} />
        </div>
      </section>
      <section>
        {items.length === 0 ? (
          <Empty>Nenhuma entrega com esses filtros.</Empty>
        ) : list ? (
          <div className="t flush">
            <ShipmentTable items={items} actions href={panelHref} tech={tech} />
          </div>
        ) : (
          <div className="cards">
            {items.map((item) => (
              <ShipmentCard key={item.shipmentId} item={item} href={panelHref} tech={tech} />
            ))}
          </div>
        )}
      </section>
      {Number.isInteger(open) && open > 0 && <ShipmentDrawer viewer={viewer} shipmentId={open} closeHref={closeHref} />}
    </>
  );
}
