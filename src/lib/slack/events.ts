/**
 * Slack Events API (D53): a ✅ added to a channel card verifies the shipment as that person,
 * removing it takes the verification back. Bot events: reaction_added, reaction_removed.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { shipments } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { unverify, verify } from "@/lib/shipments/commands";
import { execute } from "@/lib/shipments/effects";
import type { NextStep } from "@/lib/shipments/next-step";
import { botUserId, VERIFIED_REACTION } from "./client";
import { anyoneActor } from "./interactions";

export const reactionEvent = z.object({
  type: z.enum(["reaction_added", "reaction_removed"]),
  user: z.string(),
  reaction: z.string(),
  item: z.object({ type: z.string(), channel: z.string().optional(), ts: z.string().optional() }),
});
export type ReactionEvent = z.infer<typeof reactionEvent>;

const body = z.union([
  z.object({ type: z.literal("url_verification"), challenge: z.string() }),
  z.object({ type: z.literal("event_callback"), event: z.unknown() }),
]);

// The URL check Slack sends when the events URL is saved, a ✅ reaction to handle, or null for anything else.
export function parseSlackEvent(rawBody: string): { challenge: string } | { reaction: ReactionEvent } | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = body.safeParse(json);
  if (!parsed.success) return null;
  if (parsed.data.type === "url_verification") return { challenge: parsed.data.challenge };
  const event = reactionEvent.safeParse(parsed.data.event);
  return event.success && event.data.reaction === VERIFIED_REACTION ? { reaction: event.data } : null;
}

export async function handleReaction(e: ReactionEvent): Promise<NextStep | null> {
  if (e.item.type !== "message" || e.item.channel !== env("SLACK_FEED_CHANNEL_ID") || !e.item.ts) return null;
  if (e.user === (await botUserId())) return null;
  const [s] = await db()
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.feedMessageTs, e.item.ts));
  if (!s) return null;
  const actor = await anyoneActor(e.user);
  return e.type === "reaction_added"
    ? execute((tx) => verify(tx, { actor, shipmentId: s.id }))
    : execute((tx) => unverify(tx, { actor, shipmentId: s.id, onlyVerified: true }));
}
