# Architecture

> **Status:** proposed 2026-11-10. It builds on `HANDOFF.md` and `SCOPE.md` and doesn't replace them.
> §10 lists the decisions made after the handoff. Copy them into `SCOPE.md` when merged.
> Items marked **(proposed)** still need the owner's confirmation.

---

## 1. Processes

```
              Issue + MR hooks (group-level)
 GitLab ─────────────────────────────────────►┐
   ▲  read_api (GET only)                     │
   │                                          ▼
   │                    ┌──────────── shiplog-web (Next.js 16) ─────────────┐
   │                    │ pages + server actions   /api/webhooks/gitlab     │
   │                    │ /api/auth/[...all]       /api/slack/interactions  │
   │                    └───────────────┬──────────────────────┬────────────┘
   │                                    │ store + enqueue      │ open modals inline
   │                                    ▼                      ▼
   │                          shiplog-db (Postgres) ◄──── pg-boss queues
   │                                    ▲
   │                    ┌───────────────┴─── shiplog-worker (Bun + pg-boss) ─┐
   └────────────────────┤ ingest · DMs · reminders · auto-publish · MR refresh│──► Slack Web API
                        │ requester notify · re-verification · weight review │──► LLM (M5, via policy)
                        └────────────────────────────────────────────────────┘
```

**Rule: the web process never does slow work inline.** It checks signatures and auth, writes the
change, queues a job and replies. The only exception is opening a Slack modal, which needs the `trigger_id`
within 3 s.

---

## 2. Layers

```
src/app/**                      thin: parse input, get viewer, call a command or query, render
src/lib/slack/interactions.ts   thin: Slack payload → command  (new)
src/worker/handlers/*.ts        thin: job payload → ingest or command  (new)
─────────────────────────────────────────────────────────────────────────────
src/lib/shipments/commands.ts   THE ONLY PLACE STATE CHANGES  (new)
src/lib/shipments/state.ts      pure transition rules, no I/O  (new)
src/lib/shipments/queries.ts    read models for pages, role-aware  (new)
src/lib/shipments/ingest.ts     GitLab event → upsert + NextStep[]  (scaffold)
─────────────────────────────────────────────────────────────────────────────
src/lib/{gitlab,slack,llm,policy,weight,auth}   adapters  (scaffold)
src/lib/db                                      schema + client  (scaffold)
```

### The command contract

Every user or system action is one function in `commands.ts`:

`confirm` · `editNotes` · `addComment` · `holdUntilMerged` · `publishAnyway` · `pickBranch` · `pickRequester` ·
`setMentions` · `autoPublish` · `releaseHeld` · `verify` · `reportIssue` · `requestReverification` ·
`respondWeight` · `flagReview`

Each command runs the same five steps:

1. **Authorize.** The actor is a `user` (with a role) or `system` (the worker). Roles are checked here, not in the UI.
2. **Load** the shipment, locking its row (`SELECT … FOR UPDATE`).
3. **Transition** by calling `state.ts`, which returns the new state or a typed error such as "already published".
4. **Persist** the change and a `timeline` entry in one transaction.
5. **Queue** the follow-up jobs (DMs, channel card, Slack message updates) in the same transaction (pg-boss writes the jobs through it), so a state change and its jobs commit together.

All jobs are idempotent, keyed by shipment and purpose, so a retry never posts twice.

The web (server actions) and Slack (interaction handler) call the same commands. A verify in a DM and a verify on
the site are the same code path.

---

## 3. Shipment state machine

### Gate order (changed from the handoff)

When a ticket is marked Done, the gates run in this order:

1. **Branch.**
2. **Open MRs.**
3. **Draft.**

The recipient is a precondition rather than a gate (D45): it's the first candidate in D4 order (assignee → MR author
→ label applier) who has connected GitLab. If none has, the shipment isn't created. The remaining gates run in order:
branch, then open MRs, then the draft.

### Statuses

| Status | Meaning | Leaves via |
|---|---|---|
| `needs_branch` | Done applied with no `Branch:` label. `branch` is NULL | `pickBranch` → next gate |
| `awaiting_hold_decision` | Related MRs still open. The recipient has the [Aguardar o merge] / [Publicar mesmo assim] DM | `holdUntilMerged` → `held` · `publishAnyway` → `pending_confirmation` |
| `held` | Waiting for the last related MR to merge | `releaseHeld` (MR Hook) → `pending_confirmation` |
| `pending_confirmation` | Draft DM sent. Reminder after 4 h | `confirm` → `published` (via `confirmed`) · `autoPublish` at 24 h → `published` (via `auto`) |
| `published` | In the feed. Channel card posted and the requester DMed | Terminal, unless the ticket is reopened and marked Done again (D7, below) |

- **(proposed)** An MR closed without merging no longer counts as open for the hold gate.
- **D7, re-ship:** if the ticket is reopened and marked Done again on the same branch, the *same row* starts a new
  draft cycle. The previous notes and verifications stay in `timeline`.

### Verification (independent of status, D12)

- There is one `verifications` row per (shipment, user), with `kind` = `verified` or `issue_reported`. The kind
  **can change**, and each change is written to the timeline.
- `shipments.verification_status` is worked out by the commands:
  - any `issue_reported` → `issue_reported`
  - otherwise any `verified` → `verified`
  - otherwise `unverified`
- **Clearing a problem:** the reporter changes their own row to `verified`. Once no `issue_reported` rows are
  left, the status updates.
- **`requestReverification`** (the dev or a lead, only while there's an `issue_reported`):
  - DMs every reporter with [Verificar] and [Ainda com problema].
  - Adds a comment to the ticket thread.
  - Can be sent at most once per hour per shipment.

---

## 4. Ingest pipeline (M1)

| Step | Where | What |
|---|---|---|
| 1 | `app/api/webhooks/gitlab/route.ts` | Check `X-Gitlab-Token` → insert `gitlab_events` (unique `event_uuid`, so repeats are ignored) → queue `ingest-gitlab-event` → reply 200 |
| 2 | `worker/handlers/ingest-gitlab-event.ts` | Load the event → `ingestGitlabEvent()` → run the `NextStep[]` it returns → set `processed_at` or `error` |
| 3 | `lib/gitlab/labels.ts` | Pure: `parseLabels`, `doneLabelAdded` (`changes.labels.previous` vs `current`), `branchesAdded` |
| 4 | `lib/gitlab/client.ts` | GET only: the issue (always refetched, never trusting the payload alone), `related_merge_requests`, MR stats |
| 5 | `lib/gitlab/templates.ts` (new) | Pure: read `Solicitante:` from the issue description and `## Notas de entrega` from MR descriptions |
| 6 | `lib/shipments/recipient.ts` | D4 order → first linked Shiplog user; none → no shipment (D45) |
| 7 | `lib/shipments/ingest.ts` | Upsert the ticket, upsert the shipment(s), run the gates, return `NextStep[]` (`send-draft-dm`, `nudge-branch`, …) |

How events turn into shipments:

| Event | Result |
|---|---|
| Done label or a trigger Status newly reached (D44) | One shipment per branch: a `Deployed <branch>` status's branch, else each `Branch:` label. With none, one `needs_branch` shipment |
| `Deployed Staging` → `Deployed Main` | A new shipment for Main (promotion, like adding a Branch label) |
| `Branch: X` added to a ticket that's already Done | A new shipment for X (promotion, D7) |
| A label added again | Nothing. The unique index catches it |
| MR Hook | Refresh the stats of linked shipments. If a shipment is `held` and no related MR is still open, `releaseHeld` |

**M1 done when:** a test issue marked `Development: Done` creates the right shipment and logs its `NextStep[]`.
Nothing goes to Slack yet.

---

## 5. Requester (D16, revised)

- **The issue template has an optional `Solicitante: <name>` line.**
  - It's left empty for general updates (new features, improvements). In that case there's no requester DM.
  - The parser accepts the template's table (a `Solicitante` column, value in the first data row), and a
    `Solicitante: Ana Ribeiro` / `**Solicitante:** Ana` line. Either can be a `@ana.ribeiro` handle.
  - Empty, `-` and `N/A` all mean no requester.
- **Resolving the name to a Slack user.**
  - The worker compares it with the workspace directory (`users.list`, cached for 1 h).
  - Names are compared without case or accents, against `real_name` and `display_name`. A `@handle` matches the
    Slack username.
- **Results:**
  - One match → `requester_slack_id`.
  - No match, or several → the draft DM shows "Solicitante não encontrado: 'Ana'" with a Slack user picker. The
    dev's pick is stored with `requester_source = dev_picked`.
  - This can't happen silently on auto-publish. With no resolved requester, the requester DM just isn't sent, and
    the ticket page shows the raw name.
- **Slack scopes:** `users:read` is enough. `users:read.email` is no longer needed for this.

---

## 6. Slack

- **`/api/slack/interactions`:**
  - Checks the signature on the raw body, rejecting requests more than 5 minutes old.
  - **Opens modals inline:** `shipment.edit_notes`, `shipment.add_comment`, and the "outro peso" picker if it
    becomes a modal.
  - Queues everything else as `handle-slack-interaction`, then replies 200.
- **Action IDs:** the existing ones in `ACTIONS`, plus `shipment.request_reverification`. The reporter's DM reuses
  `shipment.verify` and `shipment.report_issue`.
- **Jobs (M3):** `sync-recipient-dm`, `send-reminder`, `auto-publish`, `publish-shipment`,
  `sync-requester-dm`, `notify-issue-reported`, `handle-slack-interaction` (see `src/worker/jobs.ts`). Later:
  `request-reverification`.
- **Modals** use callback IDs from `MODALS` (`modal.edit_notes`, `modal.add_comment`, `modal.report_issue`); the
  requester picker is a `users_select` whose block ID carries the shipment.
- **Messages update in place.** Every DM and channel card's `channel` + `ts` is saved on the shipment. When the
  state changes (confirmed, verified, held → released), the worker calls `chat.update`, so stale buttons
  disappear.
- **Language and time:** all text is pt-BR (D37). Dates are formatted with `Intl` in **`America/Sao_Paulo`**,
  because Render runs in UTC. That applies to the web app too, including day buckets for the activity grid.

---

## 7. Web app

### Routes

The scaffold's URLs are kept in English. All interface text is pt-BR.

| Route | Page | Milestone |
|---|---|---|
| `/` | Visão geral: this week's team totals, verification, "Precisa de atenção", team activity by day, recent shipments (D38) | M4 |
| `/feed` | Entregas. Filters (period, branch, dev, requester, verification, search) live in `searchParams`; cards or list | M4 |
| `?s=<shipment>` on `/` and `/feed` | Side panel (D47): what shipped, verification, the ticket's discussion; "Ver detalhes" → ticket page | M4 |
| `/tickets/[id]` | Ticket: shipments, Staging→Main track, MR stats, thread, verify/report/re-verify, weight panel (dev/lead) | M4 |
| `/settings` | Slack/GitLab connections, roles (leads edit), "o que o Shiplog nunca faz" | M2 |
| `/dev/slack-preview` | Renders the Block Kit builders with fixtures. **Development only** (404 in production) | M3 |

The prototype's "ver como" switcher is `/dev/as?email=…`: a development-only cookie that stands in for a session. It's
refused in production and for any request that didn't come from the machine itself (the dev server is reachable
through the Cloudflare tunnel, so requests with `cf-*` headers, a non-local host or a non-loopback forwarded IP are
refused). `/dev/as` with no email clears it.

Signed-in pages live in the `(app)` route group, whose layout is the sidebar + top bar. `/sign-in` is outside it.

### Rendering

- Each page has a server-component shell with Suspense-wrapped data sections.
- Client components:
  - `VerifyButton`, `ReportForm`, `RequestReverifyButton`
  - `FeedFilters` (updates `searchParams`), `CommentComposer`
  - chart tooltips, the sidebar collapse
- Mutations are server actions that call `commands.ts`.

### Components (`src/components/`)

| Folder | Components |
|---|---|
| `ui/` | AppShell, Sidebar, NavItem, TopBar, Tile, Button, Chip, StatusDot, BranchTag, LabelTag, Flag, Avatar, AvatarStack, SegmentedControl, Search, Select, Toast, Tooltip, EmptyState |
| `shipment/` | ShipmentCard, ShipmentTable, VerificationBadge, VerifyButton, ReportForm, RequestReverifyButton, MRTable, BranchTrack, CommentThread, CommentComposer, HistoryList, AttentionList, ShipmentDrawer, WeightPanel (renders nothing for `member`; the data is already filtered by the query) |
| `charts/` | StatTile, HeroCount + DayBars, VerificationRing, ActivityHeatmap (team total by day, **never by person**) |
| `settings/` | ConnectionCard, RoleEditor, NeverRules |

The Slack Block Kit builders live in `src/lib/slack/blocks.ts`, not in React. Each one has a snapshot test, and
each mirrors a web component (draft ↔ ShipmentCard, requester DM ↔ VerifyButton).

### Styling

- The prototype's CSS tokens become Tailwind 4 `@theme` variables in `src/app/globals.css`.
- Light theme, to match the company's other apps (the prototype was dark; its layout and accents are kept).
- Fonts: Geist and Geist Mono via `next/font`. Icons: Material Symbols.
- **Patch**, the pirate mascot (`public/patch-*.svg|png`), is the logo: sidebar mark, favicon (`src/app/icon.png`,
  `apple-icon.png`) and the sign-in page. Prefer him over the old hexagon mark everywhere.
- Accent colors: purple `#7136ff` for active and primary, orange `#ff6633` for alerts.

---

## 8. Schema changes vs the scaffold (first migration, in M1)

| Table | Change |
|---|---|
| `tickets` | Replace the requester email column with `requester_raw` (text as typed, nullable), `requester_slack_id` (nullable) and `requester_source` (`template` · `dev_picked` · `none`) |
| `shipments` | `branch` **nullable**. Partial unique indexes on `(ticket_id, branch) WHERE branch IS NOT NULL` and `(ticket_id) WHERE branch IS NULL`. `status` enum = the six statuses in §3. `recipient_user_id` nullable (legacy; always set since D45). `last_reverify_requested_at` |
| `verifications` | `kind` can change. Add `updated_at`. Changes are recorded in `shipments.timeline` |
| worker | New queue `request-reverification` in `JOBS` |

When `pickBranch` resolves a `needs_branch` row to a branch that already has a shipment, the row merges into the
existing shipment's timeline and is then deleted.

---

## 9. How the hard rules are enforced

| Rule | Enforcement |
|---|---|
| Read-only toward GitLab | `gitlab/client.ts` only offers GET calls, and the token is `read_api`. A test fails if the client file contains a non-GET method |
| No per-dev ranking or aggregates | `queries.ts` has no function that groups by person. The activity grid groups by day only. Called out in `AGENTS.md` for review. Filtering the feed by dev is allowed (it's a list, not a score) |
| No stored diffs | `shipment_merge_requests` only has columns for counts. Diffs exist in memory inside `weight/signals.ts` (M5) |
| LLM data controls | `llm/call.ts` (new, M5) is the only way to reach the model: policy → redaction → call → `llm_audit_log` |
| Weight reviews for dev/lead only | Queries take the viewer and return `null` for `member`. The Slack weight block is only sent to the recipient |

---

## 10. Decisions added after the handoff (copy into SCOPE.md)

| # | Decision |
|---|---|
| D16 (revised) | Requester = **optional `Solicitante: <name>` line** (no email), resolved against the Slack directory. If there's no unique match, the dev picks in the draft DM. General updates have no requester |
| D16a | The MR template section is **`## Notas de entrega`** |
| D37 | **The interface and Slack messages are pt-BR only.** GitLab label names, branch names and terms like MR/issue stay as they are |
| D38 | The activity grid shows **team totals by day only** (applies D24) |
| D39 | **A single command layer** (`commands.ts`) is shared by server actions and Slack handlers. State only changes there |
| D40 | Gate order: **recipient → branch → open MRs → draft**. Statuses are as in §3. `branch` is nullable, with partial unique indexes |
| D41 | **The reporter can change their verification** from issue to verified. **"Pedir nova verificação"** DMs every reporter (dev or lead, at most once per hour per shipment) |
| D42 | All dates and day buckets use `America/Sao_Paulo` |

**Still open:**
- Visão geral in M4 or v2?
- Recipient fallback: first *linked* candidate (proposed)?
- An MR closed without merging no longer blocks (proposed).
- A re-ship reuses the same row with a new draft cycle (proposed reading of D7).
- Plus everything in HANDOFF §12 not answered above.

---

## 11. M1 plan

Each step is one merge request. The order follows HANDOFF §11, with the schema step added at the start.

1. **Chores:** `.gitlab-ci.yml`, `CLAUDE.md`, env loading for the worker and drizzle, the schema changes in §8,
   then the first migration.
2. **`gitlab/labels.ts` + `gitlab/templates.ts`:** pure functions, filling in the `tests/labels.test.ts` specs and
   adding template parser tests.
3. **`gitlab/webhook.ts` + route:** token check, event store, dedupe, queue. Tests use fixture payloads.
4. **`gitlab/client.ts`:** GET-only, plus the non-GET guard test.
5. **`shipments/recipient.ts`:** D4 order and the linked-user lookup. Before M2, links are seeded by a script.
6. **`shipments/state.ts` + `shipments/ingest.ts`:** gates, upserts, `NextStep[]`, and the full transition table
   as tests.
7. **Worker handler `ingest-gitlab-event` + `scripts/replay-event.ts`:** an end-to-end run against a test project.
