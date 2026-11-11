/**
 * Development only: GET /dev/as?email=… signs this browser in as that user without Slack
 * ("ver como", docs/ARCHITECTURE.md §7); /dev/as with no email signs out. Refused in production
 * and for anything that didn't come from this machine (see devImpersonationAllowed).
 */
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { DEV_AS_COOKIE, devImpersonationAllowed } from "@/lib/auth/viewer";

export async function GET(request: Request) {
  if (!devImpersonationAllowed(request.headers)) return new Response("Not found", { status: 404 });

  const email = new URL(request.url).searchParams.get("email");
  const jar = await cookies();
  if (!email) {
    jar.delete(DEV_AS_COOKIE);
    return Response.redirect(new URL("/sign-in", request.url));
  }
  const [row] = await db().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) return new Response(`No user with email ${email}`, { status: 404 });
  jar.set(DEV_AS_COOKIE, row.id, { httpOnly: true, sameSite: "lax", path: "/" });
  return Response.redirect(new URL("/", request.url));
}
