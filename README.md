# Shiplog

Turns `Development: Done` in GitLab into a published, verifiable, discussable shipment.
No more hand-written Slack posts.

**Read [`SCOPE.md`](./SCOPE.md) first.** It has the flow, the decisions and the milestones.
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) has the system design and
[`docs/SETUP.md`](./docs/SETUP.md) the full local setup.

> Status: M1 (Ingest) done. Entry points for later milestones throw `Not implemented (<milestone>)`.

## Layout

```
SCOPE.md                     project scope & decisions
HANDOFF.md                   full context + decision log for a new session
docs/
  ARCHITECTURE.md            processes, layers, state machine, ingest pipeline
  SETUP.md                   local setup on Bun + Node, Next.js 16 notes
config/
  data-policy.yaml           per-repo rules for what may be sent to an LLM (v1.5)
  weight-rubric.md           team weight rubric (inserted into the prompt)
  calibration.yaml           lead-agreed reference tickets (prompt examples + eval truth)
src/
  app/
    page.tsx                 shipped feed                         (M4)
    tickets/[id]/page.tsx    ticket page: shipments, verify, thread (M4)
    settings/page.tsx        Connect GitLab, roles                (M2)
    unclaimed/page.tsx       leads' queue for unlinked recipients (M2)
    api/webhooks/gitlab/     GitLab group webhook                 (M1)
    api/slack/interactions/  Slack buttons & modals               (M3)
    api/auth/[...all]/       Better Auth (Slack + GitLab)         (M2)
    api/health/              Render health check
  lib/
    db/                      Drizzle schema (domain + Better Auth) and client
    gitlab/                  webhook verify, label parsing, read-only API client
    slack/                   signature verify, Web API client, Block Kit builders
    shipments/               state machine, commands, ingest, queries, effects
    weight/                  signals, structured output schema, review (v1.5)
    policy/                  data policy resolution, redaction (v1.5)
    llm/                     provider-agnostic model (OpenAI-compatible)
    auth/                    Better Auth config (M2)
    env.ts                   typed env (zod)
  worker/                    pg-boss worker: `bun run worker`
scripts/
  link-gitlab.ts             link a GitLab user to a Shiplog user by hand (until M2)
  replay-event.ts            re-run ingest for a stored gitlab_events row
  set-role.ts                set a user's role by email (e.g. the first lead)
  fake-gitlab.ts             local stand-in for the GitLab API (end-to-end runs without a token)
  eval-weights.ts            compare candidate models on calibration set (v1.5)
tests/                       behaviour specs as it.todo, filled per milestone
render.yaml                  Render Blueprint: web + worker + Postgres
```

## Local development

Needs **Bun 1.4.4** (installs, scripts, worker) and **Node 22** (Next.js runs on Node).
See [`docs/SETUP.md`](./docs/SETUP.md) for details.

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

```bash
bun run dev
```

```bash
bun run worker
```

After changing `src/lib/db/schema.ts` or `auth-schema.ts`, run `bun run db:generate` and
commit the new file in `drizzle/`.

### Tests

`bun run test` runs everything. The database tests need `TEST_DATABASE_URL` (see `.env.example`)
and a database created once with `CREATE DATABASE shiplog_test`; without it they're skipped.

### Running ingest end to end without GitLab

```bash
bun run scripts/link-gitlab.ts 11 dev.one@example.com "Dev One" dev
```

```bash
FAKE_MR_STATE=opened bun run scripts/fake-gitlab.ts
```

Then start `bun run worker` and the web app with `GITLAB_BASE_URL=http://localhost:4010`,
`GITLAB_API_TOKEN=fake` and a `GITLAB_WEBHOOK_SECRET`, and POST
`tests/fixtures/webhooks/issue-done.json` (then `mr-merged.json`) to `/api/webhooks/gitlab` with the
`X-Gitlab-Token`, `X-Gitlab-Event` and `X-Gitlab-Event-UUID` headers. The worker logs each `NextStep`;
`bun run scripts/replay-event.ts <id>` re-runs one event.

### Slack messages

`/dev/slack-preview` (development only) shows every Slack message from fixtures, with a link to open each in
Slack's Block Kit Builder. While developing against the real workspace, set `SLACK_DM_ALLOWLIST` to your own
Slack user ID and `SLACK_FEED_CHANNEL_ID` to a test channel.

### Real webhooks

To receive GitLab webhooks and Slack interactions locally, expose port 3000 with a
tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and point a **test**
project webhook and a dev Slack app at it.

## Scripts

Run with `bun run <script>`.

| Script | |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `worker` | Background jobs (pg-boss) |
| `typecheck` / `lint` / `test` | Checks |
| `db:generate` / `db:migrate` | Drizzle migrations |
| `eval:weights` | LLM model comparison (v1.5) |
