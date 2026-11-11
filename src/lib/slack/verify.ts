/**
 * Slack request signing: v0=HMAC-SHA256(signing_secret, "v0:{timestamp}:{raw body}"),
 * compared with X-Slack-Signature. Reject timestamps older than 5 minutes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const MAX_AGE_SECONDS = 5 * 60;

export function verifySlackSignature(args: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  /** Injectable for tests. */
  secret?: string;
  now?: number;
}): boolean {
  const { rawBody, timestamp, signature } = args;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const nowSeconds = Math.floor((args.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_AGE_SECONDS) return false;

  const secret = args.secret ?? env("SLACK_SIGNING_SECRET");
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
