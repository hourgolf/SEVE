import assert from "node:assert/strict";
import type { AtlasVirtualTradeRow, DecisionAtlasSourceSnapshot } from "./decisionAtlasAdapter";
import { REVIEWED_VIRTUAL_TRADE_REPAIRS } from "./reviewedVirtualTradeRepairs";
import { assertReviewedVirtualTradeRepairs } from "./reviewedVirtualTradeRepairGuard";
import { prepareAtlasReportScope } from "./atlasReportScope";

const repaired = REVIEWED_VIRTUAL_TRADE_REPAIRS.map(repair => ({
  signal_id: repair.signalId, signal_at: "2026-09-04T14:00:00Z", ...repair.economics,
})) as AtlasVirtualTradeRow[];
const snapshot = { virtualTrades: repaired, signals: [] };
assertReviewedVirtualTradeRepairs(snapshot);
const before = JSON.stringify(snapshot);
const first = repaired[0];
for (const field of Object.keys(REVIEWED_VIRTUAL_TRADE_REPAIRS[0].economics)) {
  const changed = { ...first, [field]: field === "exit_at" ? "2026-09-04T19:59:59Z"
    : field === "exit_reason" ? "unapproved" : 987654321 };
  assert.throws(() => assertReviewedVirtualTradeRepairs({ ...snapshot, virtualTrades: [changed, ...repaired.slice(1)] }), /repair regressed/);
}
assert.throws(() => assertReviewedVirtualTradeRepairs({ virtualTrades: [], signals: [{id:first.signal_id}] as DecisionAtlasSourceSnapshot["signals"] }), /missing/);
assert.throws(() => assertReviewedVirtualTradeRepairs({ ...snapshot, virtualTrades: [...repaired, first] }), /duplicate/);
assertReviewedVirtualTradeRepairs({ virtualTrades: [], signals: [] });
assertReviewedVirtualTradeRepairs({ virtualTrades: [{...first, signal_id:"unreviewed", pnl_per_contract:999}], signals: [] });
const formatted = repaired.map(row => ({ ...row,
  exit_at: row.exit_at?.replace("Z", "+00:00") ?? null,
  pnl_per_contract: row.pnl_per_contract == null ? null : String(row.pnl_per_contract),
}));
assertReviewedVirtualTradeRepairs({ ...snapshot, virtualTrades: formatted });
for (const invalid of ["", " ", false, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
  assert.throws(() => assertReviewedVirtualTradeRepairs({ ...snapshot, virtualTrades: [{...first,pnl_per_contract:invalid} as AtlasVirtualTradeRow] }), /regressed/);
}
// A report through Tuesday must still reject an observed Friday regression
// before any current-session eligibility or scoring can approve that report.
const source = {virtualTrades:repaired,signals:[],strategists:[]} as unknown as DecisionAtlasSourceSnapshot;
const scoped = prepareAtlasReportScope({snapshot:source,throughSession:"2026-09-08",historical:[]});
assert.deepEqual(new Set(scoped.snapshot.virtualTrades),new Set(repaired));
assert.throws(() => prepareAtlasReportScope({snapshot:{...source,virtualTrades:[{...first,pnl_per_contract:123456}]},throughSession:"2026-09-08",historical:[]}), /repair regressed/);
assert.equal(JSON.stringify(snapshot),before,"guard never changes source evidence");
console.log("reviewed-virtual-trade-repair: PASS · approved economics retained; eight-column drift, missing, duplicate, malformed and cross-session regressions rejected without mutation");
