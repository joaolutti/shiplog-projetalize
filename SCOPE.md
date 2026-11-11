# Shiplog — Project Scope

> Status: **M1 (Ingest) done**, verified end to end against a local fake GitLab. Next: M2 (Identity).
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

### Goals (v1.5)
- An **LLM second opinion on weight**, compared against the weight assigned up front. "No change" is a valid outcome.
- LLM-drafted shipping notes.
- Strict, per-repo control over what source code is sent to a model, with an audit trail.

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
| `lead` | PM + CTO | 2 | Everything a dev can, plus flag weight reviews, handle unclaimed drafts, manage roles |

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
   │          fetch related MRs (cross-project) via the GitLab API
   │          upsert shipment, unique on (ticket, branch)
   │          gates run in this order (D40):
   │
   ├── 1. recipient unlinked? → status "unclaimed": DM leads + "Unclaimed" queue in web app
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
      ├── read-only card in the channel with [Open in Shiplog]
      └── DM the requester: "Your fix shipped to Staging" [Verify] [Open]
   ▼
[5] Verify (anyone, in the web app or from the requester DM)
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
status:        unclaimed → needs_branch → awaiting_hold_decision → held → pending_confirmation → published
               (each gate is skipped when it doesn't apply; a lead can publish an unclaimed shipment directly)
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
| Description of what was made | v1: the `## Notas de entrega` section of the MR template, falling back to the MR title. v1.5: LLM draft |
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
- Add `## Notas de entrega` to the MR template.

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
- **Unlinked GitLab user** → the shipment becomes `unclaimed`, the leads get a DM, and it appears in the web app queue.

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
| Hosting | **Render**: web service + background worker + managed Postgres | Docker-based, so it can move to the company cloud later |

### Endpoints
| Path | Purpose |
|---|---|
| `POST /api/webhooks/gitlab` | Group webhook (Issue + Merge Request hooks). Store, enqueue, return 200 |
| `POST /api/slack/interactions` | Button clicks / modal submits. Verify signature, ack within 3s, enqueue |
| `/api/auth/*` | Better Auth (Slack sign-in, GitLab connect) |
| `GET /api/health` | Render health check |

### Background jobs (worker)
`ingest-gitlab-event` · `send-draft-dm` · `send-reminder` · `auto-publish` · `publish-shipment` ·
`notify-requester` · `refresh-merge-requests` · `handle-slack-interaction` · `request-reverification` ·
`review-weight` (v1.5)

### Data model (`src/lib/db/schema.ts`)
`user / session / account / verification` (Better Auth) · `gitlab_events` · `tickets` · `shipments` ·
`shipment_merge_requests` · `verifications` · `comments` · `weight_reviews` · `llm_audit_log`

### External setup
| System | What | Who |
|---|---|---|
| GitLab (Premium) | Group webhook on the top-level group (Issue + MR events, secret token). Group access token (`read_api`). OAuth application (`read_user`) | Group Owner |
| Slack | One Slack app: OIDC sign-in, bot (`chat:write`, `im:write`, `users:read`), interactivity URL. Phase 2: `channels:history` for mirroring | Workspace admin |
| Render | Blueprint (`render.yaml`): web, worker, Postgres, secret env group | Whoever owns billing |
| LLM | OpenRouter company account with ZDR enforced | TBD (§12) |

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + scope | ✅ This repo |
| M1 | **Ingest**: webhook receiver, event store, label parsing, ticket/shipment upsert, related MRs, nudge decisions | Applying `Development: Done` on a test issue creates the right shipment (logged, no Slack yet). ✅ Locally with `scripts/fake-gitlab.ts`; a run against a real test project waits on a GitLab token + webhook |
| M2 | **Identity**: Slack sign-in, GitLab connect, roles, unclaimed queue | All 9 dev-team accounts linked |
| M3 | **Slack DM flow**: draft DM, edit modal, hold-until-merged, reminder, auto-publish, channel card, requester DM | A full ship happens without anyone typing a message |
| M4 | **Web app**: feed + filters (date, branch, label, dev, requester, verification), ticket page, thread, verify/report, DM notifications | The team stops using the channel for discussion |
| M5 (v1.5) | **Weight review**: data policy, redaction, audit log, eval harness → model choice, weight + notes in DM | Eval run reviewed by the leads, model chosen, rollout |
| v2 | Mirror Slack thread replies into the web app, daily digest, "Issue reported" → reopen in GitLab, team-level dashboards, HubSpot links | — |

## 12. Open items

- [ ] Confirm the Fibonacci scale's top value (13? 21?) and update the rubric (`config/weight-rubric.md`).
- [ ] Leads choose the calibration tickets (`config/calibration.yaml`).
- [x] ~~Add `Solicitante` to the issue template~~: already there, as a table column (read since 2026-11-10).
- [ ] Add `## Notas de entrega` to the MR template.
- [ ] Production needs a **group** access token (D29). A project token only sees its own project, so related MRs in
      other repos come back empty: on `p1429/predialize` every sampled Done issue showed 0 related MRs.
- [ ] Visão geral (`/overview`): M4 or v2?
- [ ] Confirm (implemented this way in M1): the recipient is the *first linked* candidate in D4 order; `unclaimed` only when none is linked.
- [ ] Confirm (implemented this way in M1): an MR closed without merging no longer blocks the hold gate.
- [ ] Confirm (implemented this way in M1): a re-ship (reopen → Done again, same branch) reuses the same shipment row with a new draft cycle.
- [ ] Confirm (implemented this way in M1): a shipment still waiting on the hold question moves on to the draft once no related MR is open.
- [ ] Who creates the Slack app (workspace admin) and the GitLab group token/webhook (group Owner)?
- [ ] Who owns Render billing and the LLM account?
- [ ] Fill in `config/data-policy.yaml` with the real groups/projects.
- [ ] Reminder delay (default 4h) and auto-publish delay (default 24h).

## 13. Decisions after the handoff

Numbered to continue the decision log in `HANDOFF.md` §3. Where they differ, these win.

| # | Decision |
|---|---|
| D16 (revised) | Requester = **optional `Solicitante: <name>` line** (no email), resolved against the Slack directory. If there's no unique match, the dev picks in the draft DM. General updates have no requester. `users:read.email` is no longer needed |
| D16a | The MR template section is **`## Notas de entrega`** |
| D37 | **The interface and Slack messages are pt-BR only.** GitLab label names, branch names and terms like MR/issue stay as they are |
| D38 | The activity grid shows **team totals by day only** (applies D24) |
| D39 | **A single command layer** (`src/lib/shipments/commands.ts`) is shared by server actions and Slack handlers. State only changes there |
| D40 | Gate order: **recipient → branch → open MRs → draft**. Statuses: `unclaimed`, `needs_branch`, `awaiting_hold_decision`, `held`, `pending_confirmation`, `published`. `branch` is nullable, with partial unique indexes |
| D41 | **The reporter can change their verification** from issue to verified. **"Pedir nova verificação"** DMs every reporter (dev or lead, at most once per hour per shipment) |
| D42 | All dates and day buckets use `America/Sao_Paulo` |
| D44 | **The ship trigger is the `Development: Done` label or a trigger work item Status** (`Done`, `Deployed Main`, `Deployed Staging`; configurable with `STATUS_TRIGGERS`). Replaces D2's label-only trigger: the board's Deployed columns are Status lists, which don't change labels, and Shiplog never writes to GitLab. `Deployed <branch>` implies the branch |
| D43 | **Bun** is the package manager, script runner and worker runtime. **Next.js runs on Node 22.** Code under `src/` uses no Bun-only APIs. Replaces "npm + tsx" |
