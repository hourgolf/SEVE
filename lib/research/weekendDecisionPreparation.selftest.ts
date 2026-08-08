import assert from "node:assert/strict";
import {
  latestExecutedEraByChannel,
  prepareManagerReview,
  type WeekendAtlasChannel,
} from "./weekendDecisionPreparation.js";

function channel(input: {
  sessions: number;
  paired: number;
  typical: number;
  frequency: number;
  downside: number;
  lower: number;
  leave?: boolean;
  chronological?: boolean;
}): WeekendAtlasChannel {
  return {
    channel: "alpha",
    decisionCohort: { configurationEra: "current" },
    frontiers: [{
      evidenceLayer: "exact_current_configuration",
      configurationEra: "current",
      managers: [{
        managerId: "LOCK50/30",
        pairedOpportunities: input.paired,
        sessions: input.sessions,
        typicalBenefitPct: input.typical,
        improvementFrequency: input.frequency,
        downsideDeteriorationPct: input.downside,
        benefitInterval95: { lower: input.lower, upper: 20 },
        leaveSessionOutStable: input.leave ?? true,
        chronologicalStable: input.chronological ?? true,
      }],
    }],
  };
}

assert.equal(prepareManagerReview({
  atlasChannel: channel({ sessions: 10, paired: 12, typical: 8, frequency: 0.75, downside: -0.5, lower: 1 }),
  channel: "alpha",
  manager: "LOCK50/30",
}).verdict, "prepare_switch_review");
assert.equal(prepareManagerReview({
  atlasChannel: channel({ sessions: 7, paired: 7, typical: 8, frequency: 0.86, downside: -0.3, lower: 1 }),
  channel: "alpha",
  manager: "LOCK50/30",
}).verdict, "continue_dark_challenger");
assert.equal(prepareManagerReview({
  atlasChannel: channel({ sessions: 7, paired: 7, typical: -1, frequency: 0.43, downside: -40, lower: -20 }),
  channel: "alpha",
  manager: "LOCK50/30",
}).verdict, "hold_current_manager");
assert.equal(prepareManagerReview({
  atlasChannel: channel({ sessions: 2, paired: 2, typical: 20, frequency: 1, downside: 10, lower: -20 }),
  channel: "alpha",
  manager: "LOCK50/30",
}).verdict, "insufficient_paired_evidence");

assert.deepEqual(latestExecutedEraByChannel([
  { channel: "b", throughTimestamp: "2026-08-06T00:00:00Z", value: 1 },
  { channel: "a", throughTimestamp: "2026-08-07T00:00:00Z", value: 2 },
  { channel: "b", throughTimestamp: "2026-08-07T00:00:00Z", value: 3 },
]).map((row) => [row.channel, row.value]), [["a", 2], ["b", 3]]);

console.log("weekend-decision-preparation-selftest: 5/5 passed");
