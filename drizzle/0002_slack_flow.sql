ALTER TABLE "shipments" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "leads_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "requester_dm_channel_id" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "requester_dm_ts" text;