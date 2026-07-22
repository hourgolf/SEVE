// Local, zero-network runner for the family exact-replay bridge. Inputs must
// already be frozen/checksum-verified. This script cannot fetch provider data,
// mutate Supabase/R2, alter strategy policy, or place orders.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DarkCandidateFreeze } from "../lib/research/darkCandidateFreeze.js";
import { bridgeFamilyExactReplays } from "../lib/research/familyExactReplayBridge.js";
import type { FamilyAdmissionReceipt } from "../lib/research/observerScorecard.js";
import type { VbCandidateScorecard } from "../lib/research/vbCandidateEvidence.js";

const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const OBSERVER = arg("observer");
const FREEZE = arg("freeze");
const SCORECARDS = arg("scorecards");
const OUT = arg("out", "data/family-exact-replays/latest.json");
if (!OBSERVER || !FREEZE || !SCORECARDS) {
  throw new Error("--observer, --freeze, and --scorecards receipts are required");
}

function load<T>(path: string): { value: T; sha256: string } {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")) as T, sha256: createHash("sha256").update(bytes).digest("hex") };
}

interface ObserverReceipt {
  receipts: { familyObservations: FamilyAdmissionReceipt[] };
}
type ScorecardReceipt = VbCandidateScorecard[] | { scorecards: VbCandidateScorecard[] };

function main(): void {
  const observer = load<ObserverReceipt>(OBSERVER);
  const freeze = load<DarkCandidateFreeze>(FREEZE);
  const scorecards = load<ScorecardReceipt>(SCORECARDS);
  const exactScorecards = Array.isArray(scorecards.value) ? scorecards.value : scorecards.value.scorecards;
  if (!Array.isArray(observer.value.receipts?.familyObservations)
      || !Array.isArray(freeze.value.candidates)
      || !Array.isArray(exactScorecards)) throw new Error("input receipt payload is incomplete");
  const bridged = bridgeFamilyExactReplays({
    familyObservations: observer.value.receipts.familyObservations,
    frozenCandidates: freeze.value.candidates,
    exactScorecards,
  });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      observer: { path: OBSERVER, sha256: observer.sha256 },
      freeze: { path: FREEZE, sha256: freeze.sha256, canonicalSha256: freeze.value.canonicalSha256 },
      scorecards: { path: SCORECARDS, sha256: scorecards.sha256 },
    },
    bridged,
    interpretation: {
      status: "review_only",
      note: "Each manager is a separate stratum. Overlapping re-entry clocks censor rather than pool. No result changes production policy.",
      policyChangeAuthorized: false,
      productionChangeAuthorized: false,
      orderPathAuthorized: false,
    },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`family-exact-replay-bridge: ${bridged.source.eligibleManagerGroups} eligible manager-groups · ${bridged.censors.length} censors`);
  console.log("  policy/production/orders: NO CHANGE AUTHORIZED");
  console.log(`  wrote ${OUT}`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
