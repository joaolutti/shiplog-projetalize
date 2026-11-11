/**
 * Ingest against a real database with the GitLab client mocked (SCOPE.md §4,
 * docs/ARCHITECTURE.md §4). Skipped without TEST_DATABASE_URL.
 */
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { account, gitlabEvents, shipmentMergeRequests, shipments, tickets, user, verifications } from "@/lib/db/schema";
import type { GitlabIssue, RelatedMergeRequest } from "@/lib/gitlab/client";
import { ingestGitlabEvent } from "@/lib/shipments/ingest";
import { hasDb, resetDb } from "./helpers/db";

// ── GitLab mock ──────────────────────────────────────────────────────

const gitlab = vi.hoisted(() => ({
  issue: null as unknown as GitlabIssue,
  mrs: [] as RelatedMergeRequest[],
  calls: 0,
}));

vi.mock("@/lib/gitlab/client", () => ({
  getIssue: async () => {
    gitlab.calls++;
    return gitlab.issue;
  },
  getRelatedMergeRequests: async () => {
    gitlab.calls++;
    return gitlab.mrs;
  },
  getMergeRequestStats: async () => ({
    filesChanged: 3,
    additions: 40,
    deletions: 5,
    firstCommitAt: "2026-11-01T12:00:00.000Z",
  }),
}));

const ISSUE_ID = 90412;
const DEV = 11;
const PM = 31;

function issue(labels: string[], overrides: Partial<GitlabIssue> = {}): GitlabIssue {
  return {
    id: ISSUE_ID,
    iid: 412,
    projectId: 777,
    title: "Corrigir login com SSO",
    description: "Solicitante: Ana Ribeiro\n\nhttps://app.hubspot.com/contacts/1/ticket/2",
    webUrl: "https://gitlab.com/acme/billing-svc/-/issues/412",
    labels,
    weight: 3,
    assigneeIds: [DEV],
    state: "opened",
    ...overrides,
  };
}

function mr(id: number, state: RelatedMergeRequest["state"], description = "## Notas de entrega\nCorrige o SSO."): RelatedMergeRequest {
  return {
    id,
    iid: id - 5000,
    projectId: 777,
    projectPath: "acme/billing-svc",
    title: `MR ${id}`,
    description,
    webUrl: `https://gitlab.com/acme/billing-svc/-/merge_requests/${id - 5000}`,
    state,
    authorId: DEV,
    targetBranch: "staging",
    mergedAt: state === "merged" ? "2026-11-09T10:00:00.000Z" : null,
  };
}

// ── Events ───────────────────────────────────────────────────────────

let uuid = 0;

async function deliver(eventType: string, payload: unknown) {
  const [row] = await db()
    .insert(gitlabEvents)
    .values({ eventUuid: `uuid-${++uuid}`, eventType, payload })
    .returning({ id: gitlabEvents.id });
  return ingestGitlabEvent(row.id);
}

/** Issue Hook where the labels changed from `previous` to `current`. Also updates the mock issue. */
function labelsChanged(previous: string[], current: string[], opts: { action?: string; userId?: number } = {}) {
  gitlab.issue = issue(current, gitlab.issue ? { assigneeIds: gitlab.issue.assigneeIds } : {});
  const asLabels = (titles: string[]) => titles.map((title, i) => ({ id: i + 1, title }));
  return deliver("Issue Hook", {
    object_kind: "issue",
    user: { id: opts.userId ?? PM },
    project: { id: 777, path_with_namespace: "acme/billing-svc" },
    object_attributes: { id: ISSUE_ID, iid: 412, project_id: 777, action: opts.action ?? "update" },
    labels: asLabels(current),
    changes: { labels: { previous: asLabels(previous), current: asLabels(current) } },
  });
}

function mergeRequestEvent(id: number, state: string) {
  return deliver("Merge Request Hook", {
    object_kind: "merge_request",
    object_attributes: {
      id,
      iid: id - 5000,
      target_project_id: 777,
      title: `MR ${id}`,
      state,
      action: state === "merged" ? "merge" : "update",
      target_branch: "staging",
    },
  });
}

async function linkDev(gitlabId = DEV) {
  await db().insert(user).values({ id: `u${gitlabId}`, email: `dev${gitlabId}@example.com`, name: "Dev", role: "dev" });
  await db().insert(account).values({ id: `a${gitlabId}`, accountId: String(gitlabId), providerId: "gitlab", userId: `u${gitlabId}` });
}

const allShipments = () => db().select().from(shipments).orderBy(asc(shipments.id));

const DONE = "Development: Done";

beforeEach(async () => {
  if (!hasDb) return;
  await resetDb();
  gitlab.issue = issue([]);
  gitlab.mrs = [mr(5045, "merged")];
  gitlab.calls = 0;
});

// ── Specs ────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)("ingest: Done added", () => {
  it("creates one shipment per (ticket, branch) and caches the ticket", async () => {
    await linkDev();
    const steps = await labelsChanged(["Branch: Staging", "Weight: 3"], ["Branch: Staging", "Weight: 3", DONE]);

    const [s] = await allShipments();
    expect(s).toMatchObject({
      branch: "Staging",
      status: "pending_confirmation",
      recipientUserId: "u11",
      recipientGitlabId: DEV,
      notesDraft: "Corrige o SSO.",
    });
    expect(steps).toEqual([{ kind: "send_draft", shipmentId: s.id, weightMismatch: null }]);

    const [t] = await db().select().from(tickets);
    expect(t).toMatchObject({
      gitlabIssueId: ISSUE_ID,
      projectPath: "acme/billing-svc",
      nativeWeight: 3,
      labelWeight: 3,
      requesterRaw: "Ana Ribeiro",
      requesterSource: "none",
      hubspotUrls: ["https://app.hubspot.com/contacts/1/ticket/2"],
    });

    const [m] = await db().select().from(shipmentMergeRequests);
    expect(m).toMatchObject({ gitlabMrId: 5045, state: "merged", filesChanged: 3, additions: 40, deletions: 5 });
  });

  it("creates a shipment for each Branch label", async () => {
    await linkDev();
    await labelsChanged(["Branch: Staging", "Branch: Main"], ["Branch: Staging", "Branch: Main", DONE]);
    expect((await allShipments()).map((s) => s.branch)).toEqual(["Staging", "Main"]);
  });

  it("nudges when Done is applied without a Branch label", async () => {
    await linkDev();
    const steps = await labelsChanged([], [DONE]);
    const [s] = await allShipments();
    expect(s).toMatchObject({ branch: null, status: "needs_branch" });
    expect(steps).toEqual([{ kind: "nudge_missing_branch", shipmentId: s.id }]);
  });

  it("is unclaimed when no candidate has linked GitLab, keeping who it was meant for", async () => {
    const steps = await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    const [s] = await allShipments();
    expect(s).toMatchObject({ status: "unclaimed", recipientUserId: null, recipientGitlabId: DEV });
    expect(steps).toEqual([{ kind: "unclaimed", shipmentId: s.id }]);
  });

  it("falls back to the user who applied the label when they're the only linked candidate", async () => {
    await linkDev(PM);
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    expect((await allShipments())[0]).toMatchObject({ status: "pending_confirmation", recipientUserId: "u31" });
  });

  it("nudges when related MRs are still open; a closed MR doesn't block", async () => {
    await linkDev();
    gitlab.mrs = [mr(5045, "merged"), mr(5046, "opened"), mr(5047, "closed")];
    const steps = await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    const [s] = await allShipments();
    expect(s.status).toBe("awaiting_hold_decision");
    expect(steps).toEqual([{ kind: "nudge_open_mrs", shipmentId: s.id, openMrIds: [5046] }]);
  });

  it("flags native weight vs 'Weight: X' label mismatch (native wins)", async () => {
    await linkDev();
    const asLabels = ["Branch: Main", "Weight: 3", DONE];
    gitlab.issue = issue(asLabels, { weight: 5 });
    const steps = await deliver("Issue Hook", {
      user: { id: PM },
      project: { id: 777, path_with_namespace: "acme/billing-svc" },
      object_attributes: { id: ISSUE_ID, iid: 412, project_id: 777, action: "update" },
      labels: asLabels.map((title) => ({ title })),
      changes: {
        labels: {
          previous: ["Branch: Main", "Weight: 3"].map((title) => ({ title })),
          current: asLabels.map((title) => ({ title })),
        },
      },
    });
    expect(steps[0]).toMatchObject({ kind: "send_draft", weightMismatch: { native: 5, label: 3 } });
  });

  it("uses the MR title when an MR has no delivery notes, and the issue title with no MRs", async () => {
    await linkDev();
    gitlab.mrs = [mr(5045, "merged", "Sem template")];
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    expect((await allShipments())[0].notesDraft).toBe("MR 5045");

    await resetDb();
    await linkDev();
    gitlab.mrs = [];
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    expect((await allShipments())[0].notesDraft).toBe("Corrigir login com SSO");
  });
});

describe.skipIf(!hasDb)("ingest: later label changes", () => {
  beforeEach(async () => {
    await linkDev();
  });

  it("branch promotion: Branch: Main on a ticket already shipped to Staging adds a shipment", async () => {
    await labelsChanged(["Branch: Staging"], ["Branch: Staging", DONE]);
    const steps = await labelsChanged(["Branch: Staging", DONE], ["Branch: Staging", DONE, "Branch: Main"]);
    const rows = await allShipments();
    expect(rows.map((s) => s.branch)).toEqual(["Staging", "Main"]);
    expect(steps).toEqual([{ kind: "send_draft", shipmentId: rows[1].id, weightMismatch: null }]);
  });

  it("a Branch label answers the branch gate of a needs_branch shipment (same row)", async () => {
    await labelsChanged([], [DONE]);
    const [before] = await allShipments();
    await labelsChanged([DONE], [DONE, "Branch: Main"]);
    const rows = await allShipments();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before.id, branch: "Main", status: "pending_confirmation" });
    expect(rows[0].timeline.map((e) => e.event)).toEqual(["created", "pick_branch"]);
  });

  it("re-adding labels never duplicates", async () => {
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    // Branch label removed and re-added while Done stays.
    await labelsChanged(["Branch: Main", DONE], [DONE]);
    const steps = await labelsChanged([DONE], [DONE, "Branch: Main"]);
    expect(await allShipments()).toHaveLength(1);
    expect(steps[0].kind).toBe("noop");
  });

  it("Done added again while the shipment is still in progress changes nothing", async () => {
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    await labelsChanged(["Branch: Main", DONE], ["Branch: Main"]);
    const steps = await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    expect(steps[0]).toMatchObject({ kind: "noop" });
    expect((await allShipments())[0].status).toBe("pending_confirmation");
  });

  it("re-ship: Done again on a published branch reuses the row with a new draft cycle", async () => {
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    const [s] = await allShipments();
    await db()
      .update(shipments)
      .set({ status: "published", publishedVia: "confirmed", publishedAt: new Date(), notesFinal: "v1", verificationStatus: "verified" })
      .where(eq(shipments.id, s.id));
    await db().insert(verifications).values({ shipmentId: s.id, userId: "u11", kind: "verified" });

    await labelsChanged(["Branch: Main", DONE], ["Branch: Main"], { action: "reopen" });
    const steps = await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);

    const rows = await allShipments();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: s.id,
      status: "pending_confirmation",
      publishedAt: null,
      publishedVia: null,
      notesFinal: null,
      verificationStatus: "unverified",
    });
    expect(steps).toEqual([{ kind: "send_draft", shipmentId: s.id, weightMismatch: null }]);
    expect(await db().select().from(verifications)).toHaveLength(0);

    const reshipEntry = rows[0].timeline.find((e) => e.event === "reship");
    expect(reshipEntry?.data).toMatchObject({
      from: "published",
      to: "pending_confirmation",
      previous: { notesFinal: "v1", publishedVia: "confirmed", verifications: [{ userId: "u11", kind: "verified" }] },
    });
    expect(rows[0].timeline.some((e) => e.event === "issue_reopened")).toBe(true);
  });

  it("ignores edits of issues Shiplog doesn't know, without calling GitLab", async () => {
    const steps = await labelsChanged(["Bug"], ["Bug", "Frontend"]);
    expect(steps).toEqual([{ kind: "noop", reason: `issue ${ISSUE_ID}: not triggered and no new branch` }]);
    expect(gitlab.calls).toBe(0);
    expect(await db().select().from(tickets)).toHaveLength(0);
  });

  it("refreshes a known ticket on unrelated edits", async () => {
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    gitlab.issue = { ...issue(["Branch: Main", DONE]), title: "Novo título" };
    await deliver("Issue Hook", {
      user: { id: PM },
      project: { id: 777, path_with_namespace: "acme/billing-svc" },
      object_attributes: { id: ISSUE_ID, iid: 412, project_id: 777, action: "update" },
      labels: [{ title: "Branch: Main" }, { title: DONE }],
      changes: {},
    });
    expect((await db().select().from(tickets))[0].title).toBe("Novo título");
  });
});

describe.skipIf(!hasDb)("ingest: Merge Request Hook", () => {
  beforeEach(async () => {
    await linkDev();
  });

  async function heldShipment() {
    gitlab.mrs = [mr(5045, "opened"), mr(5046, "opened")];
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    const [s] = await allShipments();
    await db().update(shipments).set({ status: "held" }).where(eq(shipments.id, s.id));
    return s;
  }

  it("held shipments release when the last related MR merges", async () => {
    const s = await heldShipment();

    const first = await mergeRequestEvent(5045, "merged");
    expect(first[0]).toMatchObject({ kind: "noop" });
    expect((await allShipments())[0].status).toBe("held");

    const second = await mergeRequestEvent(5046, "closed");
    expect(second).toEqual([{ kind: "send_draft", shipmentId: s.id, weightMismatch: null }]);
    expect((await allShipments())[0].status).toBe("pending_confirmation");

    const mrs = await db().select().from(shipmentMergeRequests).orderBy(asc(shipmentMergeRequests.gitlabMrId));
    expect(mrs.map((m) => [m.state, m.mergedAt !== null])).toEqual([
      ["merged", true],
      ["closed", false],
    ]);
  });

  it("an unanswered hold question is released too once nothing is open", async () => {
    gitlab.mrs = [mr(5045, "opened")];
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    expect((await allShipments())[0].status).toBe("awaiting_hold_decision");
    await mergeRequestEvent(5045, "merged");
    expect((await allShipments())[0].status).toBe("pending_confirmation");
  });

  it("ignores MRs not linked to a shipment", async () => {
    expect(await mergeRequestEvent(9999, "merged")).toEqual([
      { kind: "noop", reason: "MR 9999 not linked to a shipment" },
    ]);
  });
});

/** Issue Hook where the work item Status moved from `previous` to `current` (labels unchanged). */
function statusChanged(previous: string, current: string, labels: string[] = []) {
  gitlab.issue = issue(labels);
  const status = (name: string) => ({ id: `gid://gitlab/WorkItems::Statuses::Custom::Status/${name}`, name, category: "done" });
  return deliver("Issue Hook", {
    object_kind: "issue",
    user: { id: DEV },
    project: { id: 777, path_with_namespace: "acme/billing-svc" },
    object_attributes: { id: ISSUE_ID, iid: 412, project_id: 777, action: "update", status: status(current) },
    labels: labels.map((title) => ({ title })),
    changes: { status: { previous: status(previous), current: status(current) } },
  });
}

describe.skipIf(!hasDb)("ingest: Status trigger (D44)", () => {
  beforeEach(async () => {
    await linkDev();
  });

  it("Deployed Staging ships to Staging without a Branch label and caches the status", async () => {
    const steps = await statusChanged("In progress", "Deployed Staging");
    const [s] = await allShipments();
    expect(s).toMatchObject({ branch: "Staging", status: "pending_confirmation", recipientUserId: "u11" });
    expect(steps).toEqual([{ kind: "send_draft", shipmentId: s.id, weightMismatch: null }]);
    expect((await db().select().from(tickets))[0].gitlabStatus).toBe("Deployed Staging");
  });

  it("Done uses the Branch labels, and asks for one when there is none", async () => {
    await statusChanged("In progress", "Done", ["Branch: Main"]);
    expect((await allShipments()).map((s) => [s.branch, s.status])).toEqual([["Main", "pending_confirmation"]]);

    await resetDb();
    await linkDev();
    await statusChanged("In progress", "Done");
    expect((await allShipments())[0]).toMatchObject({ branch: null, status: "needs_branch" });
  });

  it("Deployed Staging → Deployed Main adds a Main shipment (branch promotion)", async () => {
    await statusChanged("In progress", "Deployed Staging");
    await statusChanged("Deployed Staging", "Deployed Main");
    expect((await allShipments()).map((s) => s.branch)).toEqual(["Staging", "Main"]);
  });

  it("ignores statuses that aren't triggers", async () => {
    const steps = await statusChanged("In progress", "Development Done");
    expect(steps[0].kind).toBe("noop");
    expect(await allShipments()).toHaveLength(0);
  });

  it("a status trigger on an issue already Done by label doesn't ship twice", async () => {
    await labelsChanged(["Branch: Main"], ["Branch: Main", DONE]);
    const steps = await statusChanged("In progress", "Done", ["Branch: Main", DONE]);
    expect(steps[0].kind).toBe("noop");
    expect(await allShipments()).toHaveLength(1);
  });

  it("moving back to Deployed Main after leaving it re-ships the published row", async () => {
    await statusChanged("In progress", "Deployed Main");
    const [s] = await allShipments();
    await db().update(shipments).set({ status: "published", publishedVia: "confirmed", publishedAt: new Date() }).where(eq(shipments.id, s.id));

    await statusChanged("Deployed Main", "In progress");
    const steps = await statusChanged("In progress", "Deployed Main");
    expect(steps).toEqual([{ kind: "send_draft", shipmentId: s.id, weightMismatch: null }]);
    expect(await allShipments()).toHaveLength(1);
  });
});

describe("timers", () => {
  it.todo("sends one reminder after REMINDER_AFTER_HOURS (M3)");
  it.todo("auto-publishes after AUTO_PUBLISH_AFTER_HOURS with published_via = auto (M3)");
});
