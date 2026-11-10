/** storeAndEnqueue against a real database (skipped without TEST_DATABASE_URL). */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { gitlabEvents } from "@/lib/db/schema";
import { storeAndEnqueue } from "@/lib/gitlab/webhook";
import { hasDb, resetDb } from "./helpers/db";
import issueDone from "./fixtures/webhooks/issue-done.json";

const enqueue = vi.fn();
vi.mock("@/lib/jobs/queue", () => ({ enqueue: (...args: unknown[]) => enqueue(...args) }));

describe.skipIf(!hasDb)("storeAndEnqueue", () => {
  beforeEach(async () => {
    await resetDb();
    enqueue.mockReset();
  });

  const event = { eventUuid: "uuid-1", eventType: "Issue Hook" as const, payload: issueDone };

  it("stores the event and enqueues ingest", async () => {
    const result = await storeAndEnqueue(event);
    expect(result).toEqual({ duplicate: false, eventId: 1 });
    const rows = await db().select().from(gitlabEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual(issueDone);
    expect(enqueue).toHaveBeenCalledWith("ingest-gitlab-event", { eventId: 1 });
  });

  it("ignores duplicate deliveries with the same X-Gitlab-Event-UUID", async () => {
    await storeAndEnqueue(event);
    await db().update(gitlabEvents).set({ processedAt: new Date() }).where(eq(gitlabEvents.id, 1));
    enqueue.mockReset();

    expect(await storeAndEnqueue(event)).toEqual({ duplicate: true, eventId: 1 });
    expect(await db().select().from(gitlabEvents)).toHaveLength(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueues a redelivered event that was never processed", async () => {
    enqueue.mockRejectedValueOnce(new Error("queue down"));
    await expect(storeAndEnqueue(event)).rejects.toThrow("queue down");

    expect(await storeAndEnqueue(event)).toEqual({ duplicate: true, eventId: 1 });
    expect(enqueue).toHaveBeenLastCalledWith("ingest-gitlab-event", { eventId: 1 });
  });
});
