import assert from "node:assert/strict";
import { collapseDailyLogicalTrades, type DailyDigestPositionRow } from "./logicalTradeDigest";

const row = (overrides: Partial<DailyDigestPositionRow>): DailyDigestPositionRow => ({
  id: "root", strategist_id: "alpha", runner_of: null, status: "closed", closed_at: "2026-08-07T15:00:00Z",
  realized_pnl: 100, configuration_epoch_id: "epoch", channel_spec_version_id: "spec", release_manifest_id: "manifest", ...overrides,
});
const rows = [row({}), row({ id: "runner", runner_of: "root", realized_pnl: -40, closed_at: "2026-08-07T16:00:00Z" })];
const routes = rows.map((item, index) => ({ id: `route-${index}`, position_id: item.id, account_id: "paper-a", event_at: "2026-08-07T14:00:00Z" }));
const result = collapseDailyLogicalTrades({ rows, routes, session: "2026-08-07", sessionOf: (iso) => iso.slice(0, 10) });
assert.equal(result.issues.length, 0);
assert.equal(result.groups.length, 1);
assert.equal(result.groups[0].realizedPnl, 60);
assert.equal(result.positionRows, 2);
assert.equal(result.runnerRows, 1);
assert.equal(collapseDailyLogicalTrades({ rows, routes: routes.slice(0, 1), session: "2026-08-07", sessionOf: (iso) => iso.slice(0, 10) }).groups.length, 0);
assert.match(collapseDailyLogicalTrades({ rows, routes: routes.slice(0, 1), session: "2026-08-07", sessionOf: (iso) => iso.slice(0, 10) }).issues[0], /immutable account route/);
const crossAccount = collapseDailyLogicalTrades({ rows, routes: [{ ...routes[0] }, { ...routes[1], account_id: "paper-b" }], session: "2026-08-07", sessionOf: (iso) => iso.slice(0, 10) });
assert.match(crossAccount.issues[0], /one immutable account route/);
const sameOccIndependent = collapseDailyLogicalTrades({
  rows: [row({ id: "a", occ_symbol: "SPY-SAME" }), row({ id: "b", strategist_id: "beta", occ_symbol: "SPY-SAME" })],
  routes: [{ id: "ra", position_id: "a", account_id: "paper-a", event_at: "2026-08-07T14:00:00Z" }, { id: "rb", position_id: "b", account_id: "paper-b", event_at: "2026-08-07T14:00:00Z" }],
  session: "2026-08-07", sessionOf: (iso) => iso.slice(0, 10),
});
assert.equal(sameOccIndependent.groups.length, 2, "same OCC in separate accounts remains independent");
console.log("daily-autopsy-logical-trade-selftest: PASS");
