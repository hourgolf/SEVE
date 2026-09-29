import assert from "node:assert/strict";
import type { ChannelDecisionBrief } from "./channelDecisionBrief";
import { publishedDecisionCohortSummary } from "./publishedDecisionCohort";

const brief = {
  channel: "vb-test",
  throughSession: "2026-09-28",
  generatedAt: "2026-09-29T01:00:00.000Z",
  evidence: { decisionSessions: 8, decisionOpportunities: 21 },
  decisionDistribution: {
    fromSession: "2026-09-15",
    throughSession: "2026-09-28",
    sessions: 7,
    opportunities: 18,
    positiveSessions: 5,
    positiveSessionRate: 5 / 7,
    typicalOpportunityUsd: 12,
    typicalSessionUsd: 28,
    weakSessionUsd: -9,
    strongSessionUsd: 44,
    typicalBestMovePct: 20.3,
    typicalFinalReturnPct: 16.1,
    coherentCapture: null,
    largestWinnerShare: .31,
  },
} as unknown as ChannelDecisionBrief;

const summary = publishedDecisionCohortSummary(brief);
assert.equal(summary.evidenceBasis, "published_decision_cohort");
assert.equal(summary.paths, 18);
assert.equal(summary.sessions, 7);
assert.equal(summary.typicalSessionPerContract, 28);
assert.equal(summary.typicalMfePct, 20.3);
assert.equal(summary.typicalCapture, null, "unknown capture must remain unknown");
assert.equal(summary.averagePerPath, null, "a median must not be relabeled as an average");
assert.equal(summary.targets + summary.stops + summary.flattens, 0, "published briefs do not invent raw exit counts");
assert.deepEqual(summary.channelSpecVersionIds, [], "configuration labels are not version ids");

console.log("published decision cohort selftest: PASS");
