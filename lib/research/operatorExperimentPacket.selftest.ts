import assert from "node:assert/strict";
import { buildOperatorExperimentPacket, renderOperatorExperimentPacket } from "./operatorExperimentPacket";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import type { ChannelLifecycleDecisionPacket } from "./channelLifecycleDecision";
import type { DecisionAtlas } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import type { PortfolioCapacityDecisionPacket } from "./portfolioCapacityDecision";
import type { ChannelTrailFrontierBook } from "./channelTrailFrontier";

const baseCandidate = { candidateId: "FULL-R50-K75", label: "ARM +50 · KEEP THREE QUARTERS", family: "full_ratchet",
  pairedOpportunities: 4, censoredOpportunities: 0, sessions: 3, coverage: 1, typicalBenefitPct: 8,
  improvementFrequency: .75, downsideDeteriorationPct: 0, typicalCapture: .5, maxDrawdownPct: 10,
  outlierShare: .2, convexTailOpportunities: 0, typicalConvexTailCapture: null,
  benefitInterval95: { lower: 1, upper: 17, sessions: 3, method: "session_clustered_t" },
  chronologicalStable: true, leaveSessionOutStable: true, stableParameterPlateau: true, verdict: "promising" };
const briefs = { generatedAt: "2026-08-10T20:00:00.000Z", throughSession: "2026-08-10", channels: {
  active: { evidence: { decisionSessions: 6, decisionOpportunities: 12 }, recommendation: { summary: "Later entries lose." } },
  entry: { evidence: { decisionSessions: 6, decisionOpportunities: 12 }, recommendation: { summary: "Entry 2 is weak." } },
} } as unknown as ChannelDecisionBriefBundle;
const experiments = { throughSession: "2026-08-10", plans: {
  entry: { channel: "entry", stage: "preregistered", variable: { axis: "entry", control: "current", challenger: "cap before entry 2" } },
} } as unknown as ChannelExperimentPacket;
const lifecycle = { throughSession: "2026-08-10", queues: { retirement_review: ["retire"], keep_trading: ["active"] }, channels: {
  retire: { scoredSessions: 8, scoredOpportunities: 20, typicalOpportunityUsd: -4, typicalSessionUsd: -8,
    uniqueness: "redundant", reasons: ["Negative and redundant."], plainLanguage: "Pause." },
} } as unknown as ChannelLifecycleDecisionPacket;
const trails = { throughSession: "2026-08-10", channels: { active: { selectedConfigurationEra: "current", eras: [{
  configurationEra: "current", candidates: [baseCandidate], recommendation: "test_full_ratchet",
  recommendedCandidateId: "FULL-R50-K75", plainLanguage: "Prepare a test.",
}] } }, candidates: [{ id: "FULL-R50-K75", family: "full_ratchet", bankPct: null, armPct: 50,
  retainPeakGain: .75, preArmStopPct: 30 }] } as unknown as ChannelTrailFrontierBook;
const atlas = { collisionGraph: [{ left: "retire", right: "peer", redundancy: "high", comparableSessions: 8,
  returnCorrelation: .8 }] } as unknown as DecisionAtlas;
const snapshot = { activeChannelSpecs: [{ slug: "active", executionPosture: "paper", cohort: "control",
  accountRole: "PAPER-1", accountId: "a1", quantity: 2, collisionDomain: "control", managerProfileId: "NATIVE",
  entryParameters: { maxEntriesPerSession: 2 } }], strategists: [] } as unknown as DecisionAtlasSourceSnapshot;
const capacity = { channels: { active: { currentContracts: 2 } } } as unknown as PortfolioCapacityDecisionPacket;
const packet = buildOperatorExperimentPacket({ briefs, experiments, lifecycle, trails, atlas, snapshot, capacity });
assert.equal(packet.retirementReviews.length, 1);
assert.equal(packet.entryTrials.length, 1);
assert.equal(packet.trailTrials[0]?.action, "prepare_paper_trial");
assert.equal(packet.trailTrials[0]?.context.posture, "ACTIVE ROOT");
assert.equal(packet.summary.paperTrailTrials, 1);
assert.equal(packet.retirementReviews[0]?.validation, "go_reversible_pause");
assert.equal(packet.retirementReviews[0]?.redundantPeer, "peer");
assert.equal(packet.guarantees.productionWrites, 0);
assert.equal(packet.guarantees.automaticActivation, false);
assert.match(renderOperatorExperimentPacket(packet), /One channel, one change/);
assert.match(renderOperatorExperimentPacket(packet), /20 opportunities/);
assert.doesNotMatch(renderOperatorExperimentPacket(packet), /opportunitys/);
assert.match(renderOperatorExperimentPacket(packet), /No production behavior change is authorized/);
const keepNativeTrails = { ...trails, channels: { active: { ...trails.channels.active, eras: [{
  ...trails.channels.active.eras[0], recommendation: "keep_native", recommendedCandidateId: null,
  plainLanguage: "Keep native.",
}] } } } as unknown as ChannelTrailFrontierBook;
const keepNative = buildOperatorExperimentPacket({ briefs, experiments, lifecycle, trails: keepNativeTrails,
  atlas, snapshot, capacity });
assert.equal(keepNative.summary.paperTrailTrials, 0);
assert.equal(keepNative.trailTrials[0]?.action, "shadow_only");
assert.throws(() => buildOperatorExperimentPacket({
  briefs, experiments: { ...experiments, throughSession: "2026-08-09" }, lifecycle, trails,
  atlas, snapshot, capacity,
}), /share one through session/);
console.log("operator-experiment-packet selftest: PASS");
