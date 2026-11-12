-- Shiplog only works with people who connected GitLab: no unclaimed shipments, no lead publish.
-- Comments stay on the ticket and the LLM audit log is kept; both just lose the shipment link.
UPDATE "comments" SET "shipment_id" = NULL WHERE "shipment_id" IN (SELECT "id" FROM "shipments" WHERE "status" = 'unclaimed');--> statement-breakpoint
UPDATE "llm_audit_log" SET "shipment_id" = NULL WHERE "shipment_id" IN (SELECT "id" FROM "shipments" WHERE "status" = 'unclaimed');--> statement-breakpoint
DELETE FROM "shipments" WHERE "status" = 'unclaimed';--> statement-breakpoint
UPDATE "shipments" SET "published_via" = 'confirmed' WHERE "published_via" = 'lead';--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "published_via" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."published_via";--> statement-breakpoint
CREATE TYPE "public"."published_via" AS ENUM('confirmed', 'auto');--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "published_via" SET DATA TYPE "public"."published_via" USING "published_via"::"public"."published_via";--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."shipment_status";--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('needs_branch', 'awaiting_hold_decision', 'held', 'pending_confirmation', 'published');--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "status" SET DATA TYPE "public"."shipment_status" USING "status"::"public"."shipment_status";--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "leads_notified_at";