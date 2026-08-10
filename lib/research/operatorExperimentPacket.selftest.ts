import assert from "node:assert/strict";
import { buildOperatorExperimentPacket, renderOperatorExperimentPacket } from "./operatorExperimentPacket";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { ChannelExperimentPacket } from "./channelExperimentLifecycle";
import type { ChannelLifecycleDecisionPacket } from "./channelLifecycleDecision";
import type { ChannelTrailFrontierBook } from "./channelTrailFrontier";

const baseCandidate = { candidateId: "FULL-R50-K75", label: "ARM +50 · KEEP THREE QUARTERS", family: "full_ratchet",
  pairedOpportunities: 4, censoredOpportunities: 0, sessions: 3, coverage: 1, typicalBenefitPct: 8,
  improvementFrequency: .75, downsideDeteriorationPct: 0, typicalCapture: .5, maxDrawdownPct: 10,
  outlierShare: .2, convexTailOpportunities: 0, typicalConvexTailCapture: null,
  benefitInterval95: { lower: -1, upper: 17, sessions: 3, method: "session_clustered_t" },
  chronologicalStable: null, leaveSessionOutStable: null, stableParameterPlateau: true, verdict: "promising" };
const briefs = { generatedAt: "2026-08-10T20:00:00.000Z", throughSession: "2026-08-10", channels: {
  active: { evidence: { decisionSessions: 6, decisionOpportunities: 12 }, recommendation: { summary: "Later entries lose." } },
  entry: { evidence: { decisionSessions: 6, decisionOpportunities: 12 }, recommendation: { summary: "Entry 2 is weak." } },
} } as unknown as ChannelDecisionBriefBundle;
const experiments = { throughSession: "2026-08-10", plans: {
  entry: { channel: "entry", stage: "preregistered", variable: { axis: "entry", control: "current", challenger: "cap before entry 2" } },
} } as unknown as ChannelExperimentPacket;
const lifecycle = { throughSession: "2026-08-10", queues: { retirement_review: ["retire"], keep_trading: ["active"] }, channels: {
  retire: { scoredSessions: 8, scoredOpportunities: 20, reasons: ["Negative and redundant."], plainLanguage: "Pause." },
} } as unknown as ChannelLifecycleDecisionPacket;
const trails = { throughSession: "2026-08-10", channels: { active: { selectedConfigurationEra: "current", eras: [{
  configurationEra: "current", candidates: [baseCandidate],
}] } } } as unknown as ChannelTrailFrontierBook;
const packet = buildOperatorExperimentPacket({ briefs, experiments, lifecycle, trails });
assert.equal(packet.retirementReviews.length, 1);
assert.equal(packet.entryTrials.length, 1);
assert.equal(packet.trailTrials[0]?.action, "prepare_paper_trial");
assert.equal(packet.summary.paperTrailTrials, 1);
assert.equal(packet.guarantees.productionWrites, 0);
assert.equal(packet.guarantees.automaticActivation, false);
assert.match(renderOperatorExperimentPacket(packet), /One channel, one change/);
assert.match(renderOperatorExperimentPacket(packet), /No production behavior change is authorized/);
assert.throws(() => buildOperatorExperimentPacket({
  briefs, experiments: { ...experiments, throughSession: "2026-08-09" }, lifecycle, trails,
}), /share one through session/);
console.log("operator-experiment-packet selftest: PASS");
