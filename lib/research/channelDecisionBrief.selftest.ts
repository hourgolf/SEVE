import assert from "node:assert/strict";
import { buildChannelDecisionBriefs } from "./channelDecisionBrief";
import { buildDecisionAtlas, type AtlasInput } from "./decisionAtlas";
import { buildWeeklyReadout } from "./weeklyReadout";
import type { ProfitabilityLedger } from "../profitability/profitabilityLedger";
import { buildChannelTrailFrontier } from "./channelTrailFrontier";
import { buildRosterTrialReviews, WEEKEND_TRIAL_EPOCH } from "./rosterTrialReview";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { buildChannelDecisionSummary, buildFleetDecisionSummary } from "./channelDecisionSummary";
import { deriveChannelLineupStory } from "./channelLineup";
import type { ShadowChannelSummary } from "./shadowResearch";

const opportunities: AtlasInput["opportunities"] = [
  { logicalOpportunityId: "a", id: "a", channel: "test", session: "2026-08-06", signalAt: "2026-08-06T14:00:00Z", exitAt: "2026-08-06T14:10:00Z", configurationEra: "current", portfolioConfigurationEra: "portfolio-a", managerVersion: "native", evidenceLayer: "exact_current_configuration", accountId: "paper", underlying: "SPY", occSymbol: "SPY-A", direction: "call", contractSelected: true, quoteEligible: true, admissionAllowed: true, filled: true, blockedReason: null, quantity: 2, entryPrice: 100, resultPerContractUsd: 30, returnPct: 30, mfePct: 50, maePct: -10, captureRatio: .6, stopExposurePerContractUsd: 30, sourceRefs: ["a"] },
  { logicalOpportunityId: "b", id: "b", channel: "test", session: "2026-08-06", signalAt: "2026-08-06T15:00:00Z", exitAt: "2026-08-06T15:10:00Z", configurationEra: "current", portfolioConfigurationEra: "portfolio-a", managerVersion: "native", evidenceLayer: "exact_current_configuration", accountId: "paper", underlying: "SPY", occSymbol: "SPY-B", direction: "call", contractSelected: true, quoteEligible: true, admissionAllowed: true, filled: true, blockedReason: null, quantity: 2, entryPrice: 100, resultPerContractUsd: -10, returnPct: -10, mfePct: 20, maePct: -20, captureRatio: -.5, stopExposurePerContractUsd: 30, sourceRefs: ["b"] },
];
const atlas = buildDecisionAtlas({ generatedAt: "2026-08-07T21:00:00Z", throughSession: "2026-08-07", opportunities, managerPaths: [], accountBudgets: [{ accountId: "paper", buyingPowerUsd: 10_000, maxConcurrentDebitUsd: 10_000, maxConcurrentStopExposureUsd: 10_000, maxOpenPositions: 10 }], activeChannels: ["test"], currentChannelConfigurationEras: { test: "current" } });
const ledger = { logicalTrades: [], evidence: { runnerRowsCollapsed: 0 } } as unknown as ProfitabilityLedger;
const weekly = buildWeeklyReadout({ ledger, virtualTrades: [], atlasChannels: atlas.channels, throughSession: "2026-08-07", generatedAt: "2026-08-07T21:00:00Z" });
const trailFrontier = buildChannelTrailFrontier({
  generatedAt: atlas.generatedAt,
  throughSession: atlas.throughSession,
  opportunities: [{
    logicalOpportunityId: "a", channel: "test", session: "2026-08-06", configurationEra: "current", evidenceLayer: "executed",
    entryAt: "2026-08-06T14:00:00Z", entryPrice: 1, quantity: 2, nativeReturnPct: 30,
    nativeExitAt: "2026-08-06T14:10:00Z", source: "frozen_option_archive",
    quotes: [{ at: "2026-08-06T14:01:00Z", bid: 1.5 }, { at: "2026-08-06T14:02:00Z", bid: 1.2 }],
  }],
  currentConfigurationEras: { test: "current" },
});
const bundle = buildChannelDecisionBriefs({ atlas, weekly, opportunities, currentContractsByChannel: { test: 2 }, trailFrontier });
const brief = bundle.channels.test;
assert.equal(bundle.productionWrites, 0);
assert.equal(bundle.configurationAuthority, false);
assert.equal(brief.metrics.length, 5);
assert.equal(brief.entryFrequency.rows.length, 2);
assert.equal(brief.entryFrequency.rows[0].typicalResultPerContractUsd, 30);
assert.equal(brief.entryFrequency.rows[1].typicalResultPerContractUsd, -10);
assert.equal(brief.entryFrequency.rows[1].scored, 1);
assert.equal(brief.recommendation.productionChangeAuthorized, false);
assert.equal(brief.executed.state, "missing");
assert.equal(brief.evidence.exactCurrentAvailable, true);
assert.equal(brief.decisionDistribution?.sessions, 1);
assert.equal(brief.decisionDistribution?.opportunities, 2);
assert.equal(brief.decisionDistribution?.typicalSessionUsd, 20);
assert.equal(brief.decisionDistribution?.weakSessionUsd, 20);
assert.equal(brief.decisionDistribution?.typicalFinalReturnPct, 10);
assert.equal(brief.decisionDistribution?.coherentCapture, .29);
assert.equal(brief.trail?.label, "TRAIL FRONTIER");
assert.equal(brief.trail?.leading?.pairedOpportunities, 1);
const trialSnapshot = {
  currentConfigurationEpochId: WEEKEND_TRIAL_EPOCH,
  activeChannelSpecs: [{ slug: "vb-gap-drift-qqq", id: "version", accountId: "paper", executionPosture: "paper" }],
  activeChannelSpecDatabaseIdsByVersionKey: { version: "db-spec" },
  ledger: { logicalTrades: [24, 25, 27].map(day => ({ id: `${day}`, channelSlug: "vb-gap-drift-qqq", status: "closed",
    accountId: "paper", realizedPnlUsd: -100, closedAt: `2026-08-${day}T20:00:00Z`,
    configuration: { channelSpecVersionId: "db-spec", configurationEpochId: WEEKEND_TRIAL_EPOCH } })) },
} as unknown as DecisionAtlasSourceSnapshot;
const trial = buildRosterTrialReviews(trialSnapshot, "2026-08-28")["vb-gap-drift-qqq"];
const trialBundle = buildChannelDecisionBriefs({ atlas, weekly, opportunities, trialReviews: { test: trial } });
const flagged = trialBundle.channels.test;
assert.equal(flagged.recommendation.label, "TRIAL LIMIT REACHED");
assert.equal(flagged.recommendation.productionChangeAuthorized, false);
const flaggedSummary = buildChannelDecisionSummary(flagged);
assert.equal(flaggedSummary.evidenceState, "REVIEW REQUIRED");
assert.equal(flaggedSummary.disposition, "REVIEW TRIAL");
assert.equal(flaggedSummary.metrics[1].value, "3 sessions / 3 trades");
assert.equal(buildFleetDecisionSummary({ flagged, brief }, atlas.throughSession).lead?.disposition, "REVIEW TRIAL");
const story = deriveChannelLineupStory({ brief: flagged, summary: { slug: "test", sessions: 1, scored: 2, throughSession: atlas.throughSession } as ShadowChannelSummary, referenceSession: atlas.throughSession });
assert.equal(story.group, "REVIEW TRIAL", "low sample must not erase the contract alert in lineup cards");
console.log("channel-decision-brief selftest: PASS");
