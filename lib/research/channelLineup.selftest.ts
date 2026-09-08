import assert from "node:assert/strict";
import { deriveChannelLineupStory, evidenceFreshness, evidenceMaturity, sortChannelLineup } from "./channelLineup";
import type { ShadowChannelSummary } from "./shadowResearch";

const summary = (overrides: Partial<ShadowChannelSummary> = {}): ShadowChannelSummary => ({
  slug: "alpha", paths: 20, scored: 20, winners: 12, targets: 10, stops: 8, flattens: 2,
  pnlPerContract: 100, averagePerPath: 5, typicalPerPath: 5, largestWinnerShare: .25,
  averageMfePct: 18, averageGivebackPct: 20, typicalMfePct: 18, typicalGivebackPct: 20,
  typicalReturnPct: 10, typicalCapture: .55, sessions: 8, positiveSessions: 6, positiveSessionRate: .75,
  typicalSessionPerContract: 15, weakSessionPerContract: -10, strongSessionPerContract: 35,
  typicalLossPerContract: -20, fromSession: "2026-08-03", throughSession: "2026-08-19",
  channelSpecVersionIds: ["spec-a"], configurationEpochIds: ["epoch-a"], lastAt: "2026-08-19T15:00:00Z",
  ...overrides,
});

assert.equal(evidenceMaturity(1, 10), "ONE SESSION · EARLY");
assert.equal(evidenceMaturity(5, 10), "SAMPLE AVAILABLE");
assert.equal(evidenceFreshness("2026-08-03", "2026-08-19"), "STALE");
assert.equal(deriveChannelLineupStory({ summary: summary(), referenceSession: "2026-08-19" }).group, "POSITIVE PATH RESULTS");
assert.equal(deriveChannelLineupStory({ summary: summary(), referenceSession: "2026-08-19" }).typicalFinalReturnPct, 10);
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalReturnPct: -2, typicalCapture: -.1 }), referenceSession: "2026-08-19" }).group, "FAVORABLE PEAKS · WEAK FINISH");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalReturnPct: -2, typicalCapture: -5 }), referenceSession: "2026-08-19" }).typicalCapture, 0, "a below-entry finish keeps none of the favorable move");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalMfePct: -4, typicalReturnPct: -30 }), referenceSession: "2026-08-19" }).typicalBestMovePct, 0, "best favorable move cannot display below zero");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalMfePct: 4, typicalPerPath: -4, typicalSessionPerContract: 2 }), referenceSession: "2026-08-19" }).group, "LIMITED OBSERVED UPSIDE");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalMfePct: 4, typicalPerPath: -4, typicalSessionPerContract: -8 }), referenceSession: "2026-08-19" }).group, "NEGATIVE PATH RESULTS");
assert.equal(deriveChannelLineupStory({ summary: summary({ weakSessionPerContract: -100, largestWinnerShare: .6 }), referenceSession: "2026-08-19" }).group, "MIXED / CONCENTRATED", "positive medians cannot hide a damaging loss tail");
const staleWinner = deriveChannelLineupStory({ summary: summary({ slug: "grind", sessions: 1, scored: 2, typicalPerPath: 124, throughSession: "2026-08-03" }), referenceSession: "2026-08-19" });
assert.equal(staleWinner.group, "TOO EARLY / STALE");
const order = sortChannelLineup([
  staleWinner,
  deriveChannelLineupStory({ summary: summary({ slug: "exit-leak", typicalReturnPct: -2, typicalCapture: -.1 }), referenceSession: "2026-08-19" }),
]);
assert.equal(order[0].channel, "exit-leak", "a stale two-path winner cannot lead the decision lineup");

for (const testCase of [
  summary({ slug: "empty", sessions: 0, scored: 0, throughSession: "" }),
  summary({ slug: "low", sessions: 2, scored: 4 }),
  summary({ slug: "stale", sessions: 8, scored: 20, throughSession: "2026-08-03" }),
]) {
  assert.equal(deriveChannelLineupStory({ summary: testCase, referenceSession: "2026-08-19" }).group, "TOO EARLY / STALE");
}

// A selected empty cohort must never borrow a profitable older virtual cohort.
const selected = { managers: { recommended: null }, throughSession: "2026-09-04", decisionDistribution: {
  label: "DECISION COHORT", sessions: 0, opportunities: 0, positiveSessions: 0,
  positiveSessionRate: null, typicalOpportunityUsd: null, typicalSessionUsd: null,
  weakSessionUsd: null, strongSessionUsd: null, typicalBestMovePct: null,
  typicalFinalReturnPct: null, coherentCapture: null, largestWinnerShare: null,
  fromSession: null, throughSession: null,
}} as unknown as import("./channelDecisionBrief").ChannelDecisionBrief;
const emptyCurrent = deriveChannelLineupStory({summary: summary(), brief: selected, referenceSession: "2026-09-04"});
assert.equal(emptyCurrent.typicalSession, null);
assert.equal(emptyCurrent.typicalBestMovePct, null);
assert.equal(emptyCurrent.typicalFinalReturnPct, null);
assert.equal(emptyCurrent.positiveSessionRate, null);
assert.equal(emptyCurrent.weakSession, null);
assert.equal(emptyCurrent.freshness, "UNKNOWN");
assert.equal(emptyCurrent.group, "TOO EARLY / STALE");
const oldCohort = structuredClone(selected);
Object.assign(oldCohort.decisionDistribution!, {sessions: 10, opportunities: 30, throughSession: "2026-08-03"});
assert.equal(deriveChannelLineupStory({summary: summary(), brief: oldCohort, referenceSession: "2026-09-04"}).freshness, "STALE", "new report date must not refresh an old channel cohort");
assert.equal(deriveChannelLineupStory({summary: summary({typicalMfePct:4, typicalPerPath:-4, typicalSessionPerContract:-8}), referenceSession:"2026-08-19"}).next,"COLLECT", "negative descriptive paths alone do not authorize retirement");

console.log("channel-lineup-selftest: PASS");
