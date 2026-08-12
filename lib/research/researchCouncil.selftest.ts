import assert from "node:assert/strict";
import type { ChannelDecisionBrief } from "./channelDecisionBrief";
import { buildResearchCouncil, RESEARCH_AGENTS, selectResearchCouncilBrief } from "./researchCouncil";

const brief = (channel: string, overrides: Partial<ChannelDecisionBrief> = {}): ChannelDecisionBrief => ({
  schemaVersion: 1,
  briefVersion: "channel-decision-brief-v1",
  channel,
  throughSession: "2026-08-11",
  generatedAt: "2026-08-11T22:00:00.000Z",
  recommendation: { axis: "promotion", label: "REVIEW PROMOTION", summary: "Entry evidence looks promising.", nextExperiment: "Run one bounded paper placement.", productionChangeAuthorized: false },
  metrics: [],
  executed: { state: "available", label: "LATEST EXECUTED ERA", configurationEra: "current", sessions: 2, logicalTrades: 2, positiveTrades: 0, typicalResultUsd: -12, totalResultUsd: -24, throughSession: "2026-08-11" },
  historicalVirtual: { state: "available", label: "HISTORICAL VIRTUAL", configurationEra: "legacy", sessions: 12, opportunities: 20, scored: 20, typicalResultPerContractUsd: 8, totalResultPerContractUsd: -40 },
  entryFrequency: { conclusion: "First entry is stronger.", rows: [], leadingBlock: { reason: "blocked_by_capital", opportunities: 9, scored: 7, typicalUsd: 11 } },
  nativeExit: { conclusion: "Collect.", typicalReturnPct: 0.1, typicalBestMovePct: 0.2, typicalCapture: 0.3, typicalGivebackPoints: 10, outlierShare: 0.5 },
  managers: { conclusion: "Native holds.", recommended: null, compared: [] },
  capacity: { conclusion: "No step.", currentContracts: 2, currentSizeObserved: true, bestSupportedContracts: null, points: [] },
  collision: { conclusion: "peer overlap", strongestOverlap: null, edges: [] },
  evidence: { decisionLayer: "prospective_virtual", configurationEra: "legacy", decisionSessions: 12, decisionOpportunities: 20, exactCurrentAvailable: false, layers: [], limitations: [] },
  ...overrides,
});

const packet = buildResearchCouncil({
  throughSession: "2026-08-11",
  generatedAt: "2026-08-11T22:00:00.000Z",
  briefs: { test: brief("test") },
});
assert.equal(RESEARCH_AGENTS.length, 7);
assert.equal(packet.summary.channelsReviewed, 1);
assert.ok(packet.dispatches.some((row) => row.agentId === "skeptic" && /PROMOTION CASE/.test(row.headline)));
assert.ok(packet.dispatches.some((row) => row.agentId === "skeptic" && /TYPICAL TRADE AND TOTAL/.test(row.headline)));
assert.ok(packet.dispatches.some((row) => row.agentId === "skeptic" && /CURRENT TRADES AND HISTORY/.test(row.headline)));
assert.ok(packet.dispatches.some((row) => row.agentId === "designer" && row.kind === "experiment"));
assert.ok(packet.dispatches.every((row) => row.message.length <= 168));
assert.ok(packet.dispatches.some((row) => /shadow ledger|blooper reel|Plot twist|subtweeting|moon|whale/.test(row.message)));
assert.equal(packet.productionWrites, 0);
assert.equal(packet.orderAuthority, false);
assert.equal(packet.configurationAuthority, false);
const briefing = selectResearchCouncilBrief(packet, 5);
assert.equal(briefing.length, 5);
assert.equal(briefing[0]?.kind, "decision");
assert.ok(briefing.some((row) => row.kind === "challenge"));
assert.ok(briefing.some((row) => row.kind === "finding"));
assert.ok(briefing.some((row) => row.kind === "experiment"));
console.log("researchCouncil.selftest: PASS");
