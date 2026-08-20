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
assert.equal(evidenceMaturity(5, 10), "DECISION READY");
assert.equal(evidenceFreshness("2026-08-03", "2026-08-19"), "STALE");
assert.equal(deriveChannelLineupStory({ summary: summary(), referenceSession: "2026-08-19" }).group, "WORKING CONSISTENTLY");
assert.equal(deriveChannelLineupStory({ summary: summary(), referenceSession: "2026-08-19" }).typicalFinalReturnPct, 10);
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalReturnPct: -2, typicalCapture: -.1 }), referenceSession: "2026-08-19" }).group, "GOOD ENTRY · LEAKING EXIT");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalReturnPct: -2, typicalCapture: -5 }), referenceSession: "2026-08-19" }).typicalCapture, 0, "a below-entry finish keeps none of the favorable move");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalMfePct: -4, typicalReturnPct: -30 }), referenceSession: "2026-08-19" }).typicalBestMovePct, 0, "best favorable move cannot display below zero");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalMfePct: 4, typicalPerPath: -4, typicalSessionPerContract: 2 }), referenceSession: "2026-08-19" }).group, "WEAK ENTRY");
assert.equal(deriveChannelLineupStory({ summary: summary({ typicalMfePct: 4, typicalPerPath: -4, typicalSessionPerContract: -8 }), referenceSession: "2026-08-19" }).group, "CONSISTENTLY NEGATIVE");
assert.equal(deriveChannelLineupStory({ summary: summary({ weakSessionPerContract: -100, largestWinnerShare: .6 }), referenceSession: "2026-08-19" }).group, "PROMISING BUT FRAGILE", "positive medians cannot hide a damaging loss tail");
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
console.log("channel-lineup-selftest: PASS");
