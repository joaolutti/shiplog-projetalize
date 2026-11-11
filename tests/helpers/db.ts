// Real-Postgres helpers for database tests. Use `describe.skipIf(!hasDb)`.
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/lib/db/client";

export const hasDb = Boolean(process.env.TEST_DATABASE_URL);

let migrated = false;

// Migrates once per file, then empties every app table.
export async function resetDb(): Promise<void> {
  if (!migrated) {
    await migrate(db(), { migrationsFolder: "drizzle" });
    migrated = true;
  }
  await db().execute(sql`
    truncate table
      llm_audit_log, weight_reviews, verifications, comments, shipment_merge_requests,
      shipments, tickets, gitlab_events, account, session, verification, "user"
    restart identity cascade
  `);
}
