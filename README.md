# Shiplog

Turns `Development: Done` in GitLab into a published, verifiable, discussable shipment.
No more hand-written Slack posts.

**Read [`SCOPE.md`](./SCOPE.md) first.** It has the flow, the decisions and the milestones.

> Status: scaffold only (M0). Entry points throw `Not implemented (<milestone>)`.

## Layout

```
SCOPE.md                     project scope & decisions
HANDOFF.md                   full context + decision log for a new session
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
    shipments/               ingest, recipient resolution, publish
    weight/                  signals, structured output schema, review (v1.5)
    policy/                  data policy resolution, redaction (v1.5)
    llm/                     provider-agnostic model (OpenAI-compatible)
    auth/                    Better Auth config (M2)
    env.ts                   typed env (zod)
  worker/                    pg-boss worker: `npm run worker`
scripts/eval-weights.ts      compare candidate models on calibration set (v1.5)
tests/                       behaviour specs as it.todo, filled per milestone
render.yaml                  Render Blueprint: web + worker + Postgres
```

## Local development

```bash
cp .env.example .env
```

```bash
docker compose up -d db
```

```bash
npm install
```

```bash
npm run db:generate && npm run db:migrate
```

```bash
npm run dev
```

```bash
npm run worker
```

To receive GitLab webhooks and Slack interactions locally, expose port 3000 with a
tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and point a **test**
project webhook and a dev Slack app at it.

## Scripts

| Script | |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `worker` | Background jobs (pg-boss) |
| `typecheck` / `lint` / `test` | Checks |
| `db:generate` / `db:migrate` | Drizzle migrations |
| `eval:weights` | LLM model comparison (v1.5) |
