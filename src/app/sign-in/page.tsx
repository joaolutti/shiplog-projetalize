// Sign in with Slack: the only way in (D14).
import { Suspense } from "react";
import { signInWithSlack } from "./actions";

// Better Auth's error codes (and ours from lib/auth/identity.ts) in pt-BR.
const ERRORS: Record<string, string> = {
  wrong_workspace: "Essa conta não é do Slack da empresa. Entre com a sua conta do workspace da empresa.",
  gitlab_link_only: "O GitLab não é usado para entrar. Entre com o Slack e conecte o GitLab em Configurações.",
  provider_not_allowed: "Use o Slack para entrar.",
  access_denied: "O acesso foi cancelado no Slack.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Entrar no Shiplog</h1>
        <p className="mt-2 text-sm text-muted">Use a sua conta do Slack da empresa.</p>
      </div>
      <Suspense fallback={null}>
        <SignInError searchParams={searchParams} />
      </Suspense>
      <form action={signInWithSlack}>
        <button
          type="submit"
          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          Entrar com o Slack
        </button>
      </form>
    </main>
  );
}

async function SignInError({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const { error } = await searchParams;
  if (typeof error !== "string") return null;
  return (
    <p role="alert" className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
      {ERRORS[error.toLowerCase()] ?? "Não foi possível entrar. Tente de novo."}
    </p>
  );
}
