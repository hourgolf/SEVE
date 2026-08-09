import assert from "node:assert/strict";
import type { ChannelDecisionBriefBundle } from "./channelDecisionBrief";
import type { DecisionAtlas } from "./decisionAtlas";
import type { DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { buildExecutionCapacityReadiness } from "./executionCapacityReadiness";

const point = (contracts: number, marginal: number | null) => ({ contracts,
  marginalPortfolioResultVsOneContractUsd: marginal, displacedByChannel: [],
  additionalDisplacedOtherOpportunitiesVsOneContract: 0, portfolioTotalResultUsd: contracts * 100 });
const atlas = { generatedAt: "2026-08-08T20:00:00.000Z", throughSession: "2026-08-08",
  channels: { alpha: { capacity: { bestSupportedContracts: 3, points: [point(2, 20), point(3, 35)] } } } } as unknown as DecisionAtlas;
const briefs = { channels: { alpha: { capacity: { currentContracts: 2, currentSizeObserved: true },
  evidence: { decisionSessions: 6, decisionOpportunities: 14 } } } } as unknown as ChannelDecisionBriefBundle;
const snapshot = { executionObservations: [{ id: "d", trace_id: "t", event_kind: "decision" },
  { id: "b", trace_id: "t", event_kind: "broker_result", filled_qty: 1, position_id: "p" }],
  ledger: { logicalTrades: [] } } as unknown as DecisionAtlasSourceSnapshot;
const result = buildExecutionCapacityReadiness({ atlas, briefs, snapshot });
assert.equal(result.execution.state, "pass");
assert.equal(result.channels.alpha.state, "paper_step_ready");
assert.equal(result.channels.alpha.proposedContracts, 3);
assert.equal(result.channels.alpha.marginalPortfolioResultUsd, 100);
assert.equal(result.channels.alpha.productionChangeAuthorized, false);
const broken = buildExecutionCapacityReadiness({ atlas, briefs, snapshot: {
  ...snapshot, executionObservations: [{ id: "orphan", trace_id: "x", event_kind: "broker_result", filled_qty: 1 }],
} as unknown as DecisionAtlasSourceSnapshot });
assert.equal(broken.execution.state, "block");
assert.equal(broken.channels.alpha.state, "hold");
console.log("execution-capacity-readiness-selftest: PASS");
