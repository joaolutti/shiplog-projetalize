/**
 * M3 flow against a real database, with Slack and the job queue mocked: dispatch → DMs →
 * buttons → publish → requester verification. Skipped without TEST_DATABASE_URL.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { account, comments, shipments, tickets, user, verifications } from "@/lib/db/schema";
import { dispatch } from "@/lib/shipments/effects";
import { ACTIONS, MENTIONS_BLOCK, MODALS, FIELDS, REQUESTER_BLOCK } from "@/lib/slack/blocks";
import { handleInteraction, type InteractionPayload } from "@/lib/slack/interactions";
import {
  notifyComment,
  notifyLeadsUnclaimed,
  publishShipment,
  runAutoPublish,
  sendReminder,
  syncRecipientDm,
} from "@/worker/handlers/shipment-messages";
import { hasDb, resetDb } from "./helpers/db";

process.env.SLACK_FEED_CHANNEL_ID = "C_FEED";
process.env.APP_URL = "https://shiplog.test";

// ── Mocks ────────────────────────────────────────────────────────────

const queue = vi.hoisted(() => ({ jobs: [] as Array<{ name: string; data: unknown; options?: unknown }> }));
vi.mock("@/lib/jobs/queue", () => ({
  enqueue: async (name: string, data: unknown, options?: unknown) => {
    queue.jobs.push({ name, data, options });
  },
}));

const slackApi = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; to: string; text: string }>,
  ts: 0,
}));
vi.mock("@/lib/slack/client", () => ({
  sendDm: async (to: string, m: { text: string }) => {
    slackApi.sent.push({ kind: "dm", to, text: m.text });
    return { channel: `D_${to}`, ts: String(++slackApi.ts) };
  },
  post: async (channel: string, m: { text: string }) => {
    slackApi.sent.push({ kind: "post", to: channel, text: m.text });
    return { channel, ts: String(++slackApi.ts) };
  },
  update: async (ref: { channel: string; ts: string }, m: { text: string }) => {
    slackApi.sent.push({ kind: "update", to: `${ref.channel}/${ref.ts}`, text: m.text });
  },
  reply: async (ref: { channel: string; ts: string }, m: { text: string }) => {
    slackApi.sent.push({ kind: "reply", to: `${ref.channel}/${ref.ts}`, text: m.text });
  },
  slack: () => ({
    users: { info: async ({ user: id }: { user: string }) => ({ user: { name: id, profile: { real_name: `Pessoa ${id}` } } }) },
  }),
}));

vi.mock("@/lib/slack/directory", () => ({
  resolveRequester: async (ref: { value: string }) =>
    ref.value === "Ana Ribeiro" ? { kind: "found", slackUserId: "U_ANA" } : { kind: "not_found" },
}));

const ephemeral = vi.hoisted(() => ({ texts: [] as string[] }));
vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
  ephemeral.texts.push(JSON.parse(init.body).text);
  return new Response("ok");
});

// ── Fixtures ─────────────────────────────────────────────────────────

async function seed(status: "pending_confirmation" | "unclaimed" | "needs_branch" = "pending_confirmation") {
  await db().insert(user).values([
    { id: "u-dev", name: "Dev", email: "dev@example.com", role: "dev" },
    { id: "u-other", name: "Outro dev", email: "other@example.com", role: "dev" },
    { id: "u-lead", name: "Lead", email: "lead@example.com", role: "lead" },
  ]);
  await db().insert(account).values([
    { id: "a1", userId: "u-dev", providerId: "slack", accountId: "U_DEV" },
    { id: "a2", userId: "u-dev", providerId: "gitlab", accountId: "11" },
    { id: "a3", userId: "u-other", providerId: "slack", accountId: "U_OTHER" },
    { id: "a4", userId: "u-lead", providerId: "slack", accountId: "U_LEAD" },
  ]);
  const [t] = await db()
    .insert(tickets)
    .values({
      gitlabIssueId: 1,
      gitlabProjectId: 7,
      projectPath: "acme/app",
      iid: 412,
      title: "Corrigir login",
      webUrl: "https://gitlab.test/acme/app/-/issues/412",
      gitlabState: "opened",
      requesterRaw: "Ana Ribeiro",
    })
    .returning();
  const [s] = await db()
    .insert(shipments)
    .values({
      ticketId: t.id,
      branch: status === "needs_branch" ? null : "Staging",
      status,
      recipientUserId: status === "unclaimed" ? null : "u-dev",
      recipientGitlabId: 11,
      notesDraft: "Corrige o login.",
      pendingSince: status === "pending_confirmation" ? new Date("2026-11-11T12:00:00Z") : null,
    })
    .returning();
  return s;
}

const click = (slackUserId: string, actionId: string, value: string, extra: object = {}): InteractionPayload => ({
  type: "block_actions",
  user: { id: slackUserId },
  response_url: "https://hooks.slack.test/respond",
  actions: [{ action_id: actionId, value, ...extra }],
});

const submit = (slackUserId: string, callbackId: string, shipmentId: number, text: string): InteractionPayload => ({
  type: "view_submission",
  user: { id: slackUserId },
  view: {
    callback_id: callbackId,
    private_metadata: String(shipmentId),
    state: { values: { [FIELDS.text]: { [FIELDS.text]: { value: text } } } },
  },
});

const shipment = async (id: number) => (await db().select().from(shipments).where(eq(shipments.id, id)))[0];
const jobNames = () => queue.jobs.map((j) => j.name);

beforeEach(async () => {
  if (!hasDb) return;
  await resetDb();
  queue.jobs = [];
  slackApi.sent = [];
  slackApi.ts = 0;
  ephemeral.texts = [];
});

// ── Specs ────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)("draft → confirm → publish → verify", () => {
  it("send_draft syncs the DM and schedules the reminder and auto-publish for this draft cycle", async () => {
    const s = await seed();
    await dispatch([{ kind: "send_draft", shipmentId: s.id, weightMismatch: null }]);
    expect(jobNames()).toEqual(["sync-recipient-dm", "send-reminder", "auto-publish"]);
    const cycle = "2026-11-11T12:00:00.000Z";
    expect(queue.jobs[1]).toMatchObject({
      data: { shipmentId: s.id, cycle },
      options: { startAfter: new Date("2026-11-11T16:00:00Z"), singletonKey: `${s.id}:${cycle}` },
    });
    expect(queue.jobs[2].options).toMatchObject({ startAfter: new Date("2026-11-12T12:00:00Z") });
  });

  it("the recipient DM is posted once, then updated in place; the requester is resolved first", async () => {
    const s = await seed();
    await syncRecipientDm({ shipmentId: s.id });
    await syncRecipientDm({ shipmentId: s.id });
    expect(slackApi.sent.map((m) => m.kind + ":" + m.to)).toEqual(["dm:U_DEV", "update:D_U_DEV/1"]);
    expect((await shipment(s.id)).dmMessageTs).toBe("1");
    expect((await db().select().from(tickets))[0]).toMatchObject({ requesterSlackId: "U_ANA", requesterSource: "template" });
  });

  it("Confirmar e publicar → published with the draft notes, then the card and both DMs", async () => {
    const s = await seed();
    await syncRecipientDm({ shipmentId: s.id });
    queue.jobs = [];

    await handleInteraction(click("U_DEV", ACTIONS.confirmPublish, String(s.id)));
    expect(await shipment(s.id)).toMatchObject({ status: "published", publishedVia: "confirmed", notesFinal: "Corrige o login." });
    expect(jobNames()).toEqual(["publish-shipment"]);

    slackApi.sent = [];
    await publishShipment({ shipmentId: s.id });
    expect(slackApi.sent.map((m) => m.kind + ":" + m.to)).toEqual(["post:C_FEED", "update:D_U_DEV/1", "dm:U_ANA"]);
    expect(await shipment(s.id)).toMatchObject({ feedMessageTs: "2", requesterDmChannelId: "D_U_ANA", requesterDmTs: "3" });

    // Running it again updates instead of posting twice.
    slackApi.sent = [];
    await publishShipment({ shipmentId: s.id });
    expect(slackApi.sent.every((m) => m.kind === "update")).toBe(true);
  });

  it("anyone verifies from Slack, even before signing in; their account is created", async () => {
    const s = await seed();
    await db().update(shipments).set({ status: "published", publishedVia: "confirmed" }).where(eq(shipments.id, s.id));

    await handleInteraction(click("U_ANA", ACTIONS.verify, String(s.id)));
    expect((await shipment(s.id)).verificationStatus).toBe("verified");
    expect(jobNames()).toEqual(["sync-requester-dm"]);
    const [ana] = await db().select().from(account).where(eq(account.accountId, "U_ANA"));
    expect(ana.providerId).toBe("slack");
  });

  it("a report wins over verifications until the reporter changes it back (D41)", async () => {
    const s = await seed();
    await db().update(shipments).set({ status: "published", publishedVia: "confirmed" }).where(eq(shipments.id, s.id));

    await handleInteraction(click("U_OTHER", ACTIONS.verify, String(s.id)));
    await handleInteraction(submit("U_ANA", MODALS.reportIssue, s.id, "Ainda falha no iPhone"));
    expect((await shipment(s.id)).verificationStatus).toBe("issue_reported");
    expect(jobNames()).toContain("notify-issue-reported");
    const [comment] = await db().select().from(comments);
    expect(comment).toMatchObject({ body: "Ainda falha no iPhone", source: "slack_dm", shipmentId: s.id });

    await handleInteraction(click("U_ANA", ACTIONS.verify, String(s.id)));
    expect((await shipment(s.id)).verificationStatus).toBe("verified");
    expect(await db().select().from(verifications)).toHaveLength(2);
  });
});

describe.skipIf(!hasDb)("buttons and modals", () => {
  it("Editar notas replaces the draft; the DM refreshes", async () => {
    const s = await seed();
    await handleInteraction(submit("U_DEV", MODALS.editNotes, s.id, "  Login com SSO voltou a funcionar.  "));
    expect((await shipment(s.id)).notesFinal).toBe("Login com SSO voltou a funcionar.");
    expect(jobNames()).toEqual(["sync-recipient-dm"]);
  });

  it("the dev picks the requester when the name wasn't found", async () => {
    const s = await seed();
    await handleInteraction(
      click("U_DEV", ACTIONS.pickRequester, "", { block_id: `${REQUESTER_BLOCK}${s.id}`, selected_user: "U_PICKED" }),
    );
    expect((await db().select().from(tickets))[0]).toMatchObject({ requesterSlackId: "U_PICKED", requesterSource: "dev_picked" });
  });

  it("Comentar saves to the ticket thread and replies under the draft DM", async () => {
    const s = await seed();
    await syncRecipientDm({ shipmentId: s.id });
    queue.jobs = [];
    slackApi.sent = [];

    await handleInteraction(submit("U_DEV", MODALS.addComment, s.id, "Testado em staging"));
    const [comment] = await db().select().from(comments);
    expect(comment).toMatchObject({ body: "Testado em staging", ticketId: s.ticketId, shipmentId: s.id });
    expect(queue.jobs).toEqual([{ name: "notify-comment", data: { shipmentId: s.id, commentId: comment.id }, options: undefined }]);

    await notifyComment({ shipmentId: s.id, commentId: comment.id });
    expect(slackApi.sent).toEqual([{ kind: "reply", to: "D_U_DEV/1", text: "Comentário de Dev" }]);
  });

  it("Marcar no anúncio stores who to @mention; the card tags them", async () => {
    const s = await seed();
    await handleInteraction(
      click("U_DEV", ACTIONS.pickMentions, "", { block_id: `${MENTIONS_BLOCK}${s.id}`, selected_users: ["U_QA", "U_PM", "U_QA"] }),
    );
    expect((await shipment(s.id)).mentionSlackIds).toEqual(["U_QA", "U_PM"]);
    expect(jobNames()).toEqual(["sync-recipient-dm"]);

    // Clearing the picker removes them.
    await handleInteraction(click("U_DEV", ACTIONS.pickMentions, "", { block_id: `${MENTIONS_BLOCK}${s.id}`, selected_users: [] }));
    expect((await shipment(s.id)).mentionSlackIds).toEqual([]);
  });

  it("a branch button answers the branch gate", async () => {
    const s = await seed("needs_branch");
    await handleInteraction(click("U_DEV", ACTIONS.pickBranch, JSON.stringify({ shipmentId: s.id, branch: "Main" })));
    expect(await shipment(s.id)).toMatchObject({ branch: "Main", status: "pending_confirmation" });
    expect((await shipment(s.id)).pendingSince).toBeInstanceOf(Date);
  });

  it("someone else's draft: refused with an ephemeral message, nothing changes", async () => {
    const s = await seed();
    await handleInteraction(click("U_OTHER", ACTIONS.confirmPublish, String(s.id)));
    await handleInteraction(click("U_STRANGER", ACTIONS.confirmPublish, String(s.id)));
    expect((await shipment(s.id)).status).toBe("pending_confirmation");
    expect(ephemeral.texts).toHaveLength(2);
  });
});

describe.skipIf(!hasDb)("timers and leads", () => {
  const cycle = "2026-11-11T12:00:00.000Z";

  it("one reminder, only for the current draft cycle", async () => {
    const s = await seed();
    await syncRecipientDm({ shipmentId: s.id });
    slackApi.sent = [];
    await sendReminder({ shipmentId: s.id, cycle: "2026-01-01T00:00:00.000Z" });
    await sendReminder({ shipmentId: s.id, cycle });
    await sendReminder({ shipmentId: s.id, cycle });
    expect(slackApi.sent.map((m) => m.kind)).toEqual(["reply"]);
  });

  it("auto-publishes an unanswered draft of the same cycle, flagged auto", async () => {
    const s = await seed();
    await runAutoPublish({ shipmentId: s.id, cycle: "2026-01-01T00:00:00.000Z" });
    expect((await shipment(s.id)).status).toBe("pending_confirmation");
    await runAutoPublish({ shipmentId: s.id, cycle });
    expect(await shipment(s.id)).toMatchObject({ status: "published", publishedVia: "auto", notesFinal: "Corrige o login." });
    expect(jobNames()).toEqual(["publish-shipment"]);
  });

  it("leads are DMed once about an unclaimed shipment", async () => {
    const s = await seed("unclaimed");
    await notifyLeadsUnclaimed({ shipmentId: s.id });
    await notifyLeadsUnclaimed({ shipmentId: s.id });
    expect(slackApi.sent.map((m) => m.to)).toEqual(["U_LEAD"]);
  });
});
