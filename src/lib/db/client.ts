import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Lazily created so importing this module never opens a connection at build time.
let instance: ReturnType<typeof create> | undefined;

function create() {
  // 5 + the job queue's 2 + the worker's 3 stay under Supabase's 15 pooled clients (D56); idle ones close.
  const sql = postgres(env("DATABASE_URL"), { max: 5, idle_timeout: 20 });
  return drizzle(sql, { schema });
}

export function db() {
  instance ??= create();
  return instance;
}
