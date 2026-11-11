// POST /api/webhooks/gitlab: verify, filter, store + enqueue (storage mocked here).
import { beforeEach, describe, expect, it, vi } from "vitest";
import issueDone from "./fixtures/webhooks/issue-done.json";

const storeAndEnqueue = vi.fn();
vi.mock("@/lib/gitlab/webhook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gitlab/webhook")>()),
  storeAndEnqueue: (...args: unknown[]) => storeAndEnqueue(...args),
}));

const { POST } = await import("@/app/api/webhooks/gitlab/route");

function hook(headers: Record<string, string>, body: string = JSON.stringify(issueDone)) {
  return new Request("http://localhost/api/webhooks/gitlab", {
    method: "POST",
    headers: {
      "x-gitlab-token": "test-webhook-secret",
      "x-gitlab-event": "Issue Hook",
      "x-gitlab-event-uuid": "uuid-1",
      ...headers,
    },
    body,
  });
}

beforeEach(() => {
  storeAndEnqueue.mockReset().mockResolvedValue({ duplicate: false, eventId: 1 });
});

describe("POST /api/webhooks/gitlab", () => {
  it("rejects a wrong or missing token", async () => {
    expect((await POST(hook({ "x-gitlab-token": "nope" }))).status).toBe(401);
    const noToken = hook({});
    noToken.headers.delete("x-gitlab-token");
    expect((await POST(noToken)).status).toBe(401);
    expect(storeAndEnqueue).not.toHaveBeenCalled();
  });

  it("stores and enqueues an Issue Hook", async () => {
    const res = await POST(hook({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(storeAndEnqueue).toHaveBeenCalledWith({
      eventUuid: "uuid-1",
      eventType: "Issue Hook",
      payload: issueDone,
    });
  });

  it("maps Confidential Issue Hook to Issue Hook", async () => {
    await POST(hook({ "x-gitlab-event": "Confidential Issue Hook" }));
    expect(storeAndEnqueue.mock.calls[0][0].eventType).toBe("Issue Hook");
  });

  it("acknowledges and drops other hook types", async () => {
    const res = await POST(hook({ "x-gitlab-event": "Note Hook" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(storeAndEnqueue).not.toHaveBeenCalled();
  });

  it("rejects a missing event UUID or invalid JSON", async () => {
    const noUuid = hook({});
    noUuid.headers.delete("x-gitlab-event-uuid");
    expect((await POST(noUuid)).status).toBe(400);
    expect((await POST(hook({}, "{not json"))).status).toBe(400);
  });

  it("returns 500 when storing fails, so GitLab retries", async () => {
    storeAndEnqueue.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(hook({}))).status).toBe(500);
  });
});
