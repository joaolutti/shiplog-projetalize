/** Structured output contract for the weight second opinion (SCOPE.md §7). */
import { z } from "zod";

/** TODO(leads): confirm the scale's top value. */
export const WEIGHT_SCALE = [1, 2, 3, 5, 8, 13] as const;

export const weightReviewOutput = z.object({
  verdict: z.enum(["agree", "increase", "decrease"]),
  suggestedWeight: z.union(WEIGHT_SCALE.map((w) => z.literal(w))),
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string().max(600),
  notesDraft: z.string().max(1200),
});

export type WeightReviewOutput = z.infer<typeof weightReviewOutput>;
