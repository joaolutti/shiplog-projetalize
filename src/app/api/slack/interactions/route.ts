/**
 * POST /api/slack/interactions: Block Kit button clicks + modal submissions.
 * Verify the signature on the raw body → open a modal inline if the button asks for one
 * (trigger_id expires in 3 s) → queue the rest for the worker → acknowledge.
 */
import { enqueue } from "@/lib/jobs/queue";
import { modalFor, needsWork, parseInteraction } from "@/lib/slack/interactions";
import { slack } from "@/lib/slack/client";
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

  const payload = parseInteraction(rawBody);
  if (!payload) return new Response(null, { status: 200 }); // types we don't handle

  if (payload.type === "block_actions" && payload.trigger_id) {
    const view = await modalFor(payload);
    if (view) await slack().views.open({ trigger_id: payload.trigger_id, view });
  }

  if (needsWork(payload)) await enqueue(JOBS.handleSlackInteraction, { payload });

  // An empty 200 acknowledges buttons and closes a submitted modal.
  return new Response(null, { status: 200 });
}
