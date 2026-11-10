/**
 * Better Auth handler (M2). Will become:
 *   export const { GET, POST } = toNextJsHandler(auth());
 */
export async function GET() {
  return Response.json({ error: "Not implemented (M2)" }, { status: 501 });
}

export async function POST() {
  return Response.json({ error: "Not implemented (M2)" }, { status: 501 });
}
