import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { pgUrl } from "./src/lib/db/pg-url";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: pgUrl(process.env.DATABASE_URL!) },
});
