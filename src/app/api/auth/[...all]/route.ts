// Better Auth handler: OAuth redirects and callbacks for Slack sign-in and GitLab linking.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/auth";

// Resolved per request so the build doesn't need auth secrets.
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
