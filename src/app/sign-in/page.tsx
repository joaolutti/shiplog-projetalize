// Sign in with Slack: the only way in (D14).
import Image from "next/image";
import { Suspense } from "react";
import { signInWithSlack } from "./actions";

// Better Auth's error codes (and ours from lib/auth/identity.ts) in pt-BR.
const ERRORS: Record<string, string> = {
  wrong_workspace: "Essa conta não é do Slack da empresa. Entre com a sua conta do workspace da empresa.",
  gitlab_link_only: "O GitLab não é usado para entrar. Entre com o Slack e conecte o GitLab em Sua conta.",
  provider_not_allowed: "Use o Slack para entrar.",
  access_denied: "O acesso foi cancelado no Slack.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="signin">
      <div className="signin-card">
        <Image src="/patch-greeting.svg" alt="Patch, o pirata do Shiplog, acenando" width={1096} height={1326} priority />
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <span className="eyebrow">Shiplog</span>
            <h1 style={{ fontSize: 28, marginTop: 6 }}>Ahoy! Bem-vindo a bordo.</h1>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
              Tudo o que o time entrega, num lugar só: verifique, comente e acompanhe. Entre com a sua conta do Slack da empresa.
            </p>
          </div>
          <Suspense fallback={null}>
            <SignInError searchParams={searchParams} />
          </Suspense>
          <form action={signInWithSlack}>
            <button type="submit" className="btn primary" style={{ height: 44, padding: "0 22px", fontSize: 14 }}>
              Entrar com o Slack
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

async function SignInError({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const { error } = await searchParams;
  if (typeof error !== "string") return null;
  return (
    <p role="alert" className="alert">
      {ERRORS[error.toLowerCase()] ?? "Não foi possível entrar. Tente de novo."}
    </p>
  );
}
