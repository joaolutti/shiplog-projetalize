import { WebClient } from "@slack/web-api";

/**
 * Bot scopes: chat:write, im:write, users:read, users:read.email
 * (v2: channels:history for thread mirroring)
 */
let instance: WebClient | undefined;

export function slack(): WebClient {
  instance ??= new WebClient(process.env.SLACK_BOT_TOKEN);
  return instance;
}
