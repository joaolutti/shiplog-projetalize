import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/** Lazily created so importing this module never opens a connection at build time. */
let instance: ReturnType<typeof create> | undefined;

function create() {
  const sql = postgres(env("DATABASE_URL"), { max: 10 });
  return drizzle(sql, { schema });
}

export function db() {
  instance ??= create();
  return instance;
}
