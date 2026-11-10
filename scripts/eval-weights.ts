/**
 * Model evaluation for the weight second opinion (SCOPE.md §9).
 *
 *   npm run eval:weights -- --models qwen/...,deepseek/...,moonshotai/...
 *
 * For each ticket in config/calibration.yaml and each candidate model:
 *   1. build the same policy-filtered, redacted payload production would send
 *   2. call the model, validate against weightReviewOutput
 *   3. record: valid JSON?, suggested vs agreed weight (distance in scale steps),
 *      verdict correctness, latency, tokens
 * Output: a per-model summary table (agreement %, mean step error, invalid %, p50/p95 latency)
 * written to stdout and eval-results/<timestamp>.json. Every call is written to llm_audit_log
 * with purpose = "eval".
 */
console.error("[eval-weights] Not implemented (v1.5). See SCOPE.md §9.");
process.exit(1);
