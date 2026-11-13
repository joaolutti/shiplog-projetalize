/**
 * Slack interactions → commands (docs/ARCHITECTURE.md §2, §6). The route verifies the signature,
 * opens modals inline (they need the trigger_id within 3 s) and queues everything else, which
 * runs here in the worker.
 */
import { z } from "zod";
import {
  addComment,
  CommandError,
  confirm,
  editNotes,
  holdUntilMerged,
  pickBranch,
  pickRequester,
  publishAnyway,
  reportIssue,
  setMentions,
  verify,
  type Actor,
} from "@/lib/shipments/commands";
import { execute } from "@/lib/shipments/effects";
import type { NextStep } from "@/lib/shipments/next-step";
import { ensureSlackUser, loadShipment, usersBySlackId } from "@/lib/shipments/view";
import type { ModalView } from "@slack/types";
import {
  ACTIONS,
  commentModal,
  editNotesModal,
  FIELDS,
  MENTIONS_BLOCK,
  MODALS,
  REQUESTER_BLOCK,
  reportIssueModal,
} from "./blocks";

const action = z.object({
  action_id: z.string(),
  block_id: z.string().optional(),
  value: z.string().optional(),
  selected_user: z.string().optional(),
  selected_users: z.array(z.string()).optional(),
});

const blockActions = z.object({
  type: z.literal("block_actions"),
  user: z.object({ id: z.string() }),
  trigger_id: z.string().optional(),
  response_url: z.string().optional(),
  actions: z.array(action).min(1),
});

const viewSubmission = z.object({
  type: z.literal("view_submission"),
  user: z.object({ id: z.string() }),
  view: z.object({
    callback_id: z.string(),
    private_metadata: z.string(),
    state: z.object({ values: z.record(z.string(), z.record(z.string(), z.object({ value: z.string().nullish() }))) }),
  }),
});

export const interactionPayload = z.discriminatedUnion("type", [blockActions, viewSubmission]);
export type InteractionPayload = z.infer<typeof interactionPayload>;

// Slack posts `payload=<json>` form-encoded. Unknown interaction types return null.
export function parseInteraction(rawBody: string): InteractionPayload | null {
  const json = new URLSearchParams(rawBody).get("payload");
  if (!json) return null;
  const parsed = interactionPayload.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

// Buttons that open a modal, which must happen inline in the route.
export async function modalFor(payload: InteractionPayload): Promise<ModalView | null> {
  if (payload.type !== "block_actions") return null;
  const a = payload.actions[0];
  const shipmentId = Number(a.value);
  switch (a.action_id) {
    case ACTIONS.editNotes: {
      const s = await loadShipment(shipmentId);
      return s ? editNotesModal({ id: shipmentId, notes: s.view.notes }) : null;
    }
    case ACTIONS.addComment:
      return commentModal(shipmentId);
    case ACTIONS.reportIssue:
      return reportIssueModal(shipmentId);
    default:
      return null;
  }
}

// Links and modal-opening buttons need no work after the route acknowledges them.
export function needsWork(payload: InteractionPayload): boolean {
  if (payload.type === "view_submission") return true;
  const id = payload.actions[0].action_id;
  return ![ACTIONS.openLink, ACTIONS.editNotes, ACTIONS.addComment, ACTIONS.reportIssue].includes(id as never);
}

// Runs the command behind an interaction (in the worker), with its follow-ups.
export async function handleInteraction(payload: InteractionPayload): Promise<NextStep | null> {
  try {
    return await runCommand(payload);
  } catch (err) {
    if (err instanceof CommandError && payload.type === "block_actions") {
      await respondEphemeral(payload.response_url, messageFor(err));
      return null;
    }
    throw err;
  }
}

async function runCommand(payload: InteractionPayload): Promise<NextStep | null> {
  const slackUserId = payload.user.id;

  if (payload.type === "view_submission") {
    const shipmentId = Number(payload.view.private_metadata);
    const text = payload.view.state.values[FIELDS.text]?.[FIELDS.text]?.value ?? "";
    switch (payload.view.callback_id) {
      case MODALS.editNotes: {
        const actor = await teamActor(slackUserId);
        return execute((tx) => editNotes(tx, { actor, shipmentId, notes: text }));
      }
      case MODALS.addComment: {
        const actor = await anyoneActor(slackUserId);
        return execute(async (tx) => (await addComment(tx, { actor, shipmentId, body: text, source: "slack_dm" })).step);
      }
      case MODALS.reportIssue: {
        const actor = await anyoneActor(slackUserId);
        return execute((tx) => reportIssue(tx, { actor, shipmentId, comment: text, source: "slack_dm" }));
      }
      default:
        return null;
    }
  }

  const a = payload.actions[0];
  switch (a.action_id) {
    case ACTIONS.confirmPublish: {
      const actor = await teamActor(slackUserId);
      return execute((tx) => confirm(tx, { actor, shipmentId: Number(a.value) }));
    }
    case ACTIONS.holdUntilMerged: {
      const actor = await teamActor(slackUserId);
      return execute((tx) => holdUntilMerged(tx, { actor, shipmentId: Number(a.value) }));
    }
    case ACTIONS.publishAnyway: {
      const actor = await teamActor(slackUserId);
      return execute((tx) => publishAnyway(tx, { actor, shipmentId: Number(a.value) }));
    }
    case ACTIONS.pickBranch: {
      const actor = await teamActor(slackUserId);
      const { shipmentId, branch } = z.object({ shipmentId: z.number(), branch: z.string() }).parse(JSON.parse(a.value ?? ""));
      return execute((tx) => pickBranch(tx, { actor, shipmentId, branch }));
    }
    case ACTIONS.pickRequester: {
      if (!a.selected_user || !a.block_id?.startsWith(REQUESTER_BLOCK)) return null;
      const actor = await teamActor(slackUserId);
      const shipmentId = Number(a.block_id.slice(REQUESTER_BLOCK.length));
      return execute((tx) => pickRequester(tx, { actor, shipmentId, slackUserId: a.selected_user! }));
    }
    case ACTIONS.pickMentions: {
      if (!a.block_id?.startsWith(MENTIONS_BLOCK)) return null;
      const actor = await teamActor(slackUserId);
      const shipmentId = Number(a.block_id.slice(MENTIONS_BLOCK.length));
      return execute((tx) => setMentions(tx, { actor, shipmentId, slackUserIds: a.selected_users ?? [] }));
    }
    case ACTIONS.verify: {
      const actor = await anyoneActor(slackUserId);
      return execute((tx) => verify(tx, { actor, shipmentId: Number(a.value) }));
    }
    default:
      return null;
  }
}

// Devs and leads: must already have a Shiplog account (signed in with Slack).
async function teamActor(slackUserId: string): Promise<Actor> {
  const found = (await usersBySlackId([slackUserId])).get(slackUserId);
  if (!found) throw new CommandError("forbidden", "sign in to Shiplog first");
  return { kind: "user", userId: found.id, role: found.role };
}

// Anyone in the workspace may verify, report or comment (D12): created on first contact.
export async function anyoneActor(slackUserId: string): Promise<Actor> {
  const found = await ensureSlackUser(slackUserId);
  return { kind: "user", userId: found.id, role: found.role };
}

function messageFor(err: CommandError): string {
  return err.code === "forbidden"
    ? "Você não pode fazer isso nesta entrega. Entre no Shiplog com o Slack, ou peça para um lead."
    : "Essa entrega não existe mais.";
}

async function respondEphemeral(responseUrl: string | undefined, text: string): Promise<void> {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  });
}
