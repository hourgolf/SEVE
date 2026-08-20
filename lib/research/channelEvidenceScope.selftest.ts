import assert from "node:assert/strict";
import { axisCompatibilitySignature, axisCompatible, deriveChannelEvidenceScopes, type ChannelBehaviorIdentity } from "./channelEvidenceScope";
import type { ChannelDecisionBrief } from "./channelDecisionBrief";

const identity = (overrides: Partial<ChannelBehaviorIdentity> = {}): ChannelBehaviorIdentity => ({
  strategyId: "orb", strategyVersion: "1", signalVersion: "1", underlying: "SPY", optionRight: "C",
  dte: 0, strikeSelection: { offset: 0 }, entryParameters: { start: 630 }, exitParameters: { stop: 30, target: 13 },
  managerVersion: "b30-a13", quoteCoverageVersion: "quotes-v1", quantity: 4,
  channelSpecVersionId: "spec-a", portfolioConfigurationEra: "portfolio-a", releaseManifestId: "release-a",
  route: "paper-3", priority: 1, ...overrides,
});

const base = identity();
const receiptOnly = identity({ portfolioConfigurationEra: "portfolio-b", releaseManifestId: "release-b", route: "paper-2", priority: 7 });
assert.equal(axisCompatible(base, receiptOnly, "entry"), true, "receipt, route and priority churn must not reset entry evidence");
assert.equal(axisCompatible(base, receiptOnly, "exit"), true, "receipt churn must not reset exit evidence");
assert.equal(axisCompatible(base, receiptOnly, "capacity"), false, "capacity stays portfolio-era aware");
assert.equal(axisCompatible(base, identity({ quantity: 6 }), "size"), true, "quantity-only changes retain per-contract evidence");
assert.equal(axisCompatible(base, identity({ entryParameters: { start: 645 } }), "entry"), false, "genuine entry changes start a new exact cohort");
assert.equal(axisCompatible(base, identity({ managerVersion: "lock50-30" }), "entry"), true, "manager-only changes retain entry evidence");
assert.equal(axisCompatible(base, identity({ managerVersion: "lock50-30" }), "manager"), true, "manager comparisons are paired by compatible opportunity and quote coverage");
assert.notEqual(axisCompatibilitySignature(base, "exit"), axisCompatibilitySignature(identity({ exitParameters: { stop: 20, target: 22 } }), "exit"));

const brief = {
  channel: "orb-ustop-ctl", recommendation: { axis: "exit" },
  executed: { state: "available", sessions: 23, logicalTrades: 46 },
  historicalVirtual: { state: "available", sessions: 28, scored: 83 },
  evidence: {
    decisionLayer: "exact_current_configuration", decisionSessions: 1, decisionOpportunities: 2, exactCurrentAvailable: true,
    layers: [
      { layer: "actual_portfolio", sessions: 23, opportunities: 46 },
      { layer: "structural_history", sessions: 28, opportunities: 60 },
      { layer: "prospective_virtual", sessions: 28, opportunities: 83 },
      { layer: "exact_current_configuration", sessions: 1, opportunities: 2 },
    ],
  },
} as unknown as ChannelDecisionBrief;
const scopes = deriveChannelEvidenceScopes(brief, { sessions: 23, opportunities: 137, fromSession: "2026-07-20", throughSession: "2026-08-19" });
assert.deepEqual([scopes.current.sessions, scopes.current.opportunities], [1, 2]);
assert.deepEqual([scopes.all.sessions, scopes.all.opportunities], [28, 83]);
assert.deepEqual(scopes.sources.map((source) => [source.label, source.sessions, source.opportunities]), [
  ["ACTUAL EXECUTED", 23, 46], ["STRUCTURAL HISTORY", 28, 60], ["PROSPECTIVE VIRTUAL", 28, 83], ["EXACT CURRENT", 1, 2],
]);
assert.match(scopes.countExplanation ?? "", /137 virtual paths/);
assert.match(scopes.countExplanation ?? "", /2 axis-compatible opportunities/);

const curlBrief = {
  ...brief,
  channel: "vb-curl-reversal-qqq",
  recommendation: { axis: "entry" },
  historicalVirtual: { state: "available", sessions: 33, scored: 197 },
  evidence: {
    decisionLayer: "prospective_virtual", decisionSessions: 33, decisionOpportunities: 197, exactCurrentAvailable: false,
    layers: [{ layer: "prospective_virtual", sessions: 33, opportunities: 197 }],
  },
} as unknown as ChannelDecisionBrief;
const curlScopes = deriveChannelEvidenceScopes(curlBrief, {
  sessions: 23, opportunities: 137, fromSession: "2026-07-20", throughSession: "2026-08-19",
});
assert.match(curlScopes.countExplanation ?? "", /ledger shows 23 sessions \/ 137 virtual paths/i);
assert.match(curlScopes.countExplanation ?? "", /Atlas uses 33 sessions \/ 197 axis-compatible opportunities/i);
console.log("channel-evidence-scope-selftest: PASS");
