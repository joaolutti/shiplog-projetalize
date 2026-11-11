// Sua conta (M2): connections, roles for leads, and what Shiplog never does.
import { Suspense } from "react";
import { changeRole, connectGitlab } from "./actions";
import { signOutAction } from "@/app/(app)/actions";
import { Avatar, Icon } from "@/components/ui";
import { requireViewer, type Role, type Viewer } from "@/lib/auth/viewer";
import { listTeam } from "@/lib/shipments/queries";

const ROLE_LABEL: Record<Role, string> = { member: "membro", dev: "dev", lead: "líder" };

const LINK_ERRORS: Record<string, string> = {
  not_in_group: "Essa conta do GitLab não faz parte do grupo da empresa (acesso de Developer ou mais).",
  account_already_linked_to_different_user: "Essa conta do GitLab já está conectada a outra pessoa.",
  unable_to_link_account: "O GitLab não confirmou o e-mail dessa conta. Confirme o e-mail no GitLab e tente de novo.",
};

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="view">
      <Suspense fallback={<p className="muted">Carregando…</p>}>
        <Account searchParams={searchParams} />
      </Suspense>
      <NeverRules />
    </main>
  );
}

async function Account({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const viewer = await requireViewer();
  const { error } = await searchParams;
  return (
    <>
      {typeof error === "string" && (
        <p role="alert" className="alert">
          {LINK_ERRORS[error.toLowerCase()] ?? "Não foi possível conectar o GitLab. Tente de novo."}
        </p>
      )}
      <section className="band">
        <div className="pad row" style={{ gap: 16, justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 16 }}>
            <span style={{ transform: "scale(1.6)", margin: "0 10px" }}>
              <Avatar name={viewer.name} image={viewer.image} me />
            </span>
            <div>
              <h1>{viewer.name}</h1>
              <p className="muted" style={{ margin: "2px 0 0" }}>
                {viewer.email} · Papel: <span style={{ color: "var(--color-text)" }}>{ROLE_LABEL[viewer.role]}</span>. Quem altera papéis são
                os líderes.
              </p>
            </div>
          </div>
          <form action={signOutAction}>
            <button className="btn ghost sm">
              <Icon name="logout" />
              Sair
            </button>
          </form>
        </div>
      </section>
      <section className="acct">
        <div className="t pad">
          <div className="conn">
            <span className="ib">
              <Icon name="tag" />
            </span>
            <div className="bd">
              <h2>Slack</h2>
              <p>Todo mundo entra com o workspace do Slack da empresa.</p>
              <div className="resolved">
                <Icon name="check_circle" />
                Conectado
              </div>
            </div>
          </div>
        </div>
        <div className="t pad">
          <div className="conn">
            <span className="ib">
              <Icon name="code" />
            </span>
            <div className="bd">
              <h2>GitLab</h2>
              <p>Vincula seu usuário do GitLab para os rascunhos chegarem até você. O Shiplog pede só read_user e nunca grava no GitLab.</p>
              {viewer.gitlabId ? (
                <div className="resolved">
                  <Icon name="check_circle" />
                  Conectado (ID {viewer.gitlabId})
                </div>
              ) : (
                <form action={connectGitlab}>
                  <button className="btn primary sm">Conectar GitLab</button>
                </form>
              )}
              {!viewer.gitlabId && viewer.role === "member" && <p style={{ fontSize: 12 }}>Só devs e líderes precisam conectar.</p>}
            </div>
          </div>
        </div>
      </section>
      {viewer.role === "lead" && <Team viewer={viewer} />}
    </>
  );
}

async function Team({ viewer }: { viewer: Viewer }) {
  const team = await listTeam(viewer);
  return (
    <section className="t flush" aria-labelledby="team-h">
      <div className="pad" style={{ paddingBottom: 16 }}>
        <h2 id="team-h">Equipe</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Conectar o GitLab torna a pessoa dev. Líderes ajustam os papéis aqui.
        </p>
      </div>
      <div className="tbl-wrap">
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>GitLab</th>
              <th>Papel</th>
            </tr>
          </thead>
          <tbody>
            {team.map((member) => (
              <tr key={member.id}>
                <td>
                  {member.name} <span className="muted">· {member.email}</span>
                </td>
                <td className="muted">{member.gitlabId ? "Conectado" : "—"}</td>
                <td>
                  <form action={changeRole} className="row">
                    <input type="hidden" name="userId" value={member.id} />
                    <select name="role" defaultValue={member.role} className="sel sm">
                      {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost sm">Salvar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Static, so it's part of the prerendered shell. Mirrors the hard rules in AGENTS.md.
function NeverRules() {
  return (
    <section className="band pad" aria-labelledby="rules-h">
      <h2 id="rules-h" style={{ marginBottom: 16 }}>
        O que o Shiplog nunca faz
      </h2>
      <ul className="rules">
        <li>
          <Icon name="block" />
          Gravar qualquer coisa no GitLab. Ele só lê issues e merge requests.
        </li>
        <li>
          <Icon name="block" />
          Ranquear ou pontuar devs individualmente. Não existe ranking.
        </li>
        <li>
          <Icon name="block" />
          Guardar diffs de código. Só ficam números como arquivos alterados.
        </li>
        <li>
          <Icon name="block" />
          Mostrar as revisões de peso para quem não é do time de dev ou líder.
        </li>
      </ul>
    </section>
  );
}
