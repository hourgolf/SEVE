import assert from "node:assert/strict";
import { fixedLedgerId, fixedOrderCommand, fixedBuySeal, planFixedEntryCoverage, buildFixedEntryIntent, parseFixedEntryIntent,
  type FixedOrderCommand, type FixedOrderFill, type FixedCoverageRow } from "./fixedEntryLedgerModel.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";

const originalIntent = fixedEntryIntentFixture();
assert.deepEqual(parseFixedEntryIntent(JSON.parse(JSON.stringify(originalIntent))), originalIntent);
for (const modify of [
  (i: typeof originalIntent) => { i.quantity = 3 as 4; },
  (i: typeof originalIntent) => { i.accountId = "00000000-0000-4000-8000-000000000003"; },
  (i: typeof originalIntent) => { i.occ = "SPY260909C00640000"; },
  (i: typeof originalIntent) => { i.sourceBarAt = "2026-09-09T14:30:00Z"; },
  (i: typeof originalIntent) => { i.writeStamp.entry_policy = { ...i.writeStamp.entry_policy, premiumCap: 1.75 }; },
  (i: typeof originalIntent) => { i.writeStamp.configuration_epoch_id = `sha256:${"1".repeat(64)}`; },
]) { const altered = structuredClone(originalIntent); modify(altered); assert.equal(parseFixedEntryIntent(altered), null); }
const { protocol: _p, id: _i, sessionSlotId: _s, contentHash: _h, ...intentInput } = originalIntent;
const shiftedStrike = buildFixedEntryIntent({ ...intentInput, occ: "SPY260908C00641000" });
assert.equal(shiftedStrike.id, originalIntent.id, "a changed OCC must compete for the same session attempt slot");
assert.notEqual(shiftedStrike.contentHash, originalIntent.contentHash);
assert.notEqual(buildFixedEntryIntent({ ...intentInput, attempt: 1, predecessorIntentId: originalIntent.id,
  predecessorSettlementHash: `sha256:${"1".repeat(64)}` }).id, originalIntent.id);
const nextDate = buildFixedEntryIntent({ ...intentInput, sessionDateEt: "2026-09-09",
  sourceBarAt: "2026-09-09T14:30:00Z", createdAt: "2026-09-09T14:30:01Z", occ: "SPY260909C00640000" });
assert.equal(nextDate.id, originalIntent.id, "new session must not create an independent slot around an unresolved predecessor");

const intentId = fixedLedgerId("intent-test", ["account", "session"]);
const buy = fixedOrderCommand({ intentId, side: "buy", sequence: 0, quantity: 4 });
const sell = fixedOrderCommand({ intentId, side: "sell", sequence: 0, quantity: 2 });
const snapshot = (command: FixedOrderCommand, qty: number, basis: string | null,
  status = qty === command.quantity ? "filled" : "canceled"): FixedOrderFill => ({ commandId: command.id,
  brokerOrderId: `broker-${command.id}`, clientOrderId: command.clientOrderId,
  side: command.side, requestedQty: command.quantity,
  filledQty: qty, averageFillPrice: basis, status });
const row = (qty: number, basis: string, status: "open" | "closed" = "open",
  generation = 0): FixedCoverageRow => ({ id: fixedLedgerId("row", [intentId, generation]),
  intentId, status, qty, avgEntryPrice: basis });
const plan = (fills: FixedOrderFill[], rows: FixedCoverageRow[], brokerNetQty: number,
  commands: FixedOrderCommand[] = [buy]) => planFixedEntryCoverage({ intentId, commands, fills, rows, brokerNetQty });

// Exact command identity is shared by competing workers, even if snapshots
// imply different requested sell quantity. Persistence chooses one winner.
assert.equal(fixedOrderCommand({ ...sell, quantity: 4 }).id, sell.id);
assert.notEqual(fixedOrderCommand({ ...sell, sequence: 1 }).id, sell.id);
assert.notEqual(buy.id, sell.id);
assert.equal(fixedBuySeal({ intentId, sequence: 0, reason: "exit-required" }).id, buy.id);
assert.ok(buy.clientOrderId.length < 48);

let result = plan([], [], 0);
assert.equal(result.state, "unresolved");
assert.deepEqual(result.blockers, ["unknown-command-outcome"]);
assert.equal(result.buyTerminal, false);
assert.equal(result.sessionEntryConsumed, false);
assert.equal(result.coverageRequired, false);

result = plan([snapshot(buy, 0, null, "new")], [], 0);
assert.equal(result.state, "ready"); // known zero; command is still working
assert.equal(result.buyTerminal, false);
result = plan([snapshot(buy, 2, "2", "partially_filled")], [], 2);
assert.equal(result.netQty, 2); assert.equal(result.coverageRequired, true);
assert.deepEqual(result.remainingBasis, { numerator: "4", divisor: 2 });
assert.equal(result.sessionEntryConsumed, true);
assert.equal(result.buyTerminal, false);

// Late fills expand the sole open row to the new weighted basis.
result = plan([snapshot(buy, 4, "3")], [row(2, "2")], 4);
assert.equal(result.state, "ready"); assert.equal(result.coverageRequired, true);
assert.deepEqual(result.remainingBasis, { numerator: "12", divisor: 4 });

// A stop already sold the first two at their original $2 basis. Late two
// contracts arrive at $4. Preserve the closed row and allocate $8 to remainder.
const closed = row(2, "2", "closed"), before = structuredClone(closed);
result = plan([snapshot(buy, 4, "3"), snapshot(sell, 2, "1")], [closed], 2, [buy, sell]);
assert.equal(result.state, "ready"); assert.equal(result.closedEntryCost, "4");
assert.deepEqual(result.remainingBasis, { numerator: "8", divisor: 2 });
assert.equal(result.coverageRequired, true);
assert.deepEqual(closed, before, "closed P&L inputs remain immutable");

// An unresolved sell blocks coverage rewrites; a terminal unbooked sell must
// first be booked against its frozen row before the remainder is rewritten.
result = plan([snapshot(buy, 4, "3"), snapshot(sell, 1, "1", "partially_filled")], [row(2, "2")], 3, [buy, sell]);
assert.ok(result.blockers.includes("sell-not-terminal"));
assert.ok(result.blockers.includes("sell-booking-incomplete"));
result = plan([snapshot(buy, 4, "3"), snapshot(sell, 2, "1")], [row(4, "3")], 2, [buy, sell]);
assert.ok(result.blockers.includes("sell-booking-incomplete"));

result = plan([snapshot(buy, 2, "2", "canceled")], [row(2, "2")], 2);
assert.equal(result.buyTerminal, true); assert.equal(result.coverageRequired, false);
result = plan([snapshot(buy, 0, null, "canceled")], [], 0);
assert.equal(result.buyTerminal, true); assert.equal(result.sessionEntryConsumed, false);
result = plan([snapshot(buy, 2, "2")], [], 1);
assert.ok(result.blockers.includes("broker-attribution-mismatch"));
result = plan([snapshot(buy, 4, "3")], [row(2, "2"), row(2, "4", "open", 1)], 4);
assert.ok(result.blockers.includes("multiple-open-rows"));
result = plan([snapshot(buy, 2, "2", "partially_filled")], [row(4, "2")], 2);
assert.ok(result.blockers.includes("materialized-fill-regression"), "stale broker data cannot shrink already-known coverage");
result = plan([snapshot(buy, 4, "2")], [row(4, "3")], 4);
assert.ok(result.blockers.includes("materialized-fill-regression"), "same-quantity cost cannot regress below known basis");
result = plan([snapshot(buy, 4, "2")], [row(2, "3")], 4);
assert.equal(result.state, "ready", "additional cheaper fills may legitimately lower average basis");
result = planFixedEntryCoverage({ intentId, commands: [buy], fills: [snapshot(buy, 2, "2", "partially_filled")],
  rows: [], brokerNetQty: 2, previousTotals: { boughtQty: 4, soldQty: 0, cumulativeBuyCost: "8" } });
assert.ok(result.blockers.includes("cumulative-fill-regression"), "a prior receipt remains a floor when row insertion failed");

// Do not silently round exact cumulative broker decimals or invent a basis.
result = plan([snapshot(buy, 3, "1.333333333", "canceled")], [], 3);
assert.deepEqual(result.remainingBasis, { numerator: "3.999999999", divisor: 3 });
assert.equal(result.databaseBasis, "1.3333");
assert.equal(result.basisRoundingResidual, "0.000099999");
result = plan([snapshot(buy, 3, "1.333333333", "canceled")], [row(3, "1.3333")], 3);
assert.equal(result.coverageRequired, false, "database precision must not cause endless recovery writes");
for (const fills of [
  [snapshot(buy, 5, "2")], [snapshot(buy, .5, "2")],
  [snapshot(buy, 2, null)], [snapshot(buy, 2, "NaN")],
  [snapshot(buy, 2, "1.1234567891")], [snapshot(buy, 2, "-1")],
  [snapshot(buy, 2, "2"), snapshot(buy, 2, "2")],
  [{ ...snapshot(buy, 2, "2"), clientOrderId: "unregistered" }],
]) assert.throws(() => plan(fills, [], 2));
assert.throws(() => plan([snapshot(sell, 2, "1")], [], 0, [buy, sell]), /oversell/);
assert.throws(() => plan([snapshot(buy, 2, "2", "filled")], [], 2), /filled_status_quantity/);
const gap = fixedOrderCommand({ intentId, side: "sell", sequence: 2, quantity: 1 });
assert.throws(() => plan([], [], 0, [buy, gap]), /sequence_gap/);
assert.throws(() => plan([snapshot(buy, 2, "2")], [{ ...row(2, "2"), intentId: fixedLedgerId("other", [1]) }], 2), /row_lineage/);
console.log("fixedEntryLedgerModel: PASS · partial/late fills, closed basis preservation, pending sells, exact decimals and attribution failures");
