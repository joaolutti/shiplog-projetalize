/**
 * Typed environment. Each variable is parsed on first read, so `next build`, tooling and
 * milestones that don't need a variable yet (e.g. Slack during M1) work without it.
 * See .env.example for descriptions.
 */
import { z } from "zod";

const schema = z.object({
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),

  SLACK_CLIENT_ID: z.string().min(1),
  SLACK_CLIENT_SECRET: z.string().min(1),
  SLACK_TEAM_ID: z.string().min(1),
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_FEED_CHANNEL_ID: z.string().min(1),

  GITLAB_BASE_URL: z.url().default("https://gitlab.com"),
  GITLAB_GROUP_PATH: z.string().min(1),
  GITLAB_WEBHOOK_SECRET: z.string().min(1),
  GITLAB_API_TOKEN: z.string().min(1),
  GITLAB_OAUTH_CLIENT_ID: z.string().min(1),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().min(1),

  LABEL_DONE: z.string().default("Development: Done"),
  LABEL_BRANCH_PREFIX: z.string().default("Branch: "),
  LABEL_WEIGHT_PREFIX: z.string().default("Weight: "),

  REMINDER_AFTER_HOURS: z.coerce.number().positive().default(4),
  AUTO_PUBLISH_AFTER_HOURS: z.coerce.number().positive().default(24),

  LLM_ENABLED: z.stringbool().default(false),
  LLM_PROVIDER_NAME: z.string().default("openrouter"),
  LLM_BASE_URL: z.url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

const cache = new Map<keyof Env, unknown>();

export function env<K extends keyof Env>(key: K): Env[K] {
  if (!cache.has(key)) {
    const result = schema.shape[key].safeParse(process.env[key]);
    if (!result.success) {
      throw new Error(`Invalid env ${key}: ${z.prettifyError(result.error)}`);
    }
    cache.set(key, result.data);
  }
  return cache.get(key) as Env[K];
}
