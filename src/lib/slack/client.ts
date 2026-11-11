/**
 * Slack Web API (bot token). Bot scopes: chat:write, im:write, users:read
 * (v2: channels:history for thread mirroring).
 *
 * All DMs go through sendDm, which applies the SLACK_DM_ALLOWLIST development guard.
 */
import type { KnownBlock } from "@slack/types";
import { WebClient } from "@slack/web-api";
import { env } from "@/lib/env";

let instance: WebClient | undefined;

export function slack(): WebClient {
  instance ??= new WebClient(env("SLACK_BOT_TOKEN"));
  return instance;
}

export interface SlackMessage {
  /** Notification and accessibility fallback. */
  text: string;
  blocks: KnownBlock[];
}

export interface MessageRef {
  channel: string;
  ts: string;
}

/** Where a DM for `slackUserId` actually goes, given the development allowlist. */
export function dmTarget(
  slackUserId: string,
  allowlist: string | undefined,
): { userId: string; redirectedFrom: string | null } {
  const allowed = (allowlist ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (allowed.length === 0 || allowed.includes(slackUserId)) return { userId: slackUserId, redirectedFrom: null };
  return { userId: allowed[0], redirectedFrom: slackUserId };
}

/** Opens (or reuses) the DM with a user and posts the message. */
export async function sendDm(slackUserId: string, message: SlackMessage): Promise<MessageRef> {
  const target = dmTarget(slackUserId, env("SLACK_DM_ALLOWLIST"));
  const blocks: KnownBlock[] = target.redirectedFrom
    ? [
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `:construction: [dev] Mensagem para <@${target.redirectedFrom}>` }],
        },
        ...message.blocks,
      ]
    : message.blocks;

  const opened = await slack().conversations.open({ users: target.userId });
  const channel = opened.channel?.id;
  if (!channel) throw new Error(`conversations.open returned no channel for ${target.userId}`);
  return post(channel, { text: message.text, blocks });
}

export async function post(channel: string, message: SlackMessage): Promise<MessageRef> {
  const res = await slack().chat.postMessage({ channel, text: message.text, blocks: message.blocks });
  if (!res.ts) throw new Error(`chat.postMessage returned no ts for ${channel}`);
  return { channel, ts: res.ts };
}

export async function update(ref: MessageRef, message: SlackMessage): Promise<void> {
  await slack().chat.update({ channel: ref.channel, ts: ref.ts, text: message.text, blocks: message.blocks });
}

/** Posts in the thread of an existing message (e.g. the reminder under the draft DM). */
export async function reply(ref: MessageRef, message: SlackMessage): Promise<void> {
  await slack().chat.postMessage({ channel: ref.channel, thread_ts: ref.ts, text: message.text, blocks: message.blocks });
}
