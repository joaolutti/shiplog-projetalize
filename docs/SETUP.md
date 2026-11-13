# Local setup

How to go from `shiplog-scaffold.zip` to a running local copy with **Bun**, plus the parts of Next.js 16 that
matter for this repo. For the system design, see `docs/ARCHITECTURE.md`.

> Checked against the scaffold on 2026-11-10 with Bun 1.4.4 + Node 22, after the changes in §3:
> `bun install --frozen-lockfile` ✅ · `typecheck` ✅ · `lint` ✅ (0 warnings) · `test` ✅ (23 `it.todo`) · `build` ✅ ·
> `bun run start` serves `/api/health` (running on Node) ✅ · the worker starts on Bun against Postgres 17 and creates its
> queues ✅. A pg-boss job round trip and a Drizzle query both work on Bun ✅.
> **Not tested:** the Dockerfile in §8, because Docker builds here can't reach the npm registry.

---

## 1. How Bun is used here

| Job | Runs on | Why |
|---|---|---|
| Installing packages, running `package.json` scripts | **Bun** | Fast installs, one lockfile (`bun.lock`) |
| Worker (`src/worker`), `scripts/*.ts` | **Bun** | Runs TypeScript directly (no `tsx`) and loads `.env` by itself |
| Next.js (`dev`, `build`, `start`) | **Node 22** | Next is mainly tested on Node, and this repo uses its newest rendering features. `bun run dev` still runs Next on Node, because the `next` command's shebang asks for `node` |
| Tests | **vitest** (on Node), started with `bun run test` | The specs and config are written for vitest. Don't switch to `bun test` |
| `drizzle-kit`, `eslint`, `tsc` | Node, started through Bun | Unchanged tools |

**Keep Node 22 installed.** If `node` is missing, Bun quietly stands in for it, and Next would run on Bun without anyone
noticing.

Recorded as **D43** (Bun as package manager and worker runtime, Node for Next.js). It replaces "npm + tsx" in the
handoff's tech-stack table. Copy it into `SCOPE.md` in M1 step 1.

---

## 2. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Bun | **1.4.4** (pinned in `package.json` → `packageManager`) | Package manager, script runner, worker runtime |
| Node.js | **22 LTS** (Next.js 16 needs ≥ 20.9) | Next.js runtime, and the Node-based tools in §1 |
| Docker + Compose | Any recent version | Local Postgres 17 (`docker-compose.yml`, service `db`) |
| Git | Any | Version control |
| cloudflared | Latest | **Only later**, for real GitLab/Slack webhooks (see §9) |

Install Bun from https://bun.com, or with `npm install -g bun@1.4.4`. Check with:

```bash
bun --version && node -v && docker compose version
```

---

## 3. Create the repository

The zip has a top-level `shiplog/` folder:

```bash
unzip shiplog-scaffold.zip
```

```bash
cd shiplog
```

Make these changes before the first commit, so the repo starts out on Bun.

### 3.1 Fix `.gitignore`

The line `.env*` also matches `.env.example`, so the template would never be committed. Add an exception straight after
that line:

```gitignore
# env files (can opt-in for committing if needed)
.env*
!.env.example
```

Then delete the stray build cache from the zip (it's already ignored):

```bash
rm -f tsconfig.tsbuildinfo
```

### 3.2 Switch the lockfile to Bun

`bun install` reads the existing `package-lock.json` and writes a `bun.lock` with **the same versions**. I checked
Next 16.4.5, React 19.3.0, pg-boss 12.38.0, Drizzle 0.45.4 and Better Auth 1.7.15.

```bash
bun install
```

```bash
rm package-lock.json
```

### 3.3 Drop `tsx`, and point the scripts at Bun

```bash
bun remove tsx
```

In `package.json`, change these two scripts and add `packageManager` at the top level:

```json
"worker": "bun run src/worker/index.ts",
"eval:weights": "bun run scripts/eval-weights.ts",
```

```json
"packageManager": "bun@1.4.4"
```

The other scripts (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:*`) stay as they are. Run them with
`bun run <script>`.

No install scripts are blocked: `bun pm untrusted` reports 0, so `trustedDependencies` isn't needed.

### 3.4 Update the Dockerfile and `render.yaml`

See §8. These changes only matter for Render, but make them now so the repo is consistent.

### 3.5 Commit and push

```bash
git init -b main
```

```bash
git add . && git status
```

Check that `.env.example` and `bun.lock` are listed, and that `package-lock.json`, `node_modules/` and `.next/` are not.

```bash
git commit -m "chore: scaffold (M0) on bun"
```

```bash
git remote add origin git@gitlab.com:<group>/shiplog.git
```

```bash
git push -u origin main
```

### Working rules for the repo
- Protect `main` on GitLab. All work goes through merge requests.
- One branch per milestone step, e.g. `m1/labels`, `m1/webhook-route`, `m1/ingest`.
- Squash-merge, so `main` reads as one commit per step.
- `HANDOFF.md`, `SCOPE.md`, `AGENTS.md` and `README.md` are already in the zip. Add `docs/SETUP.md` and
  `docs/ARCHITECTURE.md` next to them.
- The README still shows `npm` commands. Updating it is part of M1 step 1.

---

## 4. Configure

Use a plain **`.env`** file:

```bash
cp .env.example .env
```

All three readers pick up the same `.env`:
- Bun loads it for the worker and for every `bun run` script.
- Next.js loads it on its own.
- `drizzle.config.ts` loads it with `dotenv/config`, which only reads `.env`. That's why it's not `.env.local`.

Generate the auth secret. `env.ts` requires at least 32 characters, and the placeholder is too short.

```bash
openssl rand -base64 32
```

`src/lib/env.ts` parses variables **lazily**, so a missing variable only fails the code that reads it. Fill them in as
the milestones need them:

| When | Variables |
|---|---|
| Now | `APP_URL` and `DATABASE_URL`: the defaults already match `docker-compose.yml`. `BETTER_AUTH_SECRET`: the value generated above |
| M1 Ingest | `GITLAB_BASE_URL`, `GITLAB_GROUP_PATH`, `GITLAB_WEBHOOK_SECRET`, `GITLAB_API_TOKEN`. `LABEL_*` have working defaults |
| M2 Identity | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID`, `GITLAB_OAUTH_CLIENT_ID`, `GITLAB_OAUTH_CLIENT_SECRET` |
| M3 Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_FEED_CHANNEL_ID`. `REMINDER_AFTER_HOURS` and `AUTO_PUBLISH_AFTER_HOURS` have defaults |
| M5 Weight | `LLM_ENABLED`, `LLM_PROVIDER_NAME`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` |

---

## 5. Database

```bash
docker compose up -d db
```

```bash
docker compose ps
```

**Don't run `db:generate` / `db:migrate` yet, even though the README says to.** No migration is committed. M1 changes
the schema first:
- statuses
- the partial unique indexes for a missing branch
- `Solicitante` fields
- `verifications.updated_at`

See ARCHITECTURE §8. Generating now would make you write a second migration straight away.

**Better Auth tables.** `src/lib/db/auth-schema.ts` was written by hand. For Better Auth 1.7, the CLI is the npm
package **`auth`** (`bunx auth@1.7 generate`). The old `@better-auth/cli` package is unsupported and stuck at 1.4.

The CLI reads a real auth config, and `src/lib/auth/auth.ts` is still a stub. So comparing the two schemas happens in
M1 step 1, when the first migration is written. Nothing to do now.

After the M1 schema changes:

```bash
bun run db:generate
```

```bash
bun run db:migrate
```

---

## 6. Run it

Two terminals:

```bash
bun run dev
```

```bash
bun run worker
```

- **Web:** http://localhost:3000. `GET /api/health` returns `{ "ok": true }`. The other pages show placeholders.
  The API routes return 501 until their milestone.
- **Worker:** it should print `[worker] started; queues: ...`. pg-boss creates its own `pgboss` schema in Postgres on
  the first start.
- When Bun loads the env file it prints `[0.05ms] ".env"`. That line is normal.

Checks, all passing on the scaffold after §3:

```bash
bun run typecheck && bun run lint && bun run test && bun run build
```

Use `bunx` wherever a guide says `npx`.

---

## 7. Next.js 16 for this repo, in ten minutes

`AGENTS.md` says to read `node_modules/next/dist/docs/` before writing Next code. Those docs match the installed version
(16.4.5), and Next 16 differs from older tutorials. The `<!-- BEGIN:nextjs-agent-rules -->` block at the top of
`AGENTS.md` is rewritten by `next dev`. Commit it as it is.

**Files are routes (App Router).**
- `src/app/**/page.tsx` is a page, and `layout.tsx` wraps the pages below it.
- `route.ts` is an HTTP endpoint. Our webhooks live there: `api/webhooks/gitlab`, `api/slack/interactions`.
- A folder like `[id]` is a dynamic segment.

**Server Components by default.**
- A component runs on the server and can query Postgres directly through Drizzle (`db()` in `src/lib/db/client.ts`).
- It can't use `useState` or event handlers.
- Add `"use client"` only to interactive pieces: verify button, report form, filters, chart tooltips.

**Server Actions handle web mutations.**
- A `"use server"` function can be called from a form or button.
- In Shiplog, every action is a thin wrapper around `src/lib/shipments/commands.ts`, the same functions the Slack
  handler calls.

**`cacheComponents: true` (and `partialPrefetching`) are on in `next.config.ts`.**
- Pages are prerendered by default. Anything dynamic (`params`, `searchParams`, `cookies()`, `headers()`, DB reads)
  must sit inside `<Suspense>`, or be cached with `"use cache"`.
- Otherwise the build fails with "uncached or runtime data during prerendering".
- You can see this in the build output: `/tickets/[id]` is ◐ *Partial Prerender*. Its static shell is prerendered and
  the Suspense part streams in per request. `src/app/tickets/[id]/page.tsx` is the reference example.

**`params` / `searchParams` are Promises.** Write `const { id } = await params`.

**Route types are generated.** `PageProps<"/tickets/[id]">` and `LayoutProps<"/">` come from `next typegen`, which
`bun run typecheck` runs first. If your editor marks them as unknown, run `bun run typecheck` once.

**Route handlers that check signatures must read the raw body.**
- Call `await req.text()` first, verify the signature, then parse.
- Reply fast and queue the real work. GitLab disables slow hooks, and Slack needs a reply within 3 s.

**Other changes in 16.**
- Turbopack is the default bundler. Tailwind 4 is wired through `@tailwindcss/turbopack` in `next.config.ts`.
- `middleware.ts` is now `proxy.ts`. We probably don't need one: auth is checked in layouts, pages and actions.
- `eslint` is run directly (`bun run lint`); `next lint` is gone.

**Code shared by web and worker must not use Bun-only APIs** (`Bun.sql`, `Bun.file`, `bun:*` imports). The same modules
run on Node inside Next. Stick to Node APIs and `fetch`. The Postgres driver is `postgres` (postgres.js), which works on
both.

The pattern used on almost every page:

```tsx
// src/app/tickets/[id]/page.tsx
import { Suspense } from "react";

export default function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  return (
    <Suspense fallback={<TicketSkeleton />}>
      <Ticket params={params} />
    </Suspense>
  );
}

async function Ticket({ params }: Pick<PageProps<"/tickets/[id]">, "params">) {
  const { id } = await params;
  const viewer = await requireViewer();          // Better Auth session → user + role
  const ticket = await getTicketView(viewer, id); // role-aware query (hides weight reviews from members)
  return <TicketLayout ticket={ticket} />;
}
```

```ts
// src/app/tickets/[id]/actions.ts
"use server";
import { verify } from "@/lib/shipments/commands";

export async function verifyAction(shipmentId: number) {
  const viewer = await requireViewer();
  await verify({ actor: viewer, shipmentId });
  // then refresh the route's data (see "revalidating" in the bundled docs)
}
```

---

## 8. Docker and Render

**Keep the Node base image and add Bun to it.** The plain `oven/bun` image has no Node, which would make Next run on Bun
in production. Replace the `Dockerfile` with:

```dockerfile
# One image, two processes on Render: `web` (Next.js on Node) and `worker` (pg-boss jobs on Bun).
FROM node:22-slim AS base
RUN npm install -g bun@1.4.4
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# Overridden per service in render.yaml.
CMD ["bun", "run", "start"]
```

In `render.yaml`, change the two `dockerCommand` lines:

```yaml
    dockerCommand: bun run start     # shiplog-web
```

```yaml
    dockerCommand: bun run worker    # shiplog-worker
```

Check the image builds before the first Render deploy:

```bash
docker build -t shiplog .
```

On Render there's no `.env` file. Bun and Next read the service's env vars directly.

---

## 9. Real webhooks locally (needed only for end-to-end checks)

Most of M1 is tested with **fixture payloads** in `tests/fixtures/`, so you don't need a tunnel for day-to-day work.
For a real end-to-end run:

```bash
cloudflared tunnel --url http://localhost:3000
```

- Point a **test GitLab project's** webhook (not the group's) at `<tunnel>/api/webhooks/gitlab`.
  Enable Issue and Merge Request events, and set the secret to `GITLAB_WEBHOOK_SECRET`.
- Later, point a **dev Slack app's** interactivity URL at `<tunnel>/api/slack/interactions`, and its
  Event Subscriptions request URL at `<tunnel>/api/slack/events` (bot events `reaction_added`,
  `reaction_removed`; scopes `reactions:read`, `reactions:write`; reinstall the app after adding scopes).
- A quick tunnel gets a new URL on every run. Use a named Cloudflare tunnel if updating the URLs gets tedious.
- Every delivery is stored in `gitlab_events`, and `scripts/replay-event.ts` (added in M1) re-runs one with
  `bun run scripts/replay-event.ts <id>`, without GitLab.

---

## 10. CI on GitLab

Add `.gitlab-ci.yml` as part of the first M1 merge request. It uses the same Node-plus-Bun setup as the Dockerfile.
The build works without secrets because env parsing is lazy.

```yaml
default:
  image: node:22
  before_script:
    - npm install -g bun@1.4.4
  cache:
    key: { files: [bun.lock] }
    paths: [.bun-cache/]

check:
  variables:
    BUN_INSTALL_CACHE_DIR: .bun-cache
  script:
    - bun install --frozen-lockfile
    - bun run typecheck
    - bun run lint
    - bun run test
    - bun run build
```

---

## 11. Using Claude Code in the repo

- **Claude Code reads `CLAUDE.md`, not `AGENTS.md`.** Add a `CLAUDE.md` at the root that imports the existing rules and
  states the Bun convention:

  ```
  @AGENTS.md

  Use bun for installs and scripts (`bun install`, `bun run <script>`, `bunx`), never npm/npx.
  Next.js runs on Node; don't add `--bun` to the Next scripts or use Bun-only APIs in src/.
  ```

- Keep `SCOPE.md` current. When a decision changes, update it in the same merge request as the code.
- The decisions made after the handoff (ARCHITECTURE §10, plus D43 above) aren't in `SCOPE.md` or `HANDOFF.md` yet.
  Copying them in is part of M1 step 1.
