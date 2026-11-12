/**
 * Shiplog domain schema. See SCOPE.md §4 (flow), §7 (weight), §8 (audit) and
 * docs/ARCHITECTURE.md §3 (state machine), §8 (changes vs the scaffold).
 *
 * Shiplog never writes to GitLab, so `tickets` and `shipment_merge_requests` are
 * cached copies of GitLab state, refreshed from webhooks and API reads.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

// ── Enums ────────────────────────────────────────────────────────────

// Gates run branch → open MRs → draft (D40). No shipment exists without a linked recipient.
export const shipmentStatus = pgEnum("shipment_status", [
  "needs_branch", // Done applied without a Branch label; `branch` is NULL
  "awaiting_hold_decision", // related MRs still open; recipient chooses hold or publish anyway
  "held", // waiting for the last related MR to merge
  "pending_confirmation", // draft DM sent, waiting for the dev
  "published",
]);

// Where `tickets.requester_slack_id` came from (D16 revised).
export const requesterSource = pgEnum("requester_source", ["template", "dev_picked", "none"]);

export const publishedVia = pgEnum("published_via", ["confirmed", "auto"]);

export const verificationStatus = pgEnum("verification_status", [
  "unverified",
  "verified",
  "issue_reported",
]);

export const verificationKind = pgEnum("verification_kind", ["verified", "issue_reported"]);

export const weightVerdict = pgEnum("weight_verdict", ["agree", "increase", "decrease"]);
export const confidence = pgEnum("confidence", ["low", "medium", "high"]);
export const devWeightResponse = pgEnum("dev_weight_response", [
  "agree_with_suggestion",
  "keep_assigned",
  "other",
]);

// ── GitLab event store ───────────────────────────────────────────────

// Raw webhook deliveries. Deduped on GitLab's X-Gitlab-Event-UUID header.
export const gitlabEvents = pgTable("gitlab_events", {
  id: serial("id").primaryKey(),
  eventUuid: text("event_uuid").notNull().unique(),
  eventType: text("event_type").notNull(), // X-Gitlab-Event, e.g. "Issue Hook"
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

// ── Tickets (cached GitLab issues) ───────────────────────────────────

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    gitlabIssueId: bigint("gitlab_issue_id", { mode: "number" }).notNull().unique(),
    gitlabProjectId: bigint("gitlab_project_id", { mode: "number" }).notNull(),
    projectPath: text("project_path").notNull(), // e.g. "group/billing-svc"
    iid: integer("iid").notNull(),
    title: text("title").notNull(),
    webUrl: text("web_url").notNull(),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    // Native GitLab weight field (source of truth).
    nativeWeight: integer("native_weight"),
    // Parsed from the "Weight: X" label; mismatch with native is surfaced to the dev.
    labelWeight: integer("label_weight"),
    assigneeGitlabIds: jsonb("assignee_gitlab_ids").$type<number[]>().notNull().default([]),
    // `Solicitante:` value as typed in the issue; NULL for general updates.
    requesterRaw: text("requester_raw"),
    requesterSlackId: text("requester_slack_id"),
    requesterSource: requesterSource("requester_source").notNull().default("none"),
    hubspotUrls: jsonb("hubspot_urls").$type<string[]>().notNull().default([]),
    gitlabState: text("gitlab_state").notNull(), // opened | closed
    // Work item Status name from the last webhook, e.g. "Deployed Main" (not in the REST API).
    gitlabStatus: text("gitlab_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("tickets_project_iid").on(t.gitlabProjectId, t.iid)],
);

// ── Shipments: one per (ticket, branch) ──────────────────────────────

export type TimelineEntry = { at: string; event: string; data?: Record<string, unknown> };

export const shipments = pgTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    branch: text("branch"), // null while needs_branch
    status: shipmentStatus("status").notNull(),
    // Dev who receives the draft DM: the first of assignee → MR author → label applier with GitLab linked.
    recipientUserId: text("recipient_user_id").references(() => user.id),
    recipientGitlabId: bigint("recipient_gitlab_id", { mode: "number" }),
    notesDraft: text("notes_draft"),
    notesFinal: text("notes_final"),
    publishedVia: publishedVia("published_via"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    verificationStatus: verificationStatus("verification_status").notNull().default("unverified"),
    // Slack message references, for updating messages in place
    dmChannelId: text("dm_channel_id"),
    dmMessageTs: text("dm_message_ts"),
    feedMessageTs: text("feed_message_ts"),
    // Start of the current draft cycle; the reminder and auto-publish jobs carry it.
    pendingSince: timestamp("pending_since", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // Slack users the dev chose to @mention on the channel card.
    mentionSlackIds: jsonb("mention_slack_ids").$type<string[]>().notNull().default([]),
    requesterDmChannelId: text("requester_dm_channel_id"),
    requesterDmTs: text("requester_dm_ts"),
    // "Pedir nova verificação" is allowed at most once per hour per shipment (D41).
    lastReverifyRequestedAt: timestamp("last_reverify_requested_at", { withTimezone: true }),
    // Every transition, re-ship and verification change, in order.
    timeline: jsonb("timeline").$type<TimelineEntry[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("shipments_ticket_branch")
      .on(t.ticketId, t.branch)
      .where(sql`${t.branch} is not null`),
    // At most one branchless (needs_branch) shipment per ticket.
    uniqueIndex("shipments_ticket_no_branch")
      .on(t.ticketId)
      .where(sql`${t.branch} is null`),
    index("shipments_status").on(t.status),
    index("shipments_published_at").on(t.publishedAt),
  ],
);

// MRs related to the ticket at ship time (may span projects). Stats only — never diffs.
export const shipmentMergeRequests = pgTable(
  "shipment_merge_requests",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    gitlabMrId: bigint("gitlab_mr_id", { mode: "number" }).notNull(),
    projectPath: text("project_path").notNull(),
    iid: integer("iid").notNull(),
    title: text("title").notNull(),
    webUrl: text("web_url").notNull(),
    state: text("state").notNull(), // opened | merged | closed
    authorGitlabId: bigint("author_gitlab_id", { mode: "number" }),
    targetBranch: text("target_branch"),
    filesChanged: integer("files_changed"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    reviewRounds: integer("review_rounds"),
    firstCommitAt: timestamp("first_commit_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("smr_shipment_mr").on(t.shipmentId, t.gitlabMrId)],
);

// ── Verification & discussion ────────────────────────────────────────

export const verifications = pgTable(
  "verifications",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // Can change (issue_reported ↔ verified); each change is written to the shipment timeline.
    kind: verificationKind("kind").notNull(),
    commentId: integer("comment_id").references(() => comments.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("verifications_shipment_user").on(t.shipmentId, t.userId)],
);

// Thread is per ticket; a comment may reference the shipment it's about.
export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    shipmentId: integer("shipment_id").references(() => shipments.id),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    source: text("source").notNull().default("web"), // web | slack_dm | slack_thread (v2)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [index("comments_ticket").on(t.ticketId)],
);

// ── Weight second opinion (v1.5) ─────────────────────────────────────

// Assigned / suggested / dev response are stored side by side and never overwritten.
export const weightReviews = pgTable("weight_reviews", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .unique()
    .references(() => shipments.id, { onDelete: "cascade" }),
  assignedWeight: integer("assigned_weight"),
  verdict: weightVerdict("verdict").notNull(),
  suggestedWeight: integer("suggested_weight").notNull(),
  confidence: confidence("confidence").notNull(),
  rationale: text("rationale").notNull(),
  activeWindowHours: integer("active_window_hours"),
  devResponse: devWeightResponse("dev_response"),
  devWeight: integer("dev_weight"),
  flaggedByUserId: text("flagged_by_user_id").references(() => user.id),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  flagNote: text("flag_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per model call: answers "what left the company for ticket X?".
export const llmAuditLog = pgTable("llm_audit_log", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id").references(() => shipments.id),
  purpose: text("purpose").notNull(), // weight_review | notes_draft | eval
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  // Per-MR policy applied, e.g. [{ project: "group/svc", iid: 45, level: "metadata" }].
  sources: jsonb("sources")
    .$type<Array<{ project: string; iid: number; kind: "issue" | "mr"; level: string }>>()
    .notNull(),
  redactions: jsonb("redactions").$type<Record<string, number>>().notNull().default({}),
  payloadSha256: text("payload_sha256").notNull(),
  payloadBytes: integer("payload_bytes").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
