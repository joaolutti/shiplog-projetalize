/**
 * DATABASE_URL for node-postgres (pg-boss, drizzle-kit). pg now reads `sslmode=require` as "verify the
 * certificate", which fails against poolers like Supabase's; `uselibpqcompat=true` restores libpq's meaning
 * (encrypt, don't verify), the one postgres.js already uses. postgres.js gets the URL unchanged: it would
 * send the extra parameter to the server, which rejects it.
 */
export function pgUrl(url: string): string {
  const u = new URL(url);
  if (u.searchParams.has("sslmode") && !u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
  return u.toString();
}
