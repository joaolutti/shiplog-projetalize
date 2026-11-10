/** Queue names: shared by producers (route handlers) and the worker. */
export const JOBS = {
  ingestGitlabEvent: "ingest-gitlab-event",
  sendDraftDm: "send-draft-dm",
  sendReminder: "send-reminder",
  autoPublish: "auto-publish",
  publishShipment: "publish-shipment",
  notifyRequester: "notify-requester",
  refreshMergeRequests: "refresh-merge-requests",
  handleSlackInteraction: "handle-slack-interaction",
  reviewWeight: "review-weight", // v1.5
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];
