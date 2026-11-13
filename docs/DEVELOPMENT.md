# Development

How to run Shiplog on your machine. For what it does, see the [README](../README.md); for how it's built, see
[TECHNICAL.md](./TECHNICAL.md). The original scaffold guide (Bun vs Node, Next.js 16 notes, Docker) is
[SETUP.md](./SETUP.md).

## Requirements

- **Bun 1.4.4** for installs, scripts and the worker, and **Node 22**, because Next.js runs on Node.
- Docker, for the local Postgres.
- For real end-to-end runs: a Slack app, a GitLab token and webhook, and a public tunnel (see below).

## First run

```bash
cp .env.example .env
```

```bash
docker compose up -d db
```

```bash
bun install
```

```bash
bun run db:migrate
```

Then, in two terminals:

```bash
bun run dev
```

```bash
bun run worker
```

The web app is on `http://localhost:3000`. The worker sends every Slack message and runs every background job, so
nothing happens after a GitLab event unless it's running. Run **one** worker at a time: two workers share the queue,
and one with old code or settings will pick up jobs too.

After changing `src/lib/db/schema.ts` or `auth-schema.ts`, run `bun run db:generate` and commit the new file in
`drizzle/`.

## Scripts

Run with `bun run <script>`.

| Script | What it does |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `worker` | Background jobs (pg-boss) |
| `typecheck` / `lint` / `test` | Checks |
| `db:generate` / `db:migrate` | Drizzle migrations |
| `eval:weights` | Model comparison for the weight review (after v1, not wired yet) |

One-off scripts in `scripts/`:

| Script | What it does |
|---|---|
| `set-role.ts <email> <role>` | Sets a user's role, e.g. the first lead |
| `link-gitlab.ts` | Links a GitLab user to a Shiplog user by hand |
| `replay-event.ts <id>` | Re-runs ingest for a stored `gitlab_events` row |
| `fake-gitlab.ts` | Local stand-in for the GitLab API, for end-to-end runs without a token |
| `seed-demo.ts` | Fills a database whose name contains `demo` with fictional people and deliveries (see below) |

## Tests

`bun run test` runs everything. The database tests need `TEST_DATABASE_URL` (see `.env.example`) and a database
created once with `CREATE DATABASE shiplog_test`; without it they're skipped. Tests never call a real model or
Slack: the test setup turns the LLM off, and Slack and the job queue are mocked.

## Real webhooks and Slack

GitLab webhooks and Slack callbacks need a public URL. Expose port 3000 with a tunnel, for example:

```bash
cloudflared tunnel --url http://localhost:3000
```

Set `APP_URL` to the tunnel's URL (Next.js only lets the dev client load from that host, see `allowedDevOrigins`
in `next.config.ts`), then point:

- the **GitLab** project webhook at `<tunnel>/api/webhooks/gitlab` (Issue and Merge Request events, secret =
  `GITLAB_WEBHOOK_SECRET`);
- the **Slack** app's interactivity URL at `<tunnel>/api/slack/interactions`;
- the **Slack** app's Event Subscriptions URL at `<tunnel>/api/slack/events` (bot events `reaction_added` and
  `reaction_removed`);
- the Slack and GitLab OAuth redirect URLs at `<tunnel>/api/auth/callback/slack` and `/callback/gitlab`.

The Slack bot needs the scopes `chat:write`, `im:write`, `users:read`, `reactions:read` and `reactions:write`.
Reinstall the app after adding a scope; new scopes only apply then.

While developing against the real workspace, set `SLACK_DM_ALLOWLIST` to your own Slack user ID: DMs meant for
anyone else come to you, marked with who they were for. Leave it empty in production.

## Development-only pages

- `http://localhost:3000/dev/as?email=<user email>` signs your browser in as that user without Slack, to check roles
  and pages; `/dev/as` signs out. Only from this machine, never in production or through the tunnel.
- `/dev/slack-preview` shows the Block Kit JSON of every Slack message, built from fixtures, with a link to open
  each in Slack's Block Kit Builder.

## Running ingest without GitLab

```bash
bun run scripts/link-gitlab.ts 11 dev.one@example.com "Dev One" dev
```

```bash
FAKE_MR_STATE=opened bun run scripts/fake-gitlab.ts
```

Then start the worker and the web app with `GITLAB_BASE_URL=http://localhost:4010`, `GITLAB_API_TOKEN=fake` and a
`GITLAB_WEBHOOK_SECRET`, and POST `tests/fixtures/webhooks/issue-done.json` (then `mr-merged.json`) to
`/api/webhooks/gitlab` with the `X-Gitlab-Token`, `X-Gitlab-Event` and `X-Gitlab-Event-UUID` headers. The worker
logs each step; `bun run scripts/replay-event.ts <id>` re-runs one event.

## LLM drafts locally

Set `LLM_ENABLED=true`, an OpenRouter `LLM_API_KEY` and a `LLM_MODEL` (v1 uses a free model, e.g.
`google/gemma-4-31b-it:free`), then restart the worker; it reads `.env` only at start. Each call is logged in
`llm_audit_log`, with the error when a draft falls back.

## Demo data

For screenshots and demos without real tickets, seed a separate database. The script refuses any database whose
name doesn't contain `demo`, and empties it first.

```bash
psql "$DATABASE_URL" -c "create database shiplog_demo"
```

```bash
DATABASE_URL=postgres://shiplog:shiplog@localhost:5432/shiplog_demo bun run db:migrate
```

```bash
DATABASE_URL=postgres://shiplog:shiplog@localhost:5432/shiplog_demo bun run scripts/seed-demo.ts
```

Run the app against it (`DATABASE_URL=…/shiplog_demo bun run dev`) and open
`/dev/as?email=ana.souza@demo.shiplog` to see it as the demo lead. The README screenshots come from this data.
