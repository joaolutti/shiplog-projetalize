# Shiplog — Project Scope

> Status: **v1 complete (M1–M5)**. Next: the deploy on free plans (D56, `docs/DEPLOY.md`) and the team's real use.
> Last updated: 2026-11-10. System design: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
> Decisions made after the handoff are in §13.

## 1. Problem

The team announces shipped GitLab tickets in a Slack channel using a fixed, manually written
format:

```
Shipping X feature to <branch>!
<issue # with link> - Issue Title (@requester)
description of what was made
Verify and reply with a checkmark!
```

The process works, but:

1. **It's manual.** The developer finishes the ticket, opens Slack, types the message, adds the links and sends it.
2. **Work gets lost.** Several ships a day turn into a scrolling channel with no filtering, search or counts.
3. **Feedback is scattered.** Back-and-forth happens in Slack threads that are hard to follow.
4. **Verification isn't tracked.** A ✅ reaction is the only record, and nobody can see what's still unverified.
5. **No second opinion on weight.** Weights are set before work starts and never checked against what the work actually took.

## 2. Goals and non-goals

### Goals (v1)
- Applying the `Development: Done` label in GitLab is the **only** thing a developer does to ship. Everything after that is automated.
- The developer gets a **private Slack DM** with a pre-filled draft and confirms or edits it.
- A **web app** is the permanent record: a feed of shipped work, a page per ticket, a discussion thread, and verification status.
- **Anyone** in the company can verify a shipment or report a problem. Everyone signs in with Slack and nothing else.
- The existing Slack channel stays, as a **read-only feed** of published shipments.
- **LLM-drafted shipping notes** (D50): the channel text is written from the issue, the way the team's
  `pdz-generate-slack-communication` skill does it, and the dev confirms or edits it in the DM.
- Strict, per-repo control over what is sent to a model, with an audit trail.

### Next steps (after v1)
Both wait on a **group** access token, which we don't have (D51). The current token only reads `p1429/predialize`.
- An **LLM second opinion on weight**, compared against the weight assigned up front. "No change" is a valid outcome.
- **MR visibility**: MRs, repositories and line counts for MRs in other repos (most of them live under
  `p1429/modules/…`). MRs in `p1429/predialize` itself are already read.

### Non-goals
- **Not a second issue tracker.** GitLab stays the source of truth. Shiplog reads GitLab and never writes to it (v1/v1.5).
- No per-developer leaderboard, ranking or performance score. Ever.
- No two-way sync with GitLab comments. GitLab comments stay dev-only.
- No direct HubSpot integration (HubSpot links in an issue are just displayed).
- Not replacing Slack: Slack stays the notification and quick-action surface.

## 3. Users and roles

| Role | Who | Count | Can |
|---|---|---|---|
| `member` | Anyone in the Slack workspace | — | Browse the feed, comment, verify, report a problem |
| `dev` | Development team | 7 | Everything a member can, plus receive draft DMs, confirm/edit drafts, see **all** weight opinions |
| `lead` | PM + CTO | 2 | Everything a dev can, plus flag weight reviews and manage roles |

**Onboarding cost:**
- **Members:** "Sign in with Slack". That's all.
- **Devs and leads:** sign in with Slack, then "Connect GitLab" once (GitLab OAuth, `read_user` scope).

## 4. Core flow

```
GitLab: "Development: Done" label added, or Status moved to Done / Deployed Main /
        Deployed Staging (D44)
   │  group-level webhook (Issue Hook)
   ▼
[1] Receive ── verify X-Gitlab-Token, store raw event (dedupe on X-Gitlab-Event-UUID),
   │           return 200 immediately, enqueue job
   ▼
[2] Ingest ── upsert ticket; read "Branch: *", "Weight: *" labels + native weight
   │          fetch related MRs (cross-project) via the GitLab API, plus MRs referenced
   │          in the issue's comments (D48)
   │          upsert shipment, unique on (ticket, branch)
   │          gates run in this order (D40):
   │
   ├── 0. nobody linked?      → not tracked: Shiplog only works with people who connected GitLab (D45)
   │                            (leads then answer the remaining gates)
   ├── 2. no Branch label?    → DM nudge: "Which branch?" [Main] [Staging] …
   ├── 3. open MRs remain?    → DM nudge: "!45 in billing-svc is still open"
   │                              [Aguardar o merge] [Publicar mesmo assim]
   │                              (held → re-checked on each Merge Request Hook)
   ▼
[3] Draft DM to the developer
      "Shipping <title> to Staging"  · links · requester · draft notes
      [✅ Confirm & publish]  [✏️ Edit notes]  [💬 Add comment]
      (v1.5: + weight opinion, with [Agree] [Keep assigned] [Other…])
   │
   ├── no response after N hours  → one reminder DM
   ├── no response after 24h      → auto-publish, flagged "unconfirmed notes"
   ▼
[4] Publish
      ├── web app feed + ticket page
      ├── read-only card in the channel, in the team's format (D49), with [Open in Shiplog]
      └── DM the requester: "Your fix shipped to Staging" [Verify] [Open]
   ▼
[5] Verify (anyone, in the web app, from the requester DM, or with a ✅ on the channel card, D53)
      ✅ Verified (by A, B, …)   or   ⚠️ Issue reported → thread comment + DM to the dev
      Reporters can change their own row to verified. "Pedir nova verificação" DMs every
      reporter again (dev or lead, at most once per hour per shipment) (D41)
```

### Rules
- **Recipient:** the issue assignee, then the author of the linked MR, then the user who applied the label.
- **Trigger (D44).** The `Development: Done` label, or the work item Status moving to one of
  `STATUS_TRIGGERS` (default `Done`, `Deployed Main`, `Deployed Staging`). A `Deployed <branch>` status
  names the branch itself; otherwise the `Branch:` labels do. Status is read from the webhook payload
  (the REST API doesn't return it). Merge Request events only update MR state, for example to release a
  "held" shipment.
- **Branch promotion.** Shipments are unique per `(ticket, branch)`. Adding `Branch: Main` to a
  ticket already shipped to Staging, or moving it from `Deployed Staging` to `Deployed Main`, creates a
  second shipment. Removing and re-adding labels never duplicates.
- **Reopen.** If a done issue is reopened and marked Done again on the same branch, the existing shipment is
  updated and a new "re-shipped" entry is added to its timeline, instead of creating another shipment.
- **Weight mismatch.** If the native weight field and the `Weight: X` label disagree, the native
  field wins and the developer DM says so.

### Shipment states (D40, full table in `docs/ARCHITECTURE.md` §3)
```
status:        needs_branch → awaiting_hold_decision → held → pending_confirmation → published
               (each gate is skipped when it doesn't apply)
published_via: confirmed | auto | lead
verification:  unverified | verified | issue_reported      (independent of status)
```
`branch` is NULL while the shipment is `needs_branch`. Uniqueness is enforced by two partial
indexes: `(ticket_id, branch) WHERE branch IS NOT NULL` and `(ticket_id) WHERE branch IS NULL`.

### Architecture rule (D39)
Every state change goes through one function in `src/lib/shipments/commands.ts`. Server actions
and Slack handlers call the same commands.

## 5. Message content: where each field comes from

| Field | Source |
|---|---|
| Branch | `Branch: <name>` label |
| Issue #, link, title | Webhook payload |
| Requester @mention | An optional `Solicitante: <name>` line in the GitLab issue template → matched against the Slack directory (D16 revised) |
| Description of what was made | LLM draft from the issue title and description, plus each readable MR's `## Notas de entrega` (or title) (D50). Without a model, or if the call fails: the MR notes, else the MR title, else the issue title |
| Verification | Buttons, tracked per user |

**Requester matching (D16 revised):**
- The team's issue template already has it as a table: a `Solicitante` column header, the separator row, then
  the value in the first data row. A `Solicitante: Ana Ribeiro` / `**Solicitante:** Ana` line also works, and
  either can hold a `@handle`. Empty, `-` and `N/A` mean no requester (general updates such as new features have none).
- Names are compared without case or accents against Slack `real_name` and `display_name` (`users.list`, cached 1 h).
  A `@handle` matches the Slack username.
- One match → requester resolved. None or several → the draft DM asks the dev to pick a Slack user.
  If it auto-publishes unresolved, no requester DM is sent and the ticket page shows the raw name.

**Process changes needed:**
- Add an optional `Solicitante:` line to the issue template.
- ~~Add `## Notas de entrega` to the MR template~~: after v1. Most MRs live in repos the token can't read (D51).

**Language and time (D37, D42):** the interface and Slack messages are pt-BR only. GitLab label names,
branch names and terms like MR/issue stay as they are. All dates and day buckets use `America/Sao_Paulo`.

## 6. Identity and account linking

GitLab.com webhooks and the API usually **redact emails**, so accounts can't be matched automatically by email.

- **Sign in with Slack** (OpenID Connect: `openid profile email`). Sign-in is restricted to our workspace by
  checking the team ID claim.
- **Connect GitLab** (devs and leads only): GitLab OAuth, `read_user` scope. This stores the GitLab user ID ↔ Shiplog user
  mapping. Membership of the top-level group is checked when linking.
- **Roles in practice (M2).** Everyone starts as `member`. Connecting GitLab (only possible with Developer access
  or more in the top-level group) makes a member a `dev`. Leads change roles in Configurações; the last lead can't
  step down. The first lead is set with `scripts/set-role.ts`. GitLab is never a way to sign in.
- **Membership check.** Uses the server's GitLab token. A project token (development) can't list group members, so
  `GITLAB_MEMBERSHIP_PROJECT` names a project to check instead; production uses the group token and leaves it unset.
- **Requesters** never need GitLab: they're resolved from the issue template's `Solicitante:` name through Slack.
- **Unlinked GitLab user** → if none of the candidates (assignee → MR author → label applier) has connected GitLab, the
  shipment isn't tracked at all (D45).

## 7. Weight second opinion (v1.5)

Most tickets already have a weight before a developer starts (scale: Fibonacci, `config/weight-rubric.md`).
Shiplog doesn't re-estimate from scratch. It **reviews the assigned weight against what was actually done**.

### Inputs
| Category | Signals | Notes |
|---|---|---|
| Specification | Issue title/description, labels, assigned weight | Customer data is redacted (see §8) |
| Changes | MRs (cross-project), files changed, +/- lines excluding generated/lockfiles, areas/services touched, tests added, number of review rounds | Raw diffs only where the repo policy allows (§8) |
| Time | **Active window**: first commit (or MR creation) → last merge | Backlog time is excluded on purpose. Soft signal |

### Output (structured, schema-validated)
```json
{
  "verdict": "agree | increase | decrease",
  "suggestedWeight": 5,
  "confidence": "low | medium | high",
  "rationale": "≤ 3 sentences, citing signals",
  "notesDraft": "shipping notes draft (public)"
}
```

### Rules
- `agree` is a first-class answer. The prompt says explicitly that most tickets should stay the same.
- **Assigned, suggested and the developer's response are stored separately and never overwritten.**
- Nothing is written back to GitLab.
- **Visibility:** `dev` and `lead` (all devs see all opinions, as they do today). Hidden from `member`.
- Leads can **flag** a review for discussion. No aggregation per developer.
- **Calibration:** the leads pick ~10–20 past tickets with agreed weights as reference examples in the prompt.
  The rubric needs updating first.

## 8. Code exposure controls

There's no central AI account today, so Shiplog's model calls have to be controlled by Shiplog itself.

1. **Deny by default, per-repo policy** (`config/data-policy.yaml`), resolved most-specific-first
   (project → subgroup → group → default):
   - `diff`: redacted diff hunks, file paths, stats, MR text
   - `metadata`: file paths, per-file stats, MR title/description (no code)
   - `excluded`: aggregate counts only (no paths, no text)

   A ticket spanning several services applies each MR's own repo policy. Issue text follows the
   issue's project policy.
2. **Redaction before every call:** a secret-pattern scan (keys, tokens, connection strings, private
   keys), path exclusions (`.env*`, `**/secrets/**`, `*.pem`, lockfiles, generated code), PII patterns
   in issue text (emails, phone numbers, from HubSpot-sourced bugs), and a size limit (oversized diffs drop to `metadata`).
3. **Nothing stored at rest:** diffs are fetched through the API, kept in memory and thrown away. Shiplog never clones repos.
   Only derived stats and the model output are persisted.
4. **Least-privilege GitLab access:** a group access token with `read_api` only. It can't write.
5. **Audit log:** for every model call, record the provider, model, MRs included, the policy applied to each, redaction counts and a
   payload SHA-256. "What left the company for #412?" has an exact answer.
6. **Provider-level controls:** zero-data-retention / no-training routing (§9).

## 9. LLM provider options

The calls are small and cheap: about 5–20 a day, a few thousand tokens each, with structured JSON output. **Cost won't
decide this. Data terms and output quality will.**

**Key point: where a model comes from and where it runs are separate questions.** Kimi, Qwen and DeepSeek are open-weight
models. Their first-party APIs run in China, but the same weights are served by US/EU hosts
and by hyperscalers. Pick the **host** for its data terms, and pick the **model** for quality.

| Option | Models | Data story | Effort |
|---|---|---|---|
| **A. OpenRouter, with ZDR enforced** | Everything: Qwen, DeepSeek, Kimi, Claude, GPT, Gemini… | Account-wide `zdr` + `data_collection: deny` routes only to zero-retention endpoints. Adds an intermediary | Lowest: one key, switch models by changing a string |
| **B. Direct US/EU open-weight host** (Together, Fireworks, DeepInfra, Groq, …) | Open-weight only | A direct contract with one host. Check its retention/training terms | Low |
| **C. Hyperscaler** (AWS Bedrock, GCP Vertex) | Open-weight (Bedrock lists DeepSeek, Qwen3, Kimi) + Claude/GPT | Strongest: stays under the company's cloud contract | Needs cloud access (we don't have it today) |
| **D. Frontier first-party** (Anthropic, OpenAI, Google) | Their own models | Commercial API terms. ZDR can be negotiated | Low, but one vendor per model |
| **E. Open-weight first-party APIs** (DeepSeek, Moonshot, Alibaba) | Their own | Hosted in China | **Not recommended for code** |
| **F. Self-host** (e.g. Qwen3 32B on a GPU) | Open-weight | Nothing leaves our infrastructure | Overkill at this volume. Render has no GPUs |

**Recommendation:**
1. Start with **A (OpenRouter + account-level ZDR)** to evaluate. A company-owned account also gives us the central AI account we don't have yet.
2. Run `scripts/eval-weights.ts` on the calibration set across ~4–6 candidates (e.g. a large Qwen3, DeepSeek V3.x, Kimi K2.x,
   plus one small frontier model as a reference). Measure agreement with the agreed weights, error in scale steps, valid-JSON rate and latency.
3. Then either stay on A, or move to the winning model's best direct host (B), or to C if cloud access comes through.

The code is provider-agnostic: the AI SDK with an OpenAI-compatible base URL, configured with
`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`.

## 10. Architecture

| Concern | Choice | Why |
|---|---|---|
| Web app + HTTP endpoints | Next.js 16 (App Router, route handlers) | One codebase for the UI, webhooks and Slack interactions |
| Database | Postgres + Drizzle ORM | Relational data, typed schema, migrations |
| Jobs / schedules | pg-boss (on the same Postgres) | Retries, delayed jobs (reminders, auto-publish), cron. No Redis |
| Slack | `@slack/web-api` + our own signature verification | Bolt's HTTP receiver doesn't fit Next.js route handlers, and we only need the Web API + Block Kit |
| Auth | Better Auth (Slack + GitLab social providers, account linking) | Stable, has Drizzle adapter + Next.js handler |
| LLM | Vercel AI SDK + `@ai-sdk/openai-compatible` | Any provider in §9 by config. Structured output with zod |
| Validation | zod | Env, webhook payloads, LLM output |
| Runtime | **Bun** for installs, scripts and the worker; **Node 22** for Next.js (D43) | Fast installs, TypeScript without `tsx`; Next is tested on Node |
| Hosting | **Render** free web service running web + worker, **Supabase** Postgres (D56) | Docker-based, so it can move to paid plans or the company cloud later |

### Endpoints
| Path | Purpose |
|---|---|
| `POST /api/webhooks/gitlab` | Group webhook (Issue + Merge Request hooks). Store, enqueue, return 200 |
| `POST /api/slack/interactions` | Button clicks / modal submits. Verify signature, ack within 3s, enqueue |
| `POST /api/slack/events` | Events API: the URL check and ✅ `reaction_added` / `reaction_removed` (D53). Verify signature, enqueue |
| `/api/auth/*` | Better Auth (Slack sign-in, GitLab connect) |
| `GET /api/health` | Render health check |

### Background jobs (worker)
`ingest-gitlab-event` · `sync-recipient-dm` · `send-reminder` · `auto-publish` ·
`publish-shipment` · `sync-requester-dm` · `notify-issue-reported` · `handle-slack-interaction` ·
`handle-slack-reaction` · `sync-feed-reaction` · `request-reverification` ·
`refresh-merge-requests` · `review-weight` (after v1)

### Slack behaviour (M3)
- **One DM per shipment, updated in place.** The recipient's DM shows the current gate (branch picker, open MRs,
  waiting for merge, draft) and becomes "publicada" after publishing, so old buttons disappear.
- **Notes.** The draft comes from `## Notas de entrega` (or the MR title). "Editar notas" replaces it; that text is
  what gets published, and editing after publishing updates the channel card.
- **Requester.** When the `Solicitante` isn't found in Slack, the draft DM asks who it is (the only people picker;
  "Marcar no anúncio" was removed, D49). The channel card mentions nobody: the requester gets their own DM.
- **Comments.** "Comentar" adds to the ticket's thread in Shiplog (D13). Comments by anyone other than the recipient
  are echoed as replies in the recipient's DM thread; their own aren't, to keep the thread short. The web thread
  arrives with M4.
- **Timers.** The reminder (4 h) and auto-publish (24 h) belong to one draft cycle: a confirm, re-ship or reopen in
  between cancels them.
- **Requester.** Matched against the Slack directory when the draft goes out; if there's no single match, the draft
  DM asks the dev to pick. A requester who has never opened Shiplog can still verify or report from their DM: their
  account is created on first contact, and Slack sign-in later lands on it.
- **Development guard.** `SLACK_DM_ALLOWLIST` (development only) redirects DMs for anyone else to the first listed
  user, marked with who they were for, so real colleagues get nothing while testing against the live workspace.
  Use a test channel for `SLACK_FEED_CHANNEL_ID` in development.

### Data model (`src/lib/db/schema.ts`)
`user / session / account / verification` (Better Auth) · `gitlab_events` · `tickets` · `shipments` ·
`shipment_merge_requests` · `verifications` · `comments` · `weight_reviews` · `llm_audit_log`

### External setup
| System | What | Who |
|---|---|---|
| GitLab (Premium) | Group webhook on the top-level group (Issue + MR events, secret token). Group access token (`read_api`). OAuth application (`read_user`) | Group Owner |
| Slack | One Slack app: OIDC sign-in, bot (`chat:write`, `im:write`, `users:read`, `reactions:read`, `reactions:write`), interactivity URL, event subscriptions (`reaction_added`, `reaction_removed` → `/api/slack/events`). Phase 2: `channels:history` for mirroring | João (free plan) |
| Render | Blueprint (`render.yaml`): web, worker, Postgres, secret env group | João (free plan) |
| LLM | OpenRouter account, free model (D52) | João (free plan) |

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + scope | ✅ This repo |
| M1 | **Ingest**: webhook receiver, event store, label parsing, ticket/shipment upsert, related MRs, nudge decisions | Applying `Development: Done` on a test issue creates the right shipment (logged, no Slack yet). ✅ Locally with `scripts/fake-gitlab.ts`; a run against a real test project waits on a GitLab token + webhook |
| M2 | **Identity**: Slack sign-in, GitLab connect, roles | ✅ The owner's account signed in with Slack and linked to GitLab. The rest of the team links when the app goes live (v1) |
| M3 | **Slack DM flow**: draft DM, edit modal, hold-until-merged, reminder, auto-publish, channel card, requester DM | A full ship happens without anyone typing a message. ✅ Locally against real GitLab and Slack (2026-11-13) |
| M4 | **Web app**: feed + filters (date, branch, label, dev, requester, verification), ticket page, thread, verify/report, DM notifications | The team stops using the channel for discussion. ✅ Built; adoption waits on the deploy |
| M5 | **LLM notes**: data policy, redaction, audit log, notes draft from the issue (D50) | The channel text reads like the team's announcements without the dev rewriting it. ✅ First real draft on #5108 (2026-11-13) |
| Next | **Weight review** (eval harness → model choice, weight in DM) and **MR visibility** across repos. Both need a group token (D51) | Eval run reviewed by the leads, model chosen, rollout |
| v2 | Mirror Slack thread replies into the web app, daily digest, "Issue reported" → reopen in GitLab, team-level dashboards, HubSpot links | — |

## 12. Open items

- [ ] **Hosting:** deploy on free plans (D56) following `docs/DEPLOY.md`, then have the team sign in and connect GitLab.
- [ ] **Visual branding:** a mascot identity for the Slack bot and web app: a little helper character dressed as a
      pirate (we're *shipping* things). Covers the bot avatar, app icon and empty states. Before M3's Slack
      messages are finalized and M4's design system.

- [ ] Confirm the Fibonacci scale's top value (13? 21?) and update the rubric (`config/weight-rubric.md`).
- [ ] Leads choose the calibration tickets (`config/calibration.yaml`).
- [x] ~~Add `Solicitante` to the issue template~~: already there, as a table column (read since 2026-11-10).
- [x] ~~Add `## Notas de entrega` to the MR template~~: after v1, with MR visibility (D51). Today the token can't read most MRs.
- [ ] ~~Production needs a **group** access token (D29)~~: not available, so weight review and cross-repo MRs move after v1 (D51). A project token only sees its own project, so MRs in
      other repos can't be read: #5129's MR (`p1429/modules/backend/api/services/databook!132`, linked in an
      internal comment, D48) returns 404 with the current `p1429/predialize` token.
- [x] ~~Visão geral: M4 or v2?~~ M4, as the home page (`/`); Entregas moved to `/feed`.
- [x] ~~First linked candidate~~: confirmed, and with nobody linked the shipment isn't tracked (D45).
- [ ] Confirm (implemented this way in M1): an MR closed without merging no longer blocks the hold gate.
- [ ] Confirm (implemented this way in M1): a re-ship (reopen → Done again, same branch) reuses the same shipment row with a new draft cycle.
- [ ] Confirm (implemented this way in M1): a shipment still waiting on the hold question moves on to the draft once no related MR is open.
- [x] ~~Who owns the Slack app, Render billing and the LLM account?~~ João, all on free plans (2026-11-13).
- [ ] Who sets up the production GitLab webhook (project Maintainer on `p1429/predialize`)?
- [ ] Fill in `config/data-policy.yaml` with the real groups/projects.
- [x] ~~Reminder delay and auto-publish delay~~: 4 h and 24 h; reminders only in business hours (D54).

## 13. Decisions after the handoff

Numbered to continue the decision log in `HANDOFF.md` §3. Where they differ, these win.

| # | Decision |
|---|---|
| D16 (revised) | Requester = **optional `Solicitante: <name>` line** (no email), resolved against the Slack directory. If there's no unique match, the dev picks in the draft DM. General updates have no requester. `users:read.email` is no longer needed |
| D16a | The MR template section is **`## Notas de entrega`** |
| D37 | **The interface and Slack messages are pt-BR only.** GitLab label names, branch names and terms like MR/issue stay as they are |
| D38 | The activity grid shows **team totals by day only** (applies D24) |
| D39 | **A single command layer** (`src/lib/shipments/commands.ts`) is shared by server actions and Slack handlers. State only changes there |
| D40 | Gate order: **branch → open MRs → draft** (a linked recipient is a precondition, D45). Statuses: `needs_branch`, `awaiting_hold_decision`, `held`, `pending_confirmation`, `published`. `branch` is nullable, with partial unique indexes |
| D41 | **The reporter can change their verification** from issue to verified. **"Pedir nova verificação"** DMs every reporter (dev or lead, at most once per hour per shipment) |
| D42 | All dates and day buckets use `America/Sao_Paulo` |
| D44 | **The ship trigger is the `Development: Done` label or a trigger work item Status** (`Done`, `Deployed Main`, `Deployed Staging`; configurable with `STATUS_TRIGGERS`). Replaces D2's label-only trigger: the board's Deployed columns are Status lists, which don't change labels, and Shiplog never writes to GitLab. `Deployed <branch>` implies the branch |
| D45 | **Only people who connected GitLab.** The recipient is the first candidate in D4 order with GitLab linked; if none is, the shipment isn't created. Replaces D10 (unclaimed queue, leads' DM, "publicar como líder") and the recipient gate of D40 |
| D46 | **GitLab labels aren't shown in the interface.** They're internal tracking; the branch (Main / Staging) is the only one surfaced, as a tag. Search still matches them |
| D47 | **Clicking a shipment opens a side panel** (`?s=<shipment>`) with what shipped, verification and the ticket's discussion; "Ver detalhes" opens the ticket page |
| D48 | **MRs linked in issue comments count as related.** The team links MRs in (often internal) comments, and GitLab's `related_merge_requests` only lists MRs that mention the issue. Ingest also reads `group/proj!N`, `!N` and MR URLs from the issue's non-system notes |
| D49 | **The channel card follows the team's announcement format**: "Bom dia / Boa tarde / Boa noite, pessoal!" (São Paulo time of publishing), `:large_blue_square:` Main / `:large_yellow_square:` Staging "Saindo ajuste para MAIN:", `:fire: #iid - Hubspot - title`, the notes quoted, "Verificar e dar um positivo aqui ✅", plus [Abrir no Shiplog]. No @mentions; the "Marcar no anúncio" picker is gone. Only the issue's "Link do card no Hubspot" is linked, never attachments |
| D43 | **Bun** is the package manager, script runner and worker runtime. **Next.js runs on Node 22.** Code under `src/` uses no Bun-only APIs. Replaces "npm + tsx" |
| D50 | **LLM-drafted notes in v1.** The channel text (the quoted line) is drafted from the issue title and description plus readable MRs' `## Notas de entrega`, with the rules of the team's `pdz-generate-slack-communication` skill (pt-BR, 1–3 sentences, nothing invented). It runs at ingest, behind `LLM_ENABLED`, through the data policy and redaction, and every call is logged in `llm_audit_log` (`purpose = notes_draft`). Any failure falls back to the MR notes / MR title / issue title. The dev still confirms or edits it in the DM |
| D51 | **No group access token.** We keep the `p1429/predialize` project token, so the weight second opinion and cross-repo MR visibility move to "Next steps (after v1)" |
| D52 | **v1 runs on an OpenRouter free model** (e.g. `google/gemma-4-31b-it:free`). Free models allow 50 requests/day and we send at most ~15. Many don't support structured outputs, so the draft is plain text, checked for length. A failure or a hit limit falls back to the plain notes. Free endpoints may log prompts, which is acceptable while v1 is a trial: only redacted issue text is sent. A paid model (or a direct Anthropic API key) is one setting away if Shiplog is adopted |
| D53 | **✅ on the channel card and verification mirror each other.** A ✅ reaction verifies the shipment as that Slack user (account created on first contact, D12); removing it takes their verification back but never drops a reported problem. Verified in Shiplog (web or DM) with nobody's ✅ on the card yet → the bot adds its own ✅, and removes it once people react or the shipment stops being verified. Only `:white_check_mark:` on the channel card counts. Slack lets the bot remove only its own reactions, so undoing a verification on the web leaves that person's ✅ on the card; accepted for v1 (2026-11-13), the web is the record |
| D54 | **Reminders only in business hours**: 4 h after the draft, moved to the next São Paulo business time (Monday–Friday, 9:00–18:00) if it lands outside it. The reminder says how long is left until auto-publish (24 h, which isn't moved). National holidays count as business days for now |
| D55 | **No MR, repository or line counts in v1**, for any role (D51): most are 0 because the MRs live in repos the token can't read. The ticket page also drops the weight panel and the Staging → Main track |
| D56 | **v1 runs on free plans.** One Render web service runs the migrations, the worker and the web app (`scripts/start.sh`), since Render's free plan has no background workers; Postgres on Supabase (no compute metering; Render's free Postgres expires after 30 days); a 10-minute keep-alive ping so the service never sleeps past Slack's 3-second deadline. The production Slack app is created from `docs/slack-manifest.yaml`; the dev app stays for local work. Paid plans later are a configuration change |
