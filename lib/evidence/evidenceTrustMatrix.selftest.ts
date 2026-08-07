import assert from "node:assert/strict";
import { evidenceEnvelope } from "./evidenceEnvelope";
import { attributePositionsByImmutableExecutionAccount } from "../ops/brokerReconciliation";
import { buildProfitabilityLedger, type ProfitabilityPositionRow } from "../profitability/profitabilityLedger";
import { buildProfitabilityReport } from "../profitability/profitabilityMetrics";
import { buildWeeklyReadout } from "../research/weeklyReadout";

const position = (id: string, accountSuffix: string, pnl: number, closedAt: string): ProfitabilityPositionRow => ({
  id, strategist_id: `strategist-${accountSuffix}`, channel_slug: `channel-${accountSuffix}`, underlying: "SPY",
  occ_symbol: "SPY260807C00650000", status: "closed", qty: 1, avg_entry_price: 1, realized_pnl: pnl,
  opened_at: "2026-08-07T14:00:00.000Z", closed_at: closedAt, close_reason: "native_exit",
  peak_mark: 1.5, trough_mark: 0.8, runner_of: null, entry_reason: "signal", entry_features: null,
  channel_spec_version_id: `spec-${accountSuffix}`, release_manifest_id: "manifest-1", configuration_epoch_id: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});
const positions = [
  position("position-a", "a", 30, "2026-08-07T15:00:00.000Z"),
  position("position-b", "b", -20, "2026-08-07T16:00:00.000Z"),
];
const observations = positions.map((row, index) => ({
  id: `route-${index}`, position_id: row.id, opportunity_id: null, account_id: `account-${index ? "b" : "a"}`, event_at: "2026-08-07T14:00:01.000Z",
}));
const attribution = attributePositionsByImmutableExecutionAccount({
  positions, observations, configuredPaperAccountIds: new Set(["account-a", "account-b"]), positionLabel: "fixture positions",
});
assert.equal(attribution.ok, true);
assert.equal(attribution.byAccount.size, 2, "same OCC positions in separate accounts retain independent identity");
assert.notEqual(positions[0].closed_at, positions[1].closed_at, "independent exits remain distinct");
const missing = attributePositionsByImmutableExecutionAccount({
  positions, observations: observations.slice(0, 1), configuredPaperAccountIds: new Set(["account-a", "account-b"]), positionLabel: "fixture positions",
});
assert.equal(missing.ok, false);
assert.deepEqual(missing.missingPositionIds, ["position-b"], "missing attribution fails closed");

const ledger = buildProfitabilityLedger({
  accounts: [{ id: "account-a", name: "PAPER A", mode: "paper" }, { id: "account-b", name: "PAPER B", mode: "paper" }],
  positions, outcomes: [], executionRoutes: observations, executionQuality: [], managerShadow: [],
  equityDaily: [{ et_date: "2026-08-06", nav: 10_000 }, { et_date: "2026-08-07", nav: 10_100 }],
});
assert.equal(ledger.logicalTrades.length, 2, "same OCC across accounts is not collapsed");
assert.equal(new Set(ledger.logicalTrades.map((trade) => trade.accountId)).size, 2);
const report = buildProfitabilityReport(ledger, "2026-08-07");
assert.equal(report.periods.week.actualPortfolio.navChangeUsd, 100, "broker NAV delta remains actual portfolio truth");
assert.equal(report.periods.week.deskBrokerCongruence.bookedLogicalTradePnlUsd, 10, "desk logical P&L remains separate from NAV delta");
assert.equal(report.periods.week.deskBrokerCongruence.differenceUsd, 90);

const outlierLedger = { ...ledger, logicalTrades: [-10, -10, 1_000].map((pnl, index) => ({
  ...ledger.logicalTrades[0], id: `outlier-${index}`, rootPositionId: `outlier-${index}`, positionIds: [`outlier-${index}`],
  realizedPnlUsd: pnl, openedAt: `2026-08-0${index + 5}T14:00:00Z`, closedAt: `2026-08-0${index + 5}T15:00:00Z`,
})) };
const weekly = buildWeeklyReadout({ ledger: outlierLedger, virtualTrades: [], atlasChannels: {}, throughSession: "2026-08-07", generatedAt: "2026-08-07T21:00:00Z" });
assert.equal(weekly.executed[0].typicalResultUsd, -10, "typical result resists one large winner");
assert.equal(weekly.executed[0].totalResultUsd, 980, "total remains visible but does not replace typical result");

const partial = evidenceEnvelope({
  layer: "current_executed", unit: "logical_trade", fromSession: "2026-08-07", throughSession: "2026-08-07",
  configurationEpochId: null, managerVersion: null, scope: { kind: "portfolio", accountIds: ["account-a", "account-b"], channelSlugs: ["channel-a", "channel-b"] },
  completeness: "partial", reconciliation: "blocked", source: "fixture", receiptHash: null,
  limitations: ["one route read failed"], asOf: "2026-08-07T21:00:00Z",
});
assert.equal(partial.completeness, "partial");
assert.equal(partial.reconciliation, "blocked");
console.log("evidence-trust-matrix-selftest: PASS");
