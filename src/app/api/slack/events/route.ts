/**
 * POST /api/slack/events: Slack Events API (D53). Verify the signature on the raw body → answer
 * the URL check → queue ✅ reactions for the worker → acknowledge within 3 s.
 */
import { enqueue } from "@/lib/jobs/queue";
import { parseSlackEvent } from "@/lib/slack/events";
import { verifySlackSignature } from "@/lib/slack/verify";
import { JOBS } from "@/worker/jobs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const valid = verifySlackSignature({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  if (!valid) return new Response("invalid signature", { status: 401 });

  const parsed = parseSlackEvent(rawBody);
  if (parsed && "challenge" in parsed) return Response.json({ challenge: parsed.challenge });
  if (parsed) await enqueue(JOBS.handleSlackReaction, { event: parsed.reaction });
  return new Response(null, { status: 200 });
}
