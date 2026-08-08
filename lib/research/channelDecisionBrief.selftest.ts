import assert from "node:assert/strict";
import { buildChannelDecisionBriefs } from "./channelDecisionBrief";
import { buildDecisionAtlas, type AtlasInput } from "./decisionAtlas";
import { buildWeeklyReadout } from "./weeklyReadout";
import type { ProfitabilityLedger } from "../profitability/profitabilityLedger";

const opportunities: AtlasInput["opportunities"] = [
  { logicalOpportunityId: "a", id: "a", channel: "test", session: "2026-08-06", signalAt: "2026-08-06T14:00:00Z", exitAt: "2026-08-06T14:10:00Z", configurationEra: "current", portfolioConfigurationEra: "portfolio-a", managerVersion: "native", evidenceLayer: "exact_current_configuration", accountId: "paper", underlying: "SPY", occSymbol: "SPY-A", direction: "call", contractSelected: true, quoteEligible: true, admissionAllowed: true, filled: true, blockedReason: null, quantity: 2, entryPrice: 100, resultPerContractUsd: 30, returnPct: 30, mfePct: 50, maePct: -10, captureRatio: .6, stopExposurePerContractUsd: 30, sourceRefs: ["a"] },
  { logicalOpportunityId: "b", id: "b", channel: "test", session: "2026-08-06", signalAt: "2026-08-06T15:00:00Z", exitAt: "2026-08-06T15:10:00Z", configurationEra: "current", portfolioConfigurationEra: "portfolio-a", managerVersion: "native", evidenceLayer: "exact_current_configuration", accountId: "paper", underlying: "SPY", occSymbol: "SPY-B", direction: "call", contractSelected: true, quoteEligible: true, admissionAllowed: true, filled: true, blockedReason: null, quantity: 2, entryPrice: 100, resultPerContractUsd: -10, returnPct: -10, mfePct: 20, maePct: -20, captureRatio: -.5, stopExposurePerContractUsd: 30, sourceRefs: ["b"] },
];
const atlas = buildDecisionAtlas({ generatedAt: "2026-08-07T21:00:00Z", throughSession: "2026-08-07", opportunities, managerPaths: [], accountBudgets: [{ accountId: "paper", buyingPowerUsd: 10_000, maxConcurrentDebitUsd: 10_000, maxConcurrentStopExposureUsd: 10_000, maxOpenPositions: 10 }], activeChannels: ["test"], currentChannelConfigurationEras: { test: "current" } });
const ledger = { logicalTrades: [], evidence: { runnerRowsCollapsed: 0 } } as unknown as ProfitabilityLedger;
const weekly = buildWeeklyReadout({ ledger, virtualTrades: [], atlasChannels: atlas.channels, throughSession: "2026-08-07", generatedAt: "2026-08-07T21:00:00Z" });
const bundle = buildChannelDecisionBriefs({ atlas, weekly, opportunities, currentContractsByChannel: { test: 2 } });
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
console.log("channel-decision-brief selftest: PASS");
