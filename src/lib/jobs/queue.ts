/**
 * pg-boss producer for the web process: it only sends jobs. Supervision and cron run in
 * the worker (src/worker/index.ts), which also creates the queues.
 */
import { PgBoss, type Db, type SendOptions } from "pg-boss";
import type { TransactionSql } from "postgres";
import { env } from "@/lib/env";
import type { Tx } from "@/lib/shipments/commands";
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

/** With `tx`, the job is written in that transaction: it exists only if the transaction commits. */
export async function enqueue(name: JobName, data: object, options: SendOptions = {}, tx?: Tx): Promise<void> {
  await (await boss()).send(name, data, tx ? { ...options, db: inTransaction(tx) } : options);
}

/** pg-boss's db adapter over a Drizzle (postgres-js) transaction. */
function inTransaction(tx: Tx): Db {
  // Drizzle's postgres-js session keeps the transaction's client here.
  const { client } = tx._.session as unknown as { client: TransactionSql };
  return {
    executeSql: async (text, values = []) => ({ rows: [...(await client.unsafe(text, values as never[]))] }),
  };
}
