import assert from "node:assert/strict";
import { buildChannelLifecycleDecisionPacket } from "./channelLifecycleDecision";

const atlas = { generatedAt: "2026-08-08T20:00:00Z", throughSession: "2026-08-07", channels: {
  loser: { channel: "loser", disposition: "retire", decisionCohort: { opportunities: 20, configurationEra: "versioned-native" }, lifecycle: { evidenceSessions: 7, scoredOpportunities: 20,
    typicalOpportunityUsd: -10, typicalSessionUsd: -20, uniqueness: "redundant", configurationCertainty: "versioned_historical" } },
  winner: { channel: "winner", disposition: "size", decisionCohort: { opportunities: 18, configurationEra: "exact-current" }, lifecycle: { evidenceSessions: 8, scoredOpportunities: 18,
    typicalOpportunityUsd: 12, typicalSessionUsd: 22, uniqueness: "unique", configurationCertainty: "exact_current" } },
} } as any;
const briefs = { channels: {
  loser: { decisionDistribution: { throughSession: "2026-08-07" }, capacity: { currentContracts: null }, recommendation: { axis: "retirement", summary: "negative" }, managers: { recommended: null } },
  winner: { decisionDistribution: { throughSession: "2026-08-07" }, capacity: { currentContracts: 2 }, recommendation: { axis: "size", summary: "positive" }, managers: { recommended: null } },
} } as any;
const experiments = { plans: { loser: { stage: "preregistered", collection: { independentSessions: 0 } },
  winner: { stage: "preregistered", collection: { independentSessions: 0 } } } } as any;
const capacity = { channels: { loser: { state: "not_applicable" }, winner: { state: "ready_for_paper_review", plainLanguage: "2→3 supported" } } } as any;
const packet = buildChannelLifecycleDecisionPacket({ atlas, briefs, experiments, capacity, execution: { state: "pass" } as any });
assert.equal(packet.channels.loser.action, "retirement_review");
assert.equal(packet.channels.winner.action, "size_review");
assert.deepEqual(packet.queues.retirement_review, ["loser"]);
assert.equal(packet.automaticActivation, false);
for (const era of ["virtual-reference-policy", "historical_unstamped", "legacy", "unverified"]) {
  atlas.channels.loser.decisionCohort.configurationEra = era;
  const fenced = buildChannelLifecycleDecisionPacket({ atlas, briefs, experiments, capacity, execution: { state: "pass" } as any });
  assert.equal(fenced.channels.loser.action, "continue_unique_collection", era + " cannot bypass retirement eligibility");
}
console.log("channel-lifecycle-decision-selftest: PASS");
