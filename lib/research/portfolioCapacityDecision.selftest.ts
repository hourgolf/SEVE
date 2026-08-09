import assert from "node:assert/strict";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { AtlasOpportunity, DecisionAtlas } from "./decisionAtlas";
import { buildPortfolioCapacityDecisionPacket } from "./portfolioCapacityDecision";

const opportunity = (id: string, session: string, at: string): AtlasOpportunity => ({ logicalOpportunityId: id, id,
  channel: "alpha", session, signalAt: `${session}T${at}Z`, exitAt: `${session}T15:00:00Z`,
  configurationEra: "era", portfolioConfigurationEra: "portfolio", managerVersion: null,
  evidenceLayer: "exact_current_configuration", accountId: "a", underlying: "SPY", occSymbol: `${id}-OCC`,
  direction: "call", contractSelected: true, quoteEligible: true, admissionAllowed: true, filled: true,
  blockedReason: null, quantity: 1, entryPrice: 1, resultPerContractUsd: 10, returnPct: 10,
  mfePct: 15, maePct: -5, captureRatio: 0.67, stopExposurePerContractUsd: 30, sourceRefs: [] });
const opportunities = Array.from({ length: 10 }, (_, index) => opportunity(`o${index}`, `2026-08-0${(index % 5) + 1}`, `14:${String(index).padStart(2, "0")}:00`));
const atlas = { generatedAt: "2026-08-08T20:00:00Z", throughSession: "2026-08-07", collisionGraph: [],
  channels: { alpha: { decisionCohort: { evidenceLayer: "exact_current_configuration", configurationEra: "era" } } } } as unknown as DecisionAtlas;
const briefs = { channels: { alpha: { channel: "alpha", capacity: { currentContracts: 1, currentSizeObserved: true, bestSupportedContracts: 2 },
  evidence: { decisionSessions: 5, decisionOpportunities: 10 }, recommendation: { axis: "size" } } } } as unknown as ChannelDecisionBriefBundle;
const packet = buildPortfolioCapacityDecisionPacket({ atlas, briefs, opportunities,
  accountBudgets: [{ accountId: "a", buyingPowerUsd: 100_000, maxConcurrentDebitUsd: 10_000,
    maxConcurrentStopExposureUsd: 5_000, maxOpenPositions: 10 }] });
assert.equal(packet.channels.alpha.state, "ready_for_paper_review");
assert.equal(packet.channels.alpha.proposedContracts, 2);
assert.equal(packet.channels.alpha.preferredAccountId, "a");
assert.equal(packet.orderAuthority, false);
console.log("portfolio-capacity-decision-selftest: PASS");
