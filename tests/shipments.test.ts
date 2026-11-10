/** Behaviour spec for M1/M3 shipment rules (SCOPE.md §4). */
import { describe, it } from "vitest";

describe("ingest", () => {
  it.todo("creates one shipment per (ticket, branch)");
  it.todo("nudges when Done is applied without a Branch label");
  it.todo("nudges when related MRs are still open; held shipments release on final merge");
  it.todo("ignores duplicate deliveries with the same X-Gitlab-Event-UUID");
  it.todo("flags native weight vs 'Weight: X' label mismatch (native wins)");
});

describe("timers", () => {
  it.todo("sends one reminder after REMINDER_AFTER_HOURS");
  it.todo("auto-publishes after AUTO_PUBLISH_AFTER_HOURS with published_via = auto");
});
