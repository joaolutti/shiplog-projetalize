# Shiplog: Handoff Document

> **Purpose:** gives a new Claude session (or another person) everything decided so far, so work can
> continue without redoing the discovery conversation.
> **Snapshot date:** 2026-11-09 · **Project stage:** M0 done (scope + scaffold). No feature code yet.

---

## 0. Instructions for the receiving assistant

1. **Treat §3 (Decision log) as settled.** The project owner made these choices deliberately. Don't
   reopen them unless the owner asks, or you find a concrete technical blocker. If you do, say so
   plainly and propose an alternative.
2. **Things still undecided are in §12 (Open items).** Ask about those rather than assuming.
3. If the scaffold archive (`shiplog-scaffold.zip`) or repo is attached, **`SCOPE.md` in the repo is the
   short canonical spec** and this document is the longer context behind it. If they ever disagree, the
   owner's latest instruction wins, then this handoff, then `SCOPE.md`.
4. **Next step is milestone M1 (Ingest)**, see §11. The owner asked that implementation not start until
   the scaffold was reviewed, so confirm before writing feature code.
5. Hard rules (also in the repo's `AGENTS.md`):
   - Shiplog is **read-only toward GitLab**. Never add GitLab write calls.
   - **No per-developer leaderboard, ranking or aggregate score. Ever.**
   - **Never persist MR diffs.** Anything sent to an LLM goes through the data policy plus redaction and
     is recorded in `llm_audit_log`.
   - Weight reviews are visible to `dev` and `lead` roles only.

---

## 1. Background: the current process and its problems

### Company context
- **Dev team:** 7 developers, 1 PM, 1 CTO (9 people). Other departments (support and others) report bugs.
- **Issue tracking:** GitLab on **gitlab.com, Premium tier**. All ticket management happens there.
- **Customer support:** HubSpot. HubSpot tickets are *referenced* inside GitLab issues. Everything flows through GitLab.
- **GitLab comments are dev-only.** Non-dev staff don't use GitLab issue comments, and most don't have GitLab accounts.
- **Repos:** multi-repo, with **shared repos used across several projects** and **many microservices**.
- **Labels in use:**
  - `Development: Done`: applied when a ticket is closed or done.
  - `Branch: Main`, `Branch: Staging`, etc.: the target branch for the task.
  - `Weight: X`: weight label on the card. Weight is **also** set in GitLab's **native weight field**.
- **Weights:** a fixed **Fibonacci** scale. There's a written rubric that may be **out of date** (the owner will check).
  Most tasks **already have a weight before a developer starts**.
- **No GitLab time tracking** (`/spend` isn't used). Tickets often **sit in the backlog for a long time**.
- **AI usage:** the team uses agentic coding workflows daily, but there's **no central company AI
  provider account**.
- **Cloud:** the company has a cloud provider, but the owner **has no access to it**.

### Today's Slack process
Developers post manually to a Slack channel (open to everyone in the company) in this format:

```
Shipping X feature to <branch>!
<issue number with link> - Issue Title (@requester, if any; usually bug reports from other departments)
description of what was made
Verify and reply with a checkmark!
```

Flow today: dev finishes/merges → opens Slack → types the message → adds links by hand → sends. Feedback
happens in the Slack thread.

### Problems (the owner's own framing: "not wrong, but lots of room for improvement")
1. Fully manual posting.
2. Issues get lost when several ship per day.
3. Feedback in Slack threads is hard to follow, especially long back-and-forth.
4. No clear view of how much is produced: it's just channel messages.
5. Verification (✅ reply) isn't tracked.
6. *(added later)* Weights rest only on the developer's own judgement, with no independent second opinion.

---

## 2. Product summary

**Shiplog** (working name) is an internal web app plus Slack bot. When a GitLab issue gets the
`Development: Done` label, Shiplog drafts the ship announcement automatically and DMs it privately to the developer
to confirm or edit. Once confirmed, it publishes the shipment to a web app. There, anyone in the company can
verify it, report a problem or discuss it in a dedicated per-ticket thread. A second-opinion "weight
review" from an LLM (v1.5) compares the pre-assigned weight to what was actually done.

---

## 3. Decision log (settled)

Grouped by topic. "Rejected" lists alternatives considered and why they weren't chosen.

### Flow and triggers
| # | Decision | Rationale / rejected alternatives |
|---|---|---|
| D1 | **The web app is the system of record. Slack is for notifications and quick actions.** | Fixes lost threads and lack of visibility. Rejected: keeping discussion in Slack. |
| D2 | **`Development: Done` label is the only trigger.** | Rejected: also triggering on MR merge, which would create duplicates. MR events are used only to *update data* (e.g. release held shipments). |
| D3 | **The draft goes to the developer as a private Slack DM**, not to a channel. The dev can confirm, edit notes or add comments. | Owner's change to the original proposal. |
| D4 | **Recipient order: issue assignee → linked MR author → user who applied the label.** | Owner confirmed: usually the assignee closes it. The webhook's `user` may be a PM. |
| D5 | **Nudge when the label is applied but related MRs are still open**: DM with [Hold until merged] / [Publish anyway]. Held shipments release when the last MR merges. | Owner request. |
| D6 | **Nudge when Done is applied without a `Branch:` label**: DM with branch buttons. | Same nudge pattern. |
| D7 | **One shipment per (ticket, branch)** ("branch promotion"). Adding `Branch: Main` to a ticket already shipped to Staging creates a second shipment. Re-adding labels never duplicates. Reopen + Done again on the same branch updates the existing shipment's timeline. | Owner accepted. |
| D8 | **Ignored DMs: one reminder after N hours (default 4), auto-publish after 24h** flagged "unconfirmed notes". | Owner: "great idea". Keeps the feed complete. |
| D9 | **The existing Slack channel stays as a read-only feed.** Shiplog posts a card for each *published* shipment with an "Open in Shiplog" button. Discussion happens in the web app. | Owner: "can still exist as a fallback, but more read-only". |
| D10 | **Unclaimed drafts** (the recipient has no linked account) DM the **leads** and appear in an "Unclaimed" queue in the web app. They are **not** posted to the channel. | The channel only shows published items. |
| D11 | **The requester gets a DM when their ticket publishes**, with Verify / Open buttons. | Replaces today's @mention. |
| D12 | **Anyone can verify** (verify or report a problem). Several verifiers are recorded, one record per user per shipment. | Owner: the current channel is open to everyone. |
| D13 | **Shiplog has its own threads**, one per *ticket* (comments can reference a specific shipment). | GitLab comments are dev-only, and non-devs lack GitLab accounts. |

### Identity
| # | Decision | Rationale |
|---|---|---|
| D14 | **Everyone signs in with Slack** (OpenID Connect), restricted to the company workspace (team ID check). | Non-devs must only need a simple Slack sign-in. |
| D15 | **Devs and leads also click "Connect GitLab" once** (GitLab OAuth, `read_user`) to link GitLab user ID ↔ Shiplog user. Check membership of the top-level group on link. | Rejected: automatic email matching, because gitlab.com webhooks/API usually **redact emails**. Rejected: a manual admin mapping table (viable for 9 people, but OAuth needs no upkeep). Owner: devs can take on a heavier onboarding. |
| D16 | **Requesters are resolved via a `Requester:` line (email) in the GitLab issue template**, then Slack `users.lookupByEmail`. | Requesters are Slack-only. Slack exposes email to bots with `users:read.email`. |
| D17 | **Roles: `member` (everyone), `dev` (7), `lead` (PM + CTO).** | |

### Weight second opinion (v1.5)
| # | Decision | Rationale |
|---|---|---|
| D18 | **This is a second opinion on the pre-assigned weight, not an estimate from scratch.** "Agree / no change" is a first-class, expected outcome. | Owner: most tasks already have a weight. This checks it. |
| D19 | **An LLM produces the opinion**, in the same pass that **drafts the shipping notes**. | Owner chose the LLM approach. |
| D20 | **Inputs:** spec (issue text, labels, assigned weight), changes (MRs across projects, files, +/- excluding generated/lockfiles, services touched, tests, review rounds), time = **active window (first commit or MR creation → last merge)**. | No time tracking exists, and backlog wait time would distort a created→closed measure. |
| D21 | **Assigned weight source: GitLab's native weight field. The `Weight: X` label is a mirror.** If they disagree, the native field wins and the dev DM notes the mismatch. | Both are used today. |
| D22 | **Assigned, suggested and the dev's response are stored side by side and never overwritten.** Nothing is written back to GitLab. | Audit trail, plus the read-only rule. |
| D23 | **Visibility: all `dev` + `lead`.** Hidden from `member`. Leads (PO/PM and CTO) can **flag** a review for discussion later. | Owner: devs already see each other's weights today. |
| D24 | **No per-developer leaderboard, ranking or aggregation, at all.** | Owner explicit. Avoids people gaming the metric. |
| D25 | **Calibration:** the leads pick ~10–20 past tickets with agreed weights → few-shot examples in the prompt plus ground truth for model evaluation. The rubric must be updated first. | Anchors the model to the team's scale. |

### Code exposure / LLM data controls
| # | Decision |
|---|---|
| D26 | **Deny-by-default per-repo data policy** (`config/data-policy.yaml`): levels `diff` / `metadata` / `excluded`, resolved most-specific-first (project → subgroup → group → default). Default = `metadata`. **Each MR uses its own repo's policy** (a ticket can span repos). Issue text follows the issue project's policy. |
| D27 | **Redaction before every model call:** secret patterns, excluded paths (`.env*`, secrets, keys, lockfiles, generated, snapshots), **PII in issue text** (emails/phones: HubSpot-sourced bugs can contain customer data), size limit (oversized → downgraded to `metadata`). |
| D28 | **Diffs are never stored.** They're fetched via the API into memory only. Shiplog never clones repos. Only derived stats + model output are persisted. |
| D29 | **GitLab access = a group access token with `read_api` only** (read-only by construction). |
| D30 | **`llm_audit_log` records every call:** provider, model, sources plus the policy applied to each, redaction counts, payload SHA-256 and size, tokens, latency. |

### LLM provider
| # | Decision | Rationale |
|---|---|---|
| D31 | **Model origin and hosting location are separate choices.** Kimi/Qwen/DeepSeek are open-weight. Their *first-party* APIs are hosted in China (**not recommended for code**), but the same weights run on US/EU hosts and AWS Bedrock. | The owner asked to look at Kimi, Qwen, DeepSeek etc. ("calls are somewhat simple"). |
| D32 | **Start with a company-owned OpenRouter account with zero data retention (ZDR) enforced account-wide** (`zdr: true`, `data_collection: "deny"`) for evaluation. This also creates the missing central AI account. | Lowest effort: one key, every model. Trade-off: an extra party in the middle. |
| D33 | **Choose the model with data:** run `scripts/eval-weights.ts` over the calibration set with ~4–6 candidates (a large Qwen3, DeepSeek V3.x, Kimi K2.x, plus one small frontier model as reference). Metrics: agreement with agreed weights, error in scale steps, valid-JSON rate, latency. Then stay on OpenRouter, or go direct to the winner's best host, or Bedrock/Vertex if cloud access comes through. | Volume is ~5–20 calls/day at a few thousand tokens, so **cost isn't the deciding factor**. Data terms and quality are. |
| D34 | **The code is provider-agnostic:** Vercel AI SDK + `@ai-sdk/openai-compatible`, configured by `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`. | |

Provider options considered:

| Option | Models | Data story | Effort |
|---|---|---|---|
| A. OpenRouter + ZDR **(chosen to start)** | All | ZDR routing; an intermediary | Lowest |
| B. Direct US/EU open-weight host (Together, Fireworks, DeepInfra, Groq) | Open-weight | Direct contract; check terms | Low |
| C. Hyperscaler (Bedrock, Vertex) | Open-weight + Claude/GPT | Strongest (company cloud contract) | Needs cloud access the owner lacks |
| D. Frontier first-party (Anthropic, OpenAI, Google) | Own models | Commercial terms; ZDR negotiable | Low, one vendor per model |
| E. Open-weight first-party (DeepSeek, Moonshot, Alibaba) | Own models | Hosted in China | **Not recommended** |
| F. Self-host | Open-weight | Nothing leaves | Overkill; Render has no GPUs |

### Hosting and platform
| # | Decision | Rationale |
|---|---|---|
| D35 | **Render** (managed PaaS): web service + background worker + managed Postgres, deployed with Docker via `render.yaml`. | Owner chose the managed-PaaS option. Company cloud exists but the owner has no access. Docker keeps it portable for a later move. Rejected: Vercel (serverless makes the worker/LLM jobs awkward), VPS (maintenance), on-prem (needs tunnel or polling). |
| D36 | **GitLab Premium → one group-level webhook on the top-level group** (Issue + Merge Request events) and a **group access token**. | Covers every project including shared repos, and future ones automatically. |

### Tech stack (scaffold choices)
| Concern | Choice | Note |
|---|---|---|
| Web + HTTP endpoints | **Next.js 16.4.5** (App Router, route handlers), React 19.3, Tailwind 4 | `cacheComponents: true` is on (see §9 gotchas) |
| DB | **Postgres + Drizzle ORM** (`drizzle-orm` 0.45, `drizzle-kit` 0.31, `postgres` 4) | |
| Jobs | **pg-boss 12** on the same Postgres | Retries, delayed jobs, cron. No Redis |
| Slack | **`@slack/web-api` 8 + our own signature verification**, no Bolt | Bolt's HTTP receiver doesn't fit Next.js route handlers |
| Auth | **Better Auth 1.7** (Slack + GitLab social providers, account linking, Drizzle adapter) | Rejected Auth.js: v5 is still beta |
| LLM | **Vercel AI SDK 7** + `@ai-sdk/openai-compatible` 3 | |
| Validation | **zod 4** | |
| Tests | **vitest 5** | |
| Worker runtime | **tsx** (runtime dependency) | `npm run worker` |

---

## 4. Core flow (target behaviour)

```
GitLab: "Development: Done" label added to an issue
   │  group-level webhook (Issue Hook)
   ▼
[1] Receive ── verify X-Gitlab-Token, store raw event (dedupe on X-Gitlab-Event-UUID),
   │           return 200 immediately, enqueue job (GitLab disables slow or failing hooks)
   ▼
[2] Ingest ── upsert ticket; parse "Branch: *", "Weight: *" labels + native weight
   │          fetch related MRs (cross-project): GET /projects/:id/issues/:iid/related_merge_requests
   │          upsert shipment, unique on (ticket, branch)
   │
   ├── no Branch label?     → DM nudge "Which branch?" [Main] [Staging] …
   ├── open MRs remain?     → DM nudge [Hold until merged] [Publish anyway]
   │                             (held → re-checked on each Merge Request Hook)
   ├── recipient unlinked?  → status "unclaimed": DM leads + Unclaimed queue
   ▼
[3] Draft DM to developer
      "Shipping <title> to Staging" · links · requester · draft notes
      [✅ Confirm & publish]  [✏️ Edit notes]  [💬 Add comment]
      (v1.5: + weight opinion → [Agree] [Keep assigned] [Other…])
   ├── no response after REMINDER_AFTER_HOURS (4)      → one reminder
   ├── no response after AUTO_PUBLISH_AFTER_HOURS (24) → auto-publish, "unconfirmed notes"
   ▼
[4] Publish
      ├── web app feed + ticket page
      ├── read-only card in the existing channel, [Open in Shiplog]
      └── DM the requester "Your fix shipped to Staging" [Verify] [Open]
   ▼
[5] Verify (anyone): ✅ Verified (by A, B, …)  or  ⚠️ Issue reported → thread comment + DM to dev
```

**Shipment state:**
```
status:        held → pending_confirmation → published
                   ↘ unclaimed ↗  (lead assigns or publishes)
published_via: confirmed | auto | lead
verification:  unverified | verified | issue_reported   (independent of status)
```

**Message fields → sources:**
| Field | Source |
|---|---|
| Branch | `Branch: <name>` label |
| Issue #, link, title | Webhook payload |
| Requester @mention | `Requester:` line in issue template → Slack `users.lookupByEmail` |
| What was made | v1: the `## Shipping notes` section of the MR template, falling back to the MR title. v1.5: LLM draft |
| Verification | Buttons, tracked per user |

**Process changes the team must make:** add `Requester:` to the issue template, and `## Shipping notes` to the MR template.

---

## 5. Weight review: output contract (v1.5)

```json
{
  "verdict": "agree | increase | decrease",
  "suggestedWeight": 1 | 2 | 3 | 5 | 8 | 13,
  "confidence": "low | medium | high",
  "rationale": "≤ 3 sentences citing signals (≤600 chars)",
  "notesDraft": "public shipping notes draft (≤1200 chars)"
}
```
Defined in `src/lib/weight/output-schema.ts` (zod). The top of the scale (13 vs 21) is unconfirmed.
Example DM rendering:
```
Assigned: 5 → Shiplog: 5 (agrees), confidence high
"Scope matched the spec: 1 service, 1 shared-lib change, tests added."
Assigned: 3 → Shiplog: 8 (suggests ↑), confidence medium
"Spec described a UI fix; MRs touched 3 services + a shared auth lib and needed 4 review rounds."
```

---

## 6. External setup required

| System | What | Who (TBD) |
|---|---|---|
| GitLab (Premium, gitlab.com) | Group webhook on the top-level group (Issue + MR events, secret token) · group access token (`read_api`) · OAuth application (`read_user`) for "Connect GitLab" | Group Owner |
| Slack | One app: OIDC sign-in (`openid profile email`) · bot scopes `chat:write`, `im:write`, `users:read`, `users:read.email` · interactivity request URL → `/api/slack/interactions`. v2: `channels:history` for mirroring | Workspace admin |
| Render | Blueprint `render.yaml`: `shiplog-web`, `shiplog-worker`, `shiplog-db`, env group `shiplog-secrets` | Billing owner |
| LLM | OpenRouter company account, ZDR enforced account-wide | TBD |

**Environment variables** (`.env.example`): `APP_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_TEAM_ID`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
`SLACK_FEED_CHANNEL_ID`, `GITLAB_BASE_URL`, `GITLAB_GROUP_PATH`, `GITLAB_WEBHOOK_SECRET`, `GITLAB_API_TOKEN`,
`GITLAB_OAUTH_CLIENT_ID`, `GITLAB_OAUTH_CLIENT_SECRET`, `LABEL_DONE`, `LABEL_BRANCH_PREFIX`,
`LABEL_WEIGHT_PREFIX`, `REMINDER_AFTER_HOURS`, `AUTO_PUBLISH_AFTER_HOURS`, `LLM_ENABLED`, `LLM_PROVIDER_NAME`,
`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.

---

## 7. Data model (`src/lib/db/schema.ts` + `auth-schema.ts`)

| Table | Purpose / key fields |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth core. `user.role` = `member`/`dev`/`lead`. Linked identities in `account`: `providerId="slack"` → Slack user ID; `providerId="gitlab"` → GitLab user ID |
| `gitlab_events` | Raw webhook deliveries; `event_uuid` unique (dedupe); `processed_at`, `error` |
| `tickets` | Cached GitLab issue: `gitlab_issue_id` (unique), project ID/path, `iid`, title, URL, labels, `native_weight`, `label_weight`, assignee IDs, requester email/Slack ID, HubSpot URLs, state |
| `shipments` | **Unique (ticket_id, branch)**; status, recipient, notes draft/final, `published_via`, `published_at`, `verification_status`, Slack DM/feed message refs, `reminder_sent_at`, `timeline` (re-ship history) |
| `shipment_merge_requests` | Per-shipment related MRs (cross-project): state, author, target branch, files changed, +/-, review rounds, first commit, merged at. **Stats only, never diffs** |
| `verifications` | Unique (shipment, user); kind `verified`/`issue_reported`; optional comment |
| `comments` | Thread per **ticket**, optional `shipment_id`; `source` web / slack_dm / slack_thread (v2) |
| `weight_reviews` | One per shipment: assigned, verdict, suggested, confidence, rationale, active-window hours, dev response/weight, lead flag fields |
| `llm_audit_log` | Every model call: purpose, provider, model, sources plus policy level, redactions, payload SHA-256/bytes, tokens, latency, error |

Validated: `drizzle-kit generate` produces SQL for all 12 tables. **No migration is committed yet.**

---

## 8. Repository state

- Location (original session): `/home/user/shiplog`. **Git initialised, files staged, no commits, no remote.**
  The owner needs to push it to their GitLab. The archive `shiplog-scaffold.zip` (no `node_modules`/`.next`/`.git`)
  goes with this document.
- **Checks passing at handoff:** `npm run build` ✅ · `npm run typecheck` ✅ · `npm run lint` ✅ (0 warnings) ·
  `npm test` ✅ (3 files, 23 `it.todo` specs).
- Every entry point throws `notImplemented("<what>", "<milestone>")` or returns HTTP 501.

```
SCOPE.md                     short canonical spec (decisions, flow, milestones)
HANDOFF.md                   this document
AGENTS.md                    agent rules (Next.js 16 note + Shiplog hard rules)
README.md                    layout, local dev, scripts
config/
  data-policy.yaml           per-repo LLM data policy (placeholders; default: metadata)
  weight-rubric.md           placeholder rubric; leads must replace (inserted verbatim into prompt)
  calibration.yaml           empty; leads add 10–20 reference tickets
src/app/
  page.tsx                   feed placeholder (M4)
  tickets/[id]/page.tsx      ticket page placeholder (M4), Suspense-wrapped params
  settings/page.tsx          Connect GitLab / roles placeholder (M2)
  unclaimed/page.tsx         leads' queue placeholder (M2)
  api/webhooks/gitlab/       POST → 501 (M1)
  api/slack/interactions/    POST → 501 (M3)
  api/auth/[...all]/         GET/POST → 501 (M2; becomes toNextJsHandler(auth))
  api/health/                GET → { ok: true }
src/lib/
  env.ts                     zod-typed env, parsed lazily (build works without secrets)
  not-implemented.ts         notImplemented(what, milestone)
  db/schema.ts, auth-schema.ts, client.ts (lazy drizzle client)
  gitlab/labels.ts           parseLabels, doneLabelAdded, branchesAdded (stubs)
  gitlab/webhook.ts          verifyWebhookToken, storeAndEnqueue (stubs)
  gitlab/client.ts           GET-only: getRelatedMergeRequests, getMergeRequestStats, getMergeRequestDiffs (stubs)
  slack/verify.ts            verifySlackSignature (stub; v0 HMAC, 5-min window)
  slack/client.ts            WebClient singleton (implemented)
  slack/blocks.ts            ACTIONS ids (implemented) + Block Kit builders (stubs)
  shipments/ingest.ts        ingestGitlabEvent → NextStep[] (stub)
  shipments/recipient.ts     resolveRecipient (stub)
  shipments/publish.ts       publishShipment (stub)
  policy/data-policy.ts      loadDataPolicy, resolvePolicy (stubs)
  policy/redact.ts           redactText (stub)
  llm/provider.ts            languageModel() via createOpenAICompatible (implemented)
  weight/output-schema.ts    WEIGHT_SCALE + weightReviewOutput zod (implemented)
  weight/signals.ts          collectSignals (stub)
  weight/review.ts           reviewWeight (stub)
  auth/auth.ts               Better Auth config (stub, M2)
src/worker/
  jobs.ts                    JOBS queue names
  index.ts                   pg-boss start + createQueue for each job; handlers TODO
scripts/eval-weights.ts      model comparison (stub, v1.5)
tests/                       labels / shipments / policy behaviour specs as it.todo
render.yaml, Dockerfile, .dockerignore, docker-compose.yml (local Postgres 17), drizzle.config.ts,
vitest.config.mts, eslint.config.mjs (ignores _-prefixed unused vars), .env.example
```

**Contracts already defined:**
- Slack action IDs (`src/lib/slack/blocks.ts` → `ACTIONS`): `shipment.confirm_publish`, `shipment.edit_notes`,
  `shipment.add_comment`, `shipment.hold_until_merged`, `shipment.publish_anyway`, `shipment.pick_branch`,
  `weight.agree`, `weight.keep_assigned`, `weight.other`, `shipment.verify`, `shipment.report_issue`.
- Job queues (`src/worker/jobs.ts` → `JOBS`): `ingest-gitlab-event`, `send-draft-dm`, `send-reminder`,
  `auto-publish`, `publish-shipment`, `notify-requester`, `refresh-merge-requests`,
  `handle-slack-interaction`, `review-weight`.
- npm scripts: `dev`, `build`, `start`, `lint`, `worker`, `typecheck` (= `next typegen && tsc --noEmit`),
  `test`, `db:generate`, `db:migrate`, `eval:weights`.

---

## 9. Implementation notes and gotchas found while scaffolding

- **Next.js 16 differs from older training data.** The repo's `AGENTS.md` says to read the bundled docs in
  `node_modules/next/dist/docs/` before writing Next code.
- **`cacheComponents: true`:** reading `params`, `cookies()`, `headers()` or uncached DB data outside `<Suspense>`
  fails the build ("uncached or runtime data during prerendering"). Wrap dynamic parts in Suspense or use `"use cache"`.
- **`PageProps<"/route">` / `LayoutProps` are generated globals:** run `next typegen` before `tsc` (the `typecheck` script does).
- **`params` is a Promise** in pages and layouts.
- **AI SDK 7:** `generateObject` is **deprecated**. Use `generateText` with an `output` setting (`Output.object({ schema })`).
- **pg-boss 12:** named export `import { PgBoss } from "pg-boss"`. Call `createQueue(name)` before `work`/`send`.
- **zod 4:** `z.url()`, `z.stringbool()` used in `env.ts`.
- **vitest 5** needs `@types/node` ≥ 22 (pinned `^22`). The config is `.mts` to avoid an ESM/CJS warning.
- **Better Auth tables in `auth-schema.ts` were hand-written** to match its default Drizzle schema. Regenerate
  with the Better Auth CLI and compare before the first migration.
- **GitLab webhooks:** headers `X-Gitlab-Token`, `X-Gitlab-Event`, `X-Gitlab-Event-UUID`. Respond fast; GitLab
  auto-disables failing hooks. Label diffs come in `changes.labels.previous/current` on Issue Hooks.
- **Slack interactions:** verify the signature on the **raw body**, ack within **3 seconds**. Opening a modal (Edit notes)
  must happen inline using `trigger_id`, not from the worker.
- **Local webhooks:** tunnel port 3000 (e.g. `cloudflared tunnel --url http://localhost:3000`) and use a **test**
  GitLab project webhook + a dev Slack app.
- The Dockerfile is a simple single-image build used for both web and worker (`dockerCommand` differs in
  `render.yaml`). It can be optimised later.

---

## 10. Non-goals

- Not a second issue tracker. GitLab stays the source of truth. No writes to GitLab (v1/v1.5).
- No per-developer leaderboard, ranking or performance scoring.
- No two-way sync with GitLab comments.
- No direct HubSpot integration (HubSpot links in issues are displayed only).
- Not replacing Slack.

---

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + scope | ✅ Done |
| **M1** | **Ingest:** webhook receiver, event store, label parsing, ticket/shipment upsert, related MRs, nudge decisions | Applying `Development: Done` on a test issue creates the right shipment (logged, no Slack yet) |
| M2 | **Identity:** Slack sign-in, GitLab connect, roles, unclaimed queue | All 9 dev-team accounts linked |
| M3 | **Slack DM flow:** draft DM, edit modal, hold-until-merged, reminder, auto-publish, channel card, requester DM | A full ship happens without anyone typing a message |
| M4 | **Web app:** feed + filters (date, branch, label, dev, requester, verification), ticket page, thread, verify/report, DM notifications | Team stops using the channel for discussion |
| M5 (v1.5) | **Weight review:** data policy, redaction, audit log, eval harness → model choice, weight + notes in DM | Leads review the eval run, a model is chosen, rollout |
| v2 | Mirror Slack thread replies into the web app (Events API), daily digest to the channel, "Issue reported" → reopen in GitLab, team-level dashboards (no per-dev), HubSpot links | — |

Suggested M1 order: `labels.ts` (pure functions + fill in `tests/labels.test.ts`) → `webhook.ts` + route →
`gitlab/client.ts` → `recipient.ts` → `ingest.ts` → worker handler for `ingest-gitlab-event`.

---

## 12. Open items (ask the owner; don't assume)

- [ ] Top of the Fibonacci scale: 13 or 21? Is there a 0 or ½?
- [ ] Update the weight rubric (`config/weight-rubric.md`). The owner suspects the current one is outdated.
- [ ] Leads choose 10–20 calibration tickets (`config/calibration.yaml`).
- [ ] Add `Requester:` to the GitLab issue template and `## Shipping notes` to the MR template.
- [ ] Who creates the Slack app (workspace admin) and the GitLab group token, webhook and OAuth app (group Owner)?
- [ ] Who owns Render billing and the OpenRouter/LLM account?
- [ ] Fill `config/data-policy.yaml` with the real groups and projects, and decide which repos (if any) get `diff`.
- [ ] Confirm reminder (4h) and auto-publish (24h) delays.
- [ ] The repo's home on GitLab (to push the scaffold).
- [ ] Whether the company AI policy needs formal sign-off before any code (even metadata) is sent to an LLM.
