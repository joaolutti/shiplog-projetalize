/**
 * POST /api/webhooks/gitlab: group webhook (Issue Hook + Merge Request Hook).
 * verifyWebhookToken → storeAndEnqueue → 200. Never do work inline; GitLab
 * disables hooks that time out.
 */
import { handledEventType, storeAndEnqueue, verifyWebhookToken } from "@/lib/gitlab/webhook";

export async function POST(request: Request) {
  if (!verifyWebhookToken(request.headers.get("x-gitlab-token"))) {
    return Response.json({ error: "invalid token" }, { status: 401 });
  }

  const eventType = handledEventType(request.headers.get("x-gitlab-event"));
  if (!eventType) {
    // Other hook types (notes, pipelines…) are acknowledged and dropped.
    return Response.json({ ok: true, ignored: true });
  }

  const eventUuid = request.headers.get("x-gitlab-event-uuid");
  if (!eventUuid) {
    return Response.json({ error: "missing X-Gitlab-Event-UUID" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const { duplicate } = await storeAndEnqueue({ eventUuid, eventType, payload });
    return Response.json({ ok: true, duplicate });
  } catch (err) {
    console.error("[webhook/gitlab] store failed", err);
    return Response.json({ error: "store failed" }, { status: 500 });
  }
}
