// Applies pending migrations on start (scripts/start.sh) with the app's own driver, postgres.js:
// drizzle-kit exits 1 without saying why when it can't connect, which hides the cause in production logs.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "@/lib/db/client";

try {
  await migrate(db(), { migrationsFolder: "drizzle" });
  console.log("[migrate] migrations applied");
  process.exit(0);
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exit(1);
}
