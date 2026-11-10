/** Who gets the draft DM: assignee → linked-MR author → user who applied the label. */
import { notImplemented } from "@/lib/not-implemented";

export interface RecipientCandidates {
  assigneeGitlabIds: number[];
  mrAuthorGitlabIds: number[];
  labelAppliedByGitlabId: number | null;
}

export async function resolveRecipient(
  _c: RecipientCandidates,
): Promise<{ gitlabId: number; userId: string | null } | null> {
  return notImplemented("resolveRecipient", "M1");
}
