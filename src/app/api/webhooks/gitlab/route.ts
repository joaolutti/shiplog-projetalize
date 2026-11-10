/**
 * POST /api/webhooks/gitlab: group webhook (Issue Hook + Merge Request Hook).
 * M1: verifyWebhookToken → storeAndEnqueue → 200. Never do work inline; GitLab
 * disables hooks that time out.
 */
export async function POST(_request: Request) {
  return Response.json({ error: "Not implemented (M1)" }, { status: 501 });
}
