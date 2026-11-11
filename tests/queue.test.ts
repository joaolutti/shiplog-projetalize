/**
 * enqueue(…, tx) against real pg-boss: the job is written through the Drizzle transaction, so
 * it commits or rolls back with it. Skipped without TEST_DATABASE_URL.
 */
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { enqueue } from "@/lib/jobs/queue";
import { JOBS } from "@/worker/jobs";
import { hasDb } from "./helpers/db";

describe.skipIf(!hasDb)("enqueue in a transaction", () => {
  let boss: PgBoss;
  const queued = async (shipmentId: number) =>
    (await boss.findJobs(JOBS.syncRecipientDm, { data: { shipmentId } })).length;

  beforeAll(async () => {
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
    await boss.start();
    await boss.createQueue(JOBS.syncRecipientDm);
  });
  afterAll(() => boss?.stop({ graceful: false }));

  it("commits the job with the transaction", async () => {
    const id = Date.now();
    await db().transaction((tx) => enqueue(JOBS.syncRecipientDm, { shipmentId: id }, {}, tx));
    expect(await queued(id)).toBe(1);
  });

  it("drops the job when the transaction rolls back", async () => {
    const id = Date.now() + 1;
    await expect(
      db().transaction(async (tx) => {
        await enqueue(JOBS.syncRecipientDm, { shipmentId: id }, {}, tx);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await queued(id)).toBe(0);
  });
});
