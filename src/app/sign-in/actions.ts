"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

// Starts "Entrar com o Slack"; Better Auth sets the OAuth state cookie (nextCookies).
export async function signInWithSlack() {
  const { url } = await auth().api.signInSocial({
    headers: await headers(),
    body: { provider: "slack", callbackURL: "/", errorCallbackURL: "/sign-in" },
  });
  if (!url) throw new Error("Slack sign-in returned no URL");
  redirect(url);
}
