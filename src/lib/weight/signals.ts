/**
 * Deterministic signals fed to the model alongside spec + (policy-filtered) diffs.
 * Active window = first commit (or MR creation) → last merge; backlog time excluded.
 */
import { notImplemented } from "@/lib/not-implemented";

export interface WeightSignals {
  assignedWeight: number | null;
  mrCount: number;
  projectsTouched: string[];
  filesChanged: number;
  additions: number;
  deletions: number;
  testFilesChanged: number;
  reviewRounds: number;
  activeWindowHours: number | null;
}

export async function collectSignals(_shipmentId: number): Promise<WeightSignals> {
  return notImplemented("collectSignals", "v1.5");
}
