/**
 * Sem responsável (M2, leads): shipments whose recipient has no linked account (D10).
 * A lead assigns a dev or lead, or publishes it as is.
 */
import { Suspense } from "react";
import { assignAction, publishAction } from "./actions";
import { requireRole } from "@/lib/auth/viewer";
import { listAssignable, listUnclaimed } from "@/lib/shipments/queries";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo", // D42
});

export default function UnclaimedPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Sem responsável</h1>
      <p className="mt-2 text-sm text-muted">
        Entregas cuja pessoa responsável ainda não conectou o GitLab. Atribua a alguém do time ou publique
        como lead.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-muted">Carregando…</p>}>
        <Queue />
      </Suspense>
    </main>
  );
}

async function Queue() {
  const viewer = await requireRole("lead");
  const [unclaimed, assignable] = await Promise.all([listUnclaimed(viewer), listAssignable(viewer)]);

  if (unclaimed.length === 0) {
    return <p className="mt-8 text-sm text-muted">Nada pendente.</p>;
  }

  return (
    <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-surface">
      {unclaimed.map((s) => (
        <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <a href={s.ticket.webUrl} className="font-medium hover:underline" target="_blank" rel="noreferrer">
              #{s.ticket.iid} {s.ticket.title}
            </a>
            <p className="mt-1 text-xs text-muted">
              {s.ticket.projectPath} · {s.branch ?? "sem branch"} · {dateFormat.format(s.createdAt)}
              {s.intendedGitlabId && ` · era para o usuário ${s.intendedGitlabId} do GitLab`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <form action={assignAction} className="flex items-center gap-2">
              <input type="hidden" name="shipmentId" value={s.id} />
              <select name="userId" required className="rounded border border-border bg-background px-2 py-1">
                <option value="">Atribuir a…</option>
                {assignable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="text-muted hover:text-foreground">
                Atribuir
              </button>
            </form>
            <form action={publishAction}>
              <input type="hidden" name="shipmentId" value={s.id} />
              <button
                type="submit"
                disabled={!s.branch}
                title={s.branch ? undefined : "Escolha a branch antes de publicar"}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Publicar
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
