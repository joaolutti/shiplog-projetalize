CREATE TYPE "public"."confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."dev_weight_response" AS ENUM('agree_with_suggestion', 'keep_assigned', 'other');--> statement-breakpoint
CREATE TYPE "public"."published_via" AS ENUM('confirmed', 'auto', 'lead');--> statement-breakpoint
CREATE TYPE "public"."requester_source" AS ENUM('template', 'dev_picked', 'none');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('unclaimed', 'needs_branch', 'awaiting_hold_decision', 'held', 'pending_confirmation', 'published');--> statement-breakpoint
CREATE TYPE "public"."verification_kind" AS ENUM('verified', 'issue_reported');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'verified', 'issue_reported');--> statement-breakpoint
CREATE TYPE "public"."weight_verdict" AS ENUM('agree', 'increase', 'decrease');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('member', 'dev', 'lead');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"shipment_id" integer,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gitlab_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_uuid" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "gitlab_events_event_uuid_unique" UNIQUE("event_uuid")
);
--> statement-breakpoint
CREATE TABLE "llm_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"sources" jsonb NOT NULL,
	"redactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_sha256" text NOT NULL,
	"payload_bytes" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_merge_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"gitlab_mr_id" bigint NOT NULL,
	"project_path" text NOT NULL,
	"iid" integer NOT NULL,
	"title" text NOT NULL,
	"web_url" text NOT NULL,
	"state" text NOT NULL,
	"author_gitlab_id" bigint,
	"target_branch" text,
	"files_changed" integer,
	"additions" integer,
	"deletions" integer,
	"review_rounds" integer,
	"first_commit_at" timestamp with time zone,
	"merged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"branch" text,
	"status" "shipment_status" NOT NULL,
	"recipient_user_id" text,
	"recipient_gitlab_id" bigint,
	"notes_draft" text,
	"notes_final" text,
	"published_via" "published_via",
	"published_at" timestamp with time zone,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"dm_channel_id" text,
	"dm_message_ts" text,
	"feed_message_ts" text,
	"reminder_sent_at" timestamp with time zone,
	"last_reverify_requested_at" timestamp with time zone,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"gitlab_issue_id" bigint NOT NULL,
	"gitlab_project_id" bigint NOT NULL,
	"project_path" text NOT NULL,
	"iid" integer NOT NULL,
	"title" text NOT NULL,
	"web_url" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"native_weight" integer,
	"label_weight" integer,
	"assignee_gitlab_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requester_raw" text,
	"requester_slack_id" text,
	"requester_source" "requester_source" DEFAULT 'none' NOT NULL,
	"hubspot_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gitlab_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_gitlab_issue_id_unique" UNIQUE("gitlab_issue_id")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"kind" "verification_kind" NOT NULL,
	"comment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weight_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"assigned_weight" integer,
	"verdict" "weight_verdict" NOT NULL,
	"suggested_weight" integer NOT NULL,
	"confidence" "confidence" NOT NULL,
	"rationale" text NOT NULL,
	"active_window_hours" integer,
	"dev_response" "dev_weight_response",
	"dev_weight" integer,
	"flagged_by_user_id" text,
	"flagged_at" timestamp with time zone,
	"flag_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_reviews_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_audit_log" ADD CONSTRAINT "llm_audit_log_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_merge_requests" ADD CONSTRAINT "shipment_merge_requests_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_reviews" ADD CONSTRAINT "weight_reviews_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weight_reviews" ADD CONSTRAINT "weight_reviews_flagged_by_user_id_user_id_fk" FOREIGN KEY ("flagged_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_ticket" ON "comments" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "smr_shipment_mr" ON "shipment_merge_requests" USING btree ("shipment_id","gitlab_mr_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_ticket_branch" ON "shipments" USING btree ("ticket_id","branch") WHERE "shipments"."branch" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_ticket_no_branch" ON "shipments" USING btree ("ticket_id") WHERE "shipments"."branch" is null;--> statement-breakpoint
CREATE INDEX "shipments_status" ON "shipments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shipments_published_at" ON "shipments" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_project_iid" ON "tickets" USING btree ("gitlab_project_id","iid");--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_shipment_user" ON "verifications" USING btree ("shipment_id","user_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");