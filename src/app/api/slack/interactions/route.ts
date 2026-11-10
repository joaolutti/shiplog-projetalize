/**
 * POST /api/slack/interactions: Block Kit button clicks + modal submissions.
 * M3: verifySlackSignature on the raw body → enqueue handle-slack-interaction → ack
 * within 3s (opening an edit modal must happen inline using the trigger_id).
 */
export async function POST(_request: Request) {
  return Response.json({ error: "Not implemented (M3)" }, { status: 501 });
}
