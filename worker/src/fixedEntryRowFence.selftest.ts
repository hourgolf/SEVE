import assert from "node:assert/strict";
import { fixedLedgerId } from "./fixedEntryLedgerModel.js";
import { fixedRowId, fixedCoverageCas, fixedReserveSellCas, fixedBookSellCas,
  fixedRowCasMatches, type FixedFencedRow } from "./fixedEntryRowFence.js";
const intentId = fixedLedgerId("test-intent", [1]);
const initial: FixedFencedRow = { id: fixedRowId(intentId, 0), status: "open", qty: 2, avg_entry_price: 2,
  entry_features: { receipt_bound_entry_policy: { fixture: "original" }, fixed_entry_coverage: {
    protocol: "fixed-entry-row-v1", intentId, generation: 0, revision: 0, activeSellCommandId: null } } };
const commandId = fixedLedgerId("test-sell", [intentId]);
const reserve = fixedReserveSellCas(initial, commandId);
const expand = fixedCoverageCas(initial, 4, 3);
let actual: FixedFencedRow = { ...initial, ...expand.update } as FixedFencedRow;
assert.equal(fixedRowCasMatches(actual, reserve.expected), false, "late fill won first: stale exit reservation must fail before POST");
actual = { ...initial, ...reserve.update } as FixedFencedRow;
assert.equal(fixedRowCasMatches(actual, expand.expected), false, "sell reservation won first: stale recovery must fail");
assert.throws(() => fixedCoverageCas(actual, 4, 3), /sell_owns_row/);
const close = fixedBookSellCas({ row: actual, commandId, soldQty: 2, exitPrice: 1, closedAt: "2026-09-08T14:31:00Z", reason: "stop_premium" });
assert.equal(fixedRowCasMatches(actual, close.expected), true);
const closed = { ...actual, ...close.update } as FixedFencedRow;
assert.equal(fixedRowCasMatches(closed, close.expected), false, "second worker cannot book twice");
assert.equal(fixedRowCasMatches(closed, expand.expected), false, "late recovery cannot reopen closed history");
assert.throws(() => fixedCoverageCas(closed, 4, 3), /not_open/);
assert.equal(closed.qty, 2);
assert.equal(closed.avg_entry_price, 2);
assert.equal(close.update.realized_pnl, -200, "P&L is derived from command-frozen basis and actual sold quantity");
assert.throws(() => fixedCoverageCas({ ...initial, qty: 4 }, 2, 2), /coverage_value/);
assert.throws(() => fixedCoverageCas(initial, 2, 1), /coverage_value/);
assert.deepEqual(closed.entry_features.receipt_bound_entry_policy, initial.entry_features.receipt_bound_entry_policy);
const partial = fixedBookSellCas({ row: actual, commandId, soldQty: 1, exitPrice: 1,
  closedAt: "2026-09-08T14:31:00Z", reason: "stop_premium" });
assert.equal(partial.update.qty, 1, "terminal partial sell closes only sold quantity; remainder requires its next deterministic row");
assert.notEqual(fixedRowId(intentId, 0), fixedRowId(intentId, 1));
const identified = { ...initial, strategist_id: "original", opened_at: "2026-09-08T14:30:00.000Z" };
assert.equal(fixedRowCasMatches({ ...identified, strategist_id: "changed" } as FixedFencedRow, identified), false);
assert.equal(fixedRowCasMatches({ ...identified, opened_at: "2026-09-08T10:30:00-04:00" } as FixedFencedRow, identified), true);
assert.throws(() => fixedBookSellCas({ row: actual, commandId: "wrong", soldQty: 2, exitPrice: 1,
  closedAt: "2026-09-08T14:31:00Z", reason: "stop_premium" }), /booking_invalid/);
console.log("fixedEntryRowFence: PASS · recovery/exit races, stale close, duplicate booking and original policy preservation");
