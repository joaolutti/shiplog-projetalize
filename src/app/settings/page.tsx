/** Configurações (M2): account, "Conectar GitLab", roles for leads, and what Shiplog never does. */
import { Suspense } from "react";
import { changeRole, connectGitlab } from "./actions";
import { requireViewer, type Role, type Viewer } from "@/lib/auth/viewer";
import { listTeam } from "@/lib/shipments/queries";

const ROLE_LABEL: Record<Role, string> = { member: "Membro", dev: "Dev", lead: "Lead" };

const LINK_ERRORS: Record<string, string> = {
  not_in_group: "Essa conta do GitLab não faz parte do grupo da empresa (acesso de Developer ou mais).",
  account_already_linked_to_different_user: "Essa conta do GitLab já está conectada a outra pessoa.",
};

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-muted">Carregando…</p>}>
        <Settings searchParams={searchParams} />
      </Suspense>
      <NeverRules />
    </main>
  );
}

async function Settings({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const viewer = await requireViewer();
  const { error } = await searchParams;
  return (
    <>
      {typeof error === "string" && (
        <p role="alert" className="mt-6 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
          {LINK_ERRORS[error.toLowerCase()] ?? "Não foi possível conectar o GitLab. Tente de novo."}
        </p>
      )}
      <Section title="Sua conta">
        <p className="text-sm">
          {viewer.name} <span className="text-muted">· {viewer.email}</span>
        </p>
        <p className="mt-1 text-sm text-muted">Papel: {ROLE_LABEL[viewer.role]}</p>
      </Section>
      <Section title="Conexões">
        <ul className="divide-y divide-border text-sm">
          <li className="flex items-center justify-between py-2">
            <span>Slack</span>
            <span className="text-muted">Conectado</span>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>GitLab</span>
            {viewer.gitlabId ? (
              <span className="text-muted">Conectado (ID {viewer.gitlabId})</span>
            ) : (
              <form action={connectGitlab}>
                <button type="submit" className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:opacity-90">
                  Conectar GitLab
                </button>
              </form>
            )}
          </li>
        </ul>
        {!viewer.gitlabId && (
          <p className="mt-2 text-xs text-muted">
            Para devs e leads: liga você às suas issues e MRs, para receber os rascunhos de entrega.
          </p>
        )}
      </Section>
      {viewer.role === "lead" && <Team viewer={viewer} />}
    </>
  );
}

async function Team({ viewer }: { viewer: Viewer }) {
  const team = await listTeam(viewer);
  return (
    <Section title="Equipe">
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-2 font-normal">Pessoa</th>
            <th className="py-2 font-normal">GitLab</th>
            <th className="py-2 font-normal">Papel</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {team.map((member) => (
            <tr key={member.id}>
              <td className="py-2">
                {member.name} <span className="text-muted">· {member.email}</span>
              </td>
              <td className="py-2 text-muted">{member.gitlabId ? "Conectado" : "—"}</td>
              <td className="py-2">
                <form action={changeRole} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={member.id} />
                  <select
                    name="role"
                    defaultValue={member.role}
                    className="rounded border border-border bg-surface px-2 py-1"
                  >
                    {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="text-muted hover:text-foreground">
                    Salvar
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

/** Static, so it's part of the prerendered shell. Mirrors the hard rules in AGENTS.md. */
function NeverRules() {
  return (
    <Section title="O que o Shiplog nunca faz">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
        <li>Escrever no GitLab: só lê, com um token de leitura.</li>
        <li>Guardar o código (diffs) dos MRs.</li>
        <li>Criar rankings, placares ou totais por pessoa.</li>
        <li>Mostrar a revisão de peso para quem não é dev ou lead.</li>
      </ul>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}
