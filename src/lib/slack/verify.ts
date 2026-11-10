/**
 * Slack request signing: v0=HMAC-SHA256(signing_secret, "v0:{timestamp}:{raw body}"),
 * compared with X-Slack-Signature. Reject timestamps older than 5 minutes.
 */
import { notImplemented } from "@/lib/not-implemented";

export function verifySlackSignature(_args: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  return notImplemented("verifySlackSignature", "M3");
}
