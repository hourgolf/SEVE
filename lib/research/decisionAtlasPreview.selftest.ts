import assert from "node:assert/strict";
import { buildDecisionAtlasPreview } from "./decisionAtlasPreview";
import type { ChannelDryPowderCurve, ShadowChannelSummary } from "./shadowResearch";

const summary: ShadowChannelSummary = {
  slug: "alpha", paths: 20, scored: 18, winners: 11, targets: 8, stops: 7, flattens: 3,
  pnlPerContract: 180, averagePerPath: 10, typicalPerPath: 6,
  largestWinnerShare: .28, averageMfePct: 32, averageGivebackPct: 22,
  lastAt: "2026-08-06T15:00:00.000Z",
};
const curve: ChannelDryPowderCurve = {
    slug: "alpha", fromSession: "2026-07-30", throughSession: "2026-08-06",
    sessionCount: 6, paths: 20, scored: 18, gates: { premiumOrDebit: 0, concurrency: 0, frequency: 0, lifecycle: 20, other: 0 },
    basis: "capital-blind native virtual paths",
    points: [
      { entryBudget: 1, marginalPaths: 6, marginalScored: 6, marginalWinners: 4,
        marginalPnlPerContract: 60, marginalAveragePerPath: 10, selectedPaths: 6,
        selectedScored: 6, selectedPnlPerContract: 60, averagePnlPerSession: 10,
        peakConcurrentPositions: 1, peakDebitPerContract: 100 },
      { entryBudget: 2, marginalPaths: 6, marginalScored: 6, marginalWinners: 4,
        marginalPnlPerContract: 30, marginalAveragePerPath: 5, selectedPaths: 12,
        selectedScored: 12, selectedPnlPerContract: 90, averagePnlPerSession: 15,
        peakConcurrentPositions: 2, peakDebitPerContract: 200 },
    ],
  };
const preview = buildDecisionAtlasPreview({ summary, dryPowder: curve });
assert.equal(preview.label, "TEST CAPACITY");
assert.equal(preview.metrics.length, 5);
assert.equal(preview.metrics[0].label, "typical result");
assert.match(preview.evidenceFact, /largest winner 28%/);

const negative = buildDecisionAtlasPreview({ summary: { ...summary, typicalPerPath: -8 },
  dryPowder: { ...curve, sessionCount: 12, points: [] } });
assert.equal(negative.label, "REVIEW ENTRY");

console.log("decision-atlas preview selftest: PASS");
