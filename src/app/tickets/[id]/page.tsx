/**
 * Ticket page (M4): GitLab details, shipments per branch, verification
 * (verify / report issue), discussion thread. Weight review visible to dev + lead only.
 *
 * Cache Components is on: per-request data (params, DB reads) must sit inside <Suspense>.
 */
import { Suspense } from "react";

async function TicketHeader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <h1 className="text-2xl font-semibold">Ticket {id}</h1>;
}

export default function TicketPage(props: PageProps<"/tickets/[id]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Suspense fallback={<h1 className="text-2xl font-semibold">Ticket…</h1>}>
        <TicketHeader params={props.params} />
      </Suspense>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">Scaffold only (M4).</p>
    </main>
  );
}
