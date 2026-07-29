import assert from "node:assert/strict";
import { deriveAccountCongruentEquity } from "../../supabase/functions/_shared/accountEquity";

const rows = [
  { account_id: null, net_liquidation: 88_000, captured_at: "2026-07-20T20:59:00Z" },
  { account_id: "a", net_liquidation: 100, captured_at: "2026-07-20T19:59:58Z" },
  { account_id: "b", net_liquidation: 200, captured_at: "2026-07-20T19:59:59Z" },
  { account_id: "c", net_liquidation: 300, captured_at: "2026-07-20T20:00:00Z" },
  // The first row of the next capture cohort must not combine with stale peers.
  { account_id: "a", net_liquidation: 110, captured_at: "2026-07-21T19:59:58Z" },
  { account_id: "b", net_liquidation: 220, captured_at: "2026-07-21T19:59:59Z" },
  { account_id: "c", net_liquidation: 330, captured_at: "2026-07-21T20:00:00Z" },
];

const series = deriveAccountCongruentEquity(rows, ["a", "b", "c"], ["2026-07-20", "2026-07-21"]);
assert.deepEqual(series.daily, [
  { date: "2026-07-20", nav: 600 },
  { date: "2026-07-21", nav: 660 },
]);
assert.equal(series.maxDrawdown, 0);
assert.ok(series.points.every((point) => point.nav < 1_000), "unscoped legacy snapshots must be excluded");

assert.throws(
  () => deriveAccountCongruentEquity(rows.filter((row) => row.account_id !== "c"), ["a", "b", "c"], ["2026-07-20"]),
  /account-complete equity snapshots missing/,
);
assert.throws(
  () => deriveAccountCongruentEquity(rows, [], ["2026-07-20"]),
  /configured paper accounts unavailable/,
);

console.log("account-equity-selftest: account-complete aggregation passed");
