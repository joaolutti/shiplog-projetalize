# Roadmap

Where Shiplog goes after v1. v1 automates the announcement and makes verification count. What follows makes the
record richer (MRs, weight), keeps conversations in one place, and connects to where customers' requests come from.

Decisions behind each item are in [SCOPE.md](../SCOPE.md) (the `D` numbers). Nothing here changes the principles:
GitLab stays read-only, code is never stored, and there are no per-developer rankings.

| Horizon | Theme | Depends on |
|---|---|---|
| **Now** | Launch v1 | Render, the production Slack app, the team signing in |
| **Next** | MR visibility and review · Weight second opinion | A GitLab **group** access token (D51) |
| **Then** | Slack ↔ web conversation sync · Digest · Team dashboards | v1 adoption |
| **Later** | HubSpot loop · Reopen on reported issue · Model and data upgrades | Decisions listed per item |

---

## Now: launch v1

The product is done; these are the steps to put it in front of the team.

- **Deploy to Render**: web app, worker and Postgres from `render.yaml`. The blueprint still needs `LLM_ENABLED`,
  `LLM_MODEL` and `GITLAB_MEMBERSHIP_PROJECT`.
- **Production Slack app and GitLab webhook** pointed at the production URL, with `SLACK_DM_ALLOWLIST` unset.
- **Onboarding**: everyone signs in with Slack; developers connect GitLab once. Shiplog only tracks deliveries of
  people who connected GitLab (D45), so this is what turns it on for each developer.
- **First weeks**: watch the success metrics (below) and the LLM drafts' edit rate.

## Next: MR visibility and review

**Why:** the issue says what was asked; the merge requests show what was done. Today Shiplog can only read MRs in
`p1429/predialize`, but most of the work lives in repos under `p1429/modules/…`, so MR counts, lines changed and
the "MRs still open" check are hidden in v1 (D55).

**What it brings**
- MRs from every repo linked to the issue (including the ones linked in internal comments, D48), with their state,
  repositories touched, lines changed and review rounds, on the ticket page and the cards, for developers and leads.
- The **open-MR gate** across repos: "!45 in billing-svc is still open → wait for the merge or publish anyway".
- **Notes from the MR**: a `## Notas de entrega` section in the MR template becomes the base of the draft, which
  the LLM only polishes.
- Optionally, **diff-aware drafts** for repos whose data policy allows it (`diff` level, redacted, size-capped,
  never stored).

**Needs:** a GitLab group access token with `read_api` (a group Owner creates it), then the MR template in each
repo.

## Next: weight second opinion

**Why:** weights are set before the work starts. Comparing them with what was actually done keeps estimates honest
and feeds better planning, without re-estimating everything.

**What it brings**
- After a delivery, the LLM reviews the assigned weight against the issue, the MRs (files, lines, services
  touched, tests, review rounds) and the active time window. It answers **agree**, **increase** or **decrease**,
  with a suggested weight, a confidence and up to three sentences of reasons.
- **"Agree" is the expected answer**: the prompt says most tickets should stay the same.
- The developer sees it in the DM and can agree, keep the assigned weight or suggest another. Assigned, suggested
  and the developer's answer are stored separately and never overwritten.
- Visible to developers and leads only. Leads can flag one for discussion. **Never aggregated per developer.**
- Nothing is written back to GitLab.

**Needs:** MR visibility (above), the team's weight rubric updated (`config/weight-rubric.md`), 10–20 calibration
tickets picked by the leads (`config/calibration.yaml`), and an evaluation run across a few models
(`scripts/eval-weights.ts`) before choosing one.

## Then: Slack ↔ web conversation sync

**Why:** discussion happens in two places. Replies in the channel post's thread are invisible on the web, and web
comments are invisible in Slack.

**What it brings**
- Replies in the channel post's thread appear in the ticket's discussion on the web, with author and time.
- Comments made on the web are posted to that thread, so Slack readers see them.
- Reports of problems made in a thread can become a "problem reported" with one click.
- Optionally, removing a person's ✅ in Slack when they undo a verification on the web. Slack only lets an app
  remove its own reactions, so this needs each person to authorize Shiplog once with their own Slack token.
  Accepted as a gap in v1 (D53).

**Needs:** the Slack scope `channels:history`, and a decision on which direction is the default.

## Then: daily digest

A short message, once a day in business hours: what shipped yesterday, what still waits for verification, and
what has a reported problem. In the channel, or as a DM to each lead. Replaces the "did anyone check X?" questions.

## Then: team dashboards

Team-level views over time: deliveries per week, time from deploy to verification, share verified, share with
reported problems, Main vs Staging. **Team totals only**, never per developer (D38).

## Later

- **HubSpot loop.** When a delivery linked to a HubSpot ticket is published or verified, note it on the HubSpot
  record, so Customer Success knows without asking. Today the link is only displayed.
- **Reopen on reported problem.** Offer to reopen the GitLab issue when a problem is reported. This is the first
  GitLab *write* and breaks the read-only rule on purpose, so it needs an explicit decision and a separate,
  write-scoped token.
- **Holiday calendar** for reminders, so they skip national holidays as well as weekends (D54).
- **Model and data upgrades** once Shiplog is adopted: a paid model with zero data retention, or a direct
  Anthropic API key, instead of the free OpenRouter model (D52). One setting.
- **Data hygiene**: a retention window for raw GitLab webhook payloads, encrypted OAuth tokens at rest, backups and
  alerting. See [TECHNICAL.md](./TECHNICAL.md#data-security-and-retention).

## How we'll know it works

Measured from Shiplog's own data, team-level only.

| Metric | Today (manual) | Target |
|---|---|---|
| Deliveries announced | Some, when remembered | Every delivery that reaches *Deployed* |
| Time from deploy to announcement | Minutes to never | Under 1 h (median), 24 h at most |
| Drafts published without edits | — | Most; the edit rate tells us if the LLM helps |
| Deliveries verified | Unknown | Most within 2 business days |
| Time from announcement to first verification | Unknown | Falling week over week |
| Problems reported through Shiplog | Scattered in threads | All of them, with a DM to the developer |
| People who sign in or verify | — | The whole product and CS team, not only developers |
