/**
 * Requester → Slack user (D16 revised). The issue's `Solicitante` is a name or @handle;
 * it's matched against the workspace directory (users.list, cached for 1 hour), ignoring
 * case and accents: names against real_name / display_name, a @handle against the username.
 * Only a single match counts; otherwise the dev picks the person in the draft DM.
 */
import type { RequesterRef } from "@/lib/gitlab/templates";
import { slack } from "./client";

export interface DirectoryUser {
  id: string;
  /** Username, e.g. "ana.ribeiro". */
  name: string;
  realName: string;
  displayName: string;
}

export type RequesterMatch =
  | { kind: "found"; slackUserId: string }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: string[] };

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchRequester(ref: RequesterRef, users: DirectoryUser[]): RequesterMatch {
  const wanted = normalizeName(ref.value);
  const hits =
    ref.kind === "handle"
      ? users.filter((u) => normalizeName(u.name) === wanted)
      : users.filter((u) => [u.realName, u.displayName].some((n) => n && normalizeName(n) === wanted));
  if (hits.length === 1) return { kind: "found", slackUserId: hits[0].id };
  if (hits.length === 0) return { kind: "not_found" };
  return { kind: "ambiguous", candidates: hits.map((u) => u.id) };
}

const TTL_MS = 60 * 60 * 1000;
let cached: { at: number; users: DirectoryUser[] } | undefined;

/** Active, human members of the workspace. */
export async function directory(): Promise<DirectoryUser[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.users;
  const users: DirectoryUser[] = [];
  let cursor: string | undefined;
  do {
    const page = await slack().users.list({ limit: 200, cursor });
    for (const m of page.members ?? []) {
      if (!m.id || m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
      users.push({
        id: m.id,
        name: m.name ?? "",
        realName: m.profile?.real_name ?? m.real_name ?? "",
        displayName: m.profile?.display_name ?? "",
      });
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  cached = { at: Date.now(), users };
  return users;
}

export async function resolveRequester(ref: RequesterRef): Promise<RequesterMatch> {
  return matchRequester(ref, await directory());
}
