import assert from "node:assert/strict";
import type { ChannelDecisionBrief, ChannelDecisionAxis } from "./channelDecisionBrief";
import { buildChannelDecisionSummary, buildFleetDecisionSummary, CHANNEL_DISPOSITIONS, dispositionForAxis } from "./channelDecisionSummary";

const axes: ChannelDecisionAxis[] = ["entry", "exit", "manager", "size", "admission", "collection", "promotion", "retirement"];
assert.deepEqual(axes.map(dispositionForAxis), CHANNEL_DISPOSITIONS.filter(d => d !== "REVIEW TRIAL"));

const brief = (axis: ChannelDecisionAxis): ChannelDecisionBrief => ({
  schemaVersion: 1,
  briefVersion: "channel-decision-brief-v1",
  channel: `test-${axis}`,
  throughSession: "2026-08-07",
  generatedAt: "2026-08-07T21:00:00.000Z",
  recommendation: { axis, label: "LEGACY LABEL", summary: "The typical path points to one bounded test.", nextExperiment: "Test one variable and preserve the control.", productionChangeAuthorized: false },
  metrics: [
    { label: "typical result", value: "+$12 / ct", fact: "Median logical opportunity." },
    { label: "evidence", value: "6s / 12", fact: "Independent sessions and logical opportunities." },
    { label: "exit capture", value: "50%", fact: "Typical capture." },
    { label: "manager test", value: "native", fact: "Native holds." },
    { label: "size replay", value: "1→2 ct", fact: "Replay only." },
  ],
  executed: { state: "available", label: "LATEST EXECUTED ERA", configurationEra: "current", sessions: 6, logicalTrades: 12, positiveTrades: 7, typicalResultUsd: 12, totalResultUsd: 144, throughSession: "2026-08-07" },
  historicalVirtual: { state: "available", label: "HISTORICAL VIRTUAL", configurationEra: "historical", sessions: 12, opportunities: 24, scored: 24, typicalResultPerContractUsd: 10, totalResultPerContractUsd: 240 },
  entryFrequency: { conclusion: "Entry 3 is the first weak later entry.", rows: [
    { entryNumber: 1, opportunities: 6, scored: 6, sessions: 6, positive: 4, typicalResultPerContractUsd: 18, totalResultPerContractUsd: 108 },
    { entryNumber: 2, opportunities: 6, scored: 6, sessions: 6, positive: 3, typicalResultPerContractUsd: 4, totalResultPerContractUsd: 24 },
    { entryNumber: 3, opportunities: 6, scored: 6, sessions: 6, positive: 2, typicalResultPerContractUsd: -7, totalResultPerContractUsd: -42 },
  ], leadingBlock: null },
  nativeExit: { conclusion: "The exit keeps half of the move.", typicalReturnPct: 10, typicalBestMovePct: 20, typicalCapture: .5, typicalGivebackPoints: 10, outlierShare: .2 },
  managers: { conclusion: "Native holds.", recommended: null, compared: [{ managerId: "lock-50-30", managerVersion: "v1", pairedOpportunities: 12, sessions: 6, typicalBenefitPct: 2, improvementFrequency: .58, downsideDeteriorationPct: -1, maxDrawdownPct: 10, typicalCapture: .55, outlierShare: .2, benefitInterval95: { lower: -1, upper: 5, sessions: 6, method: "session_clustered_t" }, leaveSessionOutStable: false, chronologicalStable: true }] },
  capacity: { conclusion: "One additional contract adds value but also drawdown.", currentContracts: 1, currentSizeObserved: true, bestSupportedContracts: 2, points: [
    { contracts: 1, eligibleOpportunities: 12, deployedOpportunities: 12, deploymentFrequency: 1, totalResultUsd: 120, typicalResultPerOpportunityUsd: 10, marginalResultVsPriorUsd: null, peakDebitUsd: 300, peakStopExposureUsd: 180, displacedOpportunities: 0, displacedCounterfactualUsd: 0, maxDrawdownUsd: 40, portfolioEligibleOpportunities: 50, portfolioDeployedOpportunities: 50, portfolioTotalResultUsd: 500, marginalPortfolioResultVsOneContractUsd: null, portfolioMaxDrawdownUsd: 100, displacedTargetOpportunities: 0, displacedOtherOpportunities: 0, displacedOtherCounterfactualUsd: 0, additionalDisplacedOtherOpportunitiesVsOneContract: null, additionalDisplacedOtherCounterfactualUsdVsOneContract: null, displacedByChannel: [] },
    { contracts: 2, eligibleOpportunities: 12, deployedOpportunities: 11, deploymentFrequency: .92, totalResultUsd: 210, typicalResultPerOpportunityUsd: 19, marginalResultVsPriorUsd: 90, peakDebitUsd: 600, peakStopExposureUsd: 360, displacedOpportunities: 1, displacedCounterfactualUsd: 5, maxDrawdownUsd: 75, portfolioEligibleOpportunities: 50, portfolioDeployedOpportunities: 48, portfolioTotalResultUsd: 575, marginalPortfolioResultVsOneContractUsd: 75, portfolioMaxDrawdownUsd: 135, displacedTargetOpportunities: 1, displacedOtherOpportunities: 1, displacedOtherCounterfactualUsd: 5, additionalDisplacedOtherOpportunitiesVsOneContract: 1, additionalDisplacedOtherCounterfactualUsdVsOneContract: 5, displacedByChannel: [{ channel: "peer", opportunities: 1, counterfactualUsd: 5 }] },
  ] },
  collision: { conclusion: "Overlap is evidence, not a veto.", strongestOverlap: null, edges: [] },
  platformEffect: { state: "missing", candidates: 0, sessions: 0, protectedLosses: 0, blockedWinners: 0, managerCensors: 0,
    typicalAcrossManagersUsd: null, conclusion: "No exact blocked cohort.", byReason: [] },
  evidence: { decisionLayer: "exact_current_configuration", configurationEra: "current", decisionSessions: 6, decisionOpportunities: 12, exactCurrentAvailable: true, layers: [], limitations: ["Fixture limitation."] },
});

const summary = buildChannelDecisionSummary(brief("entry"));
assert.equal(summary.metrics.length, 3);
assert(summary.diagnosis.length <= 180);
assert(summary.nextTest.length <= 180);
assert.match(summary.nextTest, /^[A-Z]/);
assert.equal(summary.disposition, "TEST ENTRY TIMING");
assert.equal(summary.evidenceState, "DECISION READY");
assert.deepEqual(summary.keepFixed, ["exit", "manager", "size"]);
assert.equal(summary.sizing.steps[1].marginalResultUsd, 75);
assert.equal(summary.sizing.steps[1].marginalDrawdownUsd, 35);
assert.equal(summary.manager.challenger?.id, "lock-50-30");

const negativeCapture = brief("exit");
negativeCapture.nativeExit.typicalReturnPct = -10;
negativeCapture.nativeExit.typicalBestMovePct = 20;
negativeCapture.nativeExit.typicalCapture = -.5;
assert.deepEqual(buildChannelDecisionSummary(negativeCapture).metrics[2], {
  label: "EXIT RESULT", value: "BELOW ENTRY", fact: "The exit keeps half of the move.",
});

const fleet = buildFleetDecisionSummary(Object.fromEntries(axes.map((axis) => [axis, brief(axis)])), "2026-08-07");
assert.equal(fleet.reports, 8);
assert.equal(fleet.investigate, 5);
assert.equal(fleet.promoteOrRetire, 2);
assert.equal(fleet.collecting, 1);

console.log("channel-decision-summary selftest: PASS");
