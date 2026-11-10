/**
 * Weight second opinion: build prompt (rubric + calibration examples + signals + policy-
 * filtered content) → call model → validate against weightReviewOutput → write
 * weight_reviews + llm_audit_log. "agree" is the expected common case.
 */
import { notImplemented } from "@/lib/not-implemented";
import type { WeightReviewOutput } from "./output-schema";

export async function reviewWeight(_shipmentId: number): Promise<WeightReviewOutput> {
  return notImplemented("reviewWeight", "v1.5");
}
