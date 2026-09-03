import assert from "node:assert/strict";
import type { AtlasOpportunity } from "./decisionAtlas";
import { buildBoundedRetuneBook } from "./boundedRetuneExperiments";
import {
  PRIORITY_A_BOUNDED_RETUNES,
  buildBoundedRetuneSignalStamp,
} from "./boundedRetuneRegistry";

assert.equal(PRIORITY_A_BOUNDED_RETUNES.length, 26);
assert.equal(new Set(PRIORITY_A_BOUNDED_RETUNES.map((row) => row.channel)).size, 26);
assert.equal(PRIORITY_A_BOUNDED_RETUNES.filter((row) => row.variable === "max_entries_per_session").length, 20);
assert.equal(PRIORITY_A_BOUNDED_RETUNES.filter((row) => row.variable === "take_profit_pct").length, 6);
assert(PRIORITY_A_BOUNDED_RETUNES.every((row) => row.executionAuthority === false
  && row.minimumEvidence.sessions === 5 && row.minimumEvidence.logicalOutcomes === 10));
for (const channel of ["pb-ride-itm", "grind-v3-2"]) {
  const capOne = PRIORITY_A_BOUNDED_RETUNES.find((row) => row.channel === channel)!;
  assert.equal(capOne.experimentId, `priority-a:${channel}:max_entries_per_session:v2`);
  assert.equal(capOne.cohortStartSession, "2026-09-03");
  assert.equal(capOne.controlValue, null);
  assert.equal(capOne.alternativeValue, 1);
  assert.equal(capOne.executionAuthority, false);
}

const definition = PRIORITY_A_BOUNDED_RETUNES.find((row) => row.channel === "vb-ribbon-cross-iwm")!;
const stamp = buildBoundedRetuneSignalStamp({
  channel: definition.channel,
  sourceContentHash: definition.baseline.sourceContentHash,
  maxContracts: definition.baseline.maxContracts,
  configuredPremiumStopPct: definition.baseline.configuredPremiumStopPct,
  takeProfitPct: definition.baseline.takeProfitPct,
})!;

const opportunity = (session: string, index: number, result: number,
  boundedRetuneStamp: AtlasOpportunity["boundedRetuneStamp"] = stamp): AtlasOpportunity => ({
  logicalOpportunityId: `${session}:${index}`,
  id: `${session}:${index}`,
  channel: definition.channel,
  session,
  signalAt: `${session}T1${index}:00:00.000Z`,
  exitAt: `${session}T20:00:00.000Z`,
  configurationEra: "prospective-channel:experiment",
  portfolioConfigurationEra: "portfolio:experiment",
  managerVersion: "native",
  evidenceLayer: "prospective_virtual",
  accountId: null,
  underlying: "IWM",
  occSymbol: `IWM-${session}-${index}`,
  direction: "call",
  contractSelected: true,
  quoteEligible: true,
  admissionAllowed: false,
  filled: false,
  blockedReason: "dark",
  quantity: 1,
  entryPrice: 1,
  resultPerContractUsd: result,
  returnPct: result,
  mfePct: 25,
  maePct: null,
  captureRatio: result / 25,
  stopExposurePerContractUsd: 30,
  boundedRetuneStamp,
  sourceRefs: [],
});

const rows = Array.from({ length: 5 }, (_, index) => `2026-08-${10 + index}`)
  .flatMap((session) => [opportunity(session, 0, 10), opportunity(session, 1, -20)]);
const book = buildBoundedRetuneBook({
  generatedAt: "2026-08-15T00:00:00.000Z",
  throughSession: "2026-08-14",
  opportunities: rows,
  definitions: [definition],
});
const evidence = book.experiments[0].evidence;
assert.equal(evidence.status, "review_ready");
assert.equal(evidence.scoredLogicalOutcomes, 10);
assert.equal(evidence.typicalControlSessionUsd, -10);
assert.equal(evidence.typicalAlternativeSessionUsd, 10);
assert.equal(evidence.pairedSessionImprovement, 1);
assert.equal(evidence.provisionalRead, "supports_alternative");
assert.equal(book.productionWrites, 0);
assert.equal(book.executionAuthority, false);

const censored = buildBoundedRetuneBook({
  generatedAt: "2026-08-11T00:00:00.000Z",
  throughSession: "2026-08-10",
  opportunities: [opportunity("2026-08-10", 0, 10, null)],
  definitions: [definition],
}).experiments[0].evidence;
assert.equal(censored.prospectiveSessions, 0);
assert.equal(censored.censored.missingExperimentStamp, 1);

const partial = opportunity("2026-08-10", 1, 0);
partial.resultPerContractUsd = null;
const partiallyScored = buildBoundedRetuneBook({
  generatedAt: "2026-08-11T00:00:00.000Z",
  throughSession: "2026-08-10",
  opportunities: [opportunity("2026-08-10", 0, 10), partial],
  definitions: [definition],
}).experiments[0].evidence;
assert.equal(partiallyScored.prospectiveSessions, 1,
  "one unscored signal must not poison a complete logical opportunity in the same session");
assert.equal(partiallyScored.scoredLogicalOutcomes, 1);
assert.equal(partiallyScored.censored.unscoredLogicalOpportunities, 1);
assert.equal(partiallyScored.censored.incompleteSessions, 0);

console.log("bounded retune experiments self-test: PASS");
