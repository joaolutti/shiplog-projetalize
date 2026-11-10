/**
 * pg-boss producer for the web process: it only sends jobs. Supervision and cron run in
 * the worker (src/worker/index.ts), which also creates the queues.
 */
import { PgBoss, type SendOptions } from "pg-boss";
import { env } from "@/lib/env";
import type { JobName } from "@/worker/jobs";

// Kept on globalThis so `next dev` hot reloads reuse one connection pool.
const g = globalThis as typeof globalThis & { __shiplogBoss?: Promise<PgBoss> };

function boss(): Promise<PgBoss> {
  g.__shiplogBoss ??= (async () => {
    const instance = new PgBoss({
      connectionString: env("DATABASE_URL"),
      supervise: false,
      schedule: false,
    });
    instance.on("error", (err) => console.error("[queue] pg-boss error", err));
    await instance.start();
    return instance;
  })().catch((err) => {
    g.__shiplogBoss = undefined;
    throw err;
  });
  return g.__shiplogBoss;
}

export async function enqueue(name: JobName, data: object, options: SendOptions = {}): Promise<void> {
  await (await boss()).send(name, data, options);
}
