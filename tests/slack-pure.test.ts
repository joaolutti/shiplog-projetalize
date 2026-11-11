/** M3 pure pieces: request signing, DM allowlist, requester matching, Block Kit snapshots. */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACTIONS, editNotesModal, feedCard, leadsUnclaimedDm, recipientDm, reminderReply, requesterDm } from "@/lib/slack/blocks";
import { dmTarget } from "@/lib/slack/client";
import { matchRequester, normalizeName, type DirectoryUser } from "@/lib/slack/directory";
import { FIXTURES } from "@/lib/slack/fixtures";
import { verifySlackSignature } from "@/lib/slack/verify";

describe("verifySlackSignature", () => {
  const secret = "signing-secret";
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const body = "payload=%7B%7D";
  const sign = (t: string, b: string) => `v0=${createHmac("sha256", secret).update(`v0:${t}:${b}`).digest("hex")}`;

  it("accepts a correctly signed, recent request", () => {
    expect(verifySlackSignature({ rawBody: body, timestamp: ts, signature: sign(ts, body), secret, now })).toBe(true);
  });

  it("rejects a tampered body, a wrong signature or missing headers", () => {
    expect(verifySlackSignature({ rawBody: body + "x", timestamp: ts, signature: sign(ts, body), secret, now })).toBe(false);
    expect(verifySlackSignature({ rawBody: body, timestamp: ts, signature: "v0=abc", secret, now })).toBe(false);
    expect(verifySlackSignature({ rawBody: body, timestamp: null, signature: sign(ts, body), secret, now })).toBe(false);
  });

  it("rejects requests older than 5 minutes (replays)", () => {
    const old = String(now / 1000 - 301);
    expect(verifySlackSignature({ rawBody: body, timestamp: old, signature: sign(old, body), secret, now })).toBe(false);
  });
});

describe("dmTarget (development allowlist)", () => {
  it("sends to anyone when no allowlist is set", () => {
    expect(dmTarget("U2", undefined)).toEqual({ userId: "U2", redirectedFrom: null });
    expect(dmTarget("U2", "")).toEqual({ userId: "U2", redirectedFrom: null });
  });

  it("redirects DMs for people outside the allowlist to its first entry", () => {
    expect(dmTarget("U1", "U1, U9")).toEqual({ userId: "U1", redirectedFrom: null });
    expect(dmTarget("U2", "U1, U9")).toEqual({ userId: "U1", redirectedFrom: "U2" });
  });
});

describe("matchRequester", () => {
  const users: DirectoryUser[] = [
    { id: "U1", name: "ana.ribeiro", realName: "Ana Ribeiro", displayName: "Ana" },
    { id: "U2", name: "joao.evora", realName: "João Évora", displayName: "" },
    { id: "U3", name: "ana.souza", realName: "Ana Souza", displayName: "Ana" },
  ];

  it("ignores case and accents", () => {
    expect(normalizeName("  JOÃO   Évora ")).toBe("joao evora");
    expect(matchRequester({ kind: "name", value: "joao evora" }, users)).toEqual({ kind: "found", slackUserId: "U2" });
  });

  it("matches a @handle against the username only", () => {
    expect(matchRequester({ kind: "handle", value: "ana.ribeiro" }, users)).toEqual({ kind: "found", slackUserId: "U1" });
    expect(matchRequester({ kind: "handle", value: "Ana Ribeiro" }, users)).toEqual({ kind: "not_found" });
  });

  it("needs exactly one match", () => {
    expect(matchRequester({ kind: "name", value: "Ana" }, users)).toEqual({ kind: "ambiguous", candidates: ["U1", "U3"] });
    expect(matchRequester({ kind: "name", value: "Pedro" }, users)).toEqual({ kind: "not_found" });
  });
});

describe("Block Kit messages", () => {
  const opts = { branchChoices: ["Main", "Staging"], autoPublishHours: 24 };

  it("draft DM: confirm, edit and comment buttons, and the auto-publish notice", () => {
    const msg = recipientDm(FIXTURES.draft, opts);
    const ids = JSON.stringify(msg.blocks);
    for (const id of [ACTIONS.confirmPublish, ACTIONS.editNotes, ACTIONS.addComment]) expect(ids).toContain(id);
    expect(ids).toContain("publico em 24 h");
  });

  it("asks for the requester only when the name wasn't found", () => {
    expect(JSON.stringify(recipientDm(FIXTURES.draftUnresolvedRequester, opts).blocks)).toContain(ACTIONS.pickRequester);
    expect(JSON.stringify(recipientDm(FIXTURES.draft, opts).blocks)).not.toContain(ACTIONS.pickRequester);
  });

  it("the draft offers the mention picker, pre-filled; the card and published DM tag them", () => {
    expect(JSON.stringify(recipientDm(FIXTURES.draft, opts).blocks)).toContain(ACTIONS.pickMentions);
    expect(JSON.stringify(recipientDm(FIXTURES.draftWithMentions, opts).blocks)).toContain('"initial_users":["U0QA","U0PM"]');
    expect(JSON.stringify(feedCard(FIXTURES.published).blocks)).toContain("cc <@U0QA>");
    expect(JSON.stringify(feedCard(FIXTURES.publishedAuto).blocks)).not.toContain("cc ");
  });

  it("keeps every section under Slack's 3000-character limit and the edit modal under its max_length", () => {
    const v = { ...FIXTURES.published, notes: "&&<>\n".repeat(2000) };
    for (const msg of [recipientDm(v, opts), feedCard(v), requesterDm(v, null)]) {
      for (const block of msg.blocks) {
        if (block.type === "section" && block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
      }
    }
    const input = editNotesModal(v).blocks[0] as { element: { initial_value?: string; max_length: number } };
    expect(input.element.initial_value!.length).toBeLessThanOrEqual(input.element.max_length);
  });

  it("escapes mrkdwn in issue titles and notes", () => {
    const v = { ...FIXTURES.draft, ticket: { ...FIXTURES.draft.ticket, title: "<b>&" }, notes: "a < b" };
    const text = JSON.stringify(recipientDm(v, opts).blocks);
    expect(text).toContain("&lt;b&gt;&amp;");
    expect(text).toContain("a &lt; b");
  });

  it("matches the snapshots", () => {
    expect({
      draft: recipientDm(FIXTURES.draft, opts),
      draftUnresolvedRequester: recipientDm(FIXTURES.draftUnresolvedRequester, opts),
      draftWeightMismatch: recipientDm(FIXTURES.draftWeightMismatch, opts),
      needsBranch: recipientDm(FIXTURES.needsBranch, opts),
      openMrs: recipientDm(FIXTURES.openMrs, opts),
      held: recipientDm(FIXTURES.held, opts),
      published: recipientDm(FIXTURES.published, opts),
      reminder: reminderReply(FIXTURES.draft, 20),
      leadsUnclaimed: leadsUnclaimedDm(FIXTURES.unclaimed, "https://shiplog.example.com/unclaimed"),
      feedCard: feedCard(FIXTURES.published),
      feedCardAuto: feedCard(FIXTURES.publishedAuto),
      requester: requesterDm(FIXTURES.published, null),
      requesterVerified: requesterDm(FIXTURES.published, "verified"),
      requesterReported: requesterDm(FIXTURES.published, "issue_reported"),
    }).toMatchSnapshot();
  });
});
