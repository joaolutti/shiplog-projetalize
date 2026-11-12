// Queue names: shared by producers (route handlers, server actions, dispatch) and the worker.
export const JOBS = {
  ingestGitlabEvent: "ingest-gitlab-event",
  // Post or update the recipient's DM to match the shipment's status.
  syncRecipientDm: "sync-recipient-dm",
  sendReminder: "send-reminder",
  autoPublish: "auto-publish",
  // Channel card, then the recipient and requester DMs.
  publishShipment: "publish-shipment",
  // Post or update the requester's DM (Verificar / Reportar problema).
  syncRequesterDm: "sync-requester-dm",
  notifyIssueReported: "notify-issue-reported",
  // Reply in the recipient's DM thread with a new comment.
  notifyComment: "notify-comment",
  refreshMergeRequests: "refresh-merge-requests",
  handleSlackInteraction: "handle-slack-interaction",
  requestReverification: "request-reverification",
  reviewWeight: "review-weight", // v1.5
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface ShipmentJob {
  shipmentId: number;
}

// Timers are tied to one draft cycle (shipments.pending_since), so later cycles cancel them.
export interface TimerJob extends ShipmentJob {
  cycle: string;
}
