import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand, fixedLedgerId } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, parseFixedProtocolRecord,
  type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { coordinateFixedCommand, type FixedCommandClaim, type FixedCommandPorts, type FixedBrokerOrder } from "./fixedEntryCommandCoordinator.js";
import { authorizeFixedCommandChain, type FixedChainSnapshot } from "./fixedEntryChainAuthorization.js";
import { requestFixedIntentExit, type FixedIntentExitRequest } from "./fixedEntryExitRequest.js";
import { bookFixedSellCommand, type FixedEconomicRow, type FixedSellBookingPorts } from "./fixedEntrySellBooking.js";
import { fixedRowId, fixedRowCasMatches, fixedFencedProjection, fixedReserveSellCas } from "./fixedEntryRowFence.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
async function main() {
  const intent = fixedEntryIntentFixture();
  const db = new Map<string, ExecutionObservationDraft>();
  const rows = new Map<string, FixedEconomicRow>();
  const broker = new Map<string, FixedBrokerOrder>();
  let held = 0, posts = 0, currentBuyFill = 2;
  const now = () => Date.parse("2026-09-08T14:30:03.000Z");
  const storage: ImmutableClaimStorage = {
    async insert(row) { if (db.has(row.id)) return "existing"; db.set(row.id, structuredClone(row)); return "inserted"; },
    async read(id) { return structuredClone(db.get(id) ?? null); },
  };
  const original = fixedProtocolObservation(intent, fixedProtocolRecord({ id: intent.id, intentId: intent.id,
    kind: "intent", recordedAt: intent.createdAt, body: { intent } }));
  db.set(original.id, original);
  const snapshot = (): FixedChainSnapshot => ({ records: [...db.values()].map(r => parseFixedProtocolRecord(r.payload.fixed_entry_record)!),
    rows: [...rows.values()].map(r => structuredClone(r)), brokerNetQty: held, brokerObservedAtMs: now(), nowMs: now() });
  const makeClaim = (side: "buy" | "sell", sequence: number, qty: number, row: FixedEconomicRow | null = null): FixedCommandClaim => {
    const command = fixedOrderCommand({ intentId: intent.id, side, sequence, quantity: qty });
    return { command, request: { symbol: intent.occ, qty: String(qty), side, type: "market", time_in_force: "day",
      client_order_id: command.clientOrderId }, expiresAt: "2026-09-08T14:30:30.000Z", sellRow: row,
      exitReason: side === "sell" ? "stop_premium" : null };
  };
  const bookPorts: FixedSellBookingPorts = { storage, now, readRow: async id => structuredClone(rows.get(id) ?? null),
    async cas(change) {
      const row = rows.get(change.expected.id);
      if (!row || !fixedRowCasMatches(row, change.expected)) return { state: "lost-race", row: null };
      const after = { ...row, ...structuredClone(change.update) } as FixedEconomicRow;
      rows.set(after.id, after); return { state: "applied", row: fixedFencedProjection(after) };
    } };
  const ports: FixedCommandPorts = { storage, now, reserveSell: bookPorts.cas,
    authorizeFresh: async (_intent, claim) => authorizeFixedCommandChain(_intent, claim, snapshot()).allowed,
    lookupExact: async (_account, coid) => structuredClone(broker.get(coid) ?? null),
    submitOnce: async (_account, request) => {
      posts++;
      const qty = request.side === "buy" ? currentBuyFill : Number(request.qty);
      held += request.side === "buy" ? qty : -qty;
      const order: FixedBrokerOrder = { id: fixedLedgerId("broker-fixture", [request.client_order_id]),
        client_order_id: request.client_order_id, symbol: request.symbol, qty: request.qty, side: request.side,
        filled_qty: String(qty), filled_avg_price: request.side === "buy" ? "2" : "1",
        status: qty === Number(request.qty) ? "filled" : "partially_filled" };
      broker.set(request.client_order_id, order); return order;
    } };
  const materialize = (generation: number, qty: number, basis: number) => {
    const row: FixedEconomicRow = { id: fixedRowId(intent.id, generation), status: "open", qty, avg_entry_price: basis,
      current_mark: basis, realized_pnl: null, unrealized_pnl: 0, closed_at: null, close_reason: null,
      entry_features: { receipt_bound_entry_policy: intent.writeStamp.entry_policy, fixed_entry_coverage: {
        protocol: "fixed-entry-row-v1", intentId: intent.id, generation, revision: 0, activeSellCommandId: null } } };
    rows.set(row.id, row); return structuredClone(row);
  };
  const buy = makeClaim("buy", 0, 4);
  assert.equal(authorizeFixedCommandChain(intent, buy, snapshot()).allowed, true);
  assert.equal(authorizeFixedCommandChain(intent, { ...buy, request: { ...buy.request, type: "limit", limit_price: "2" } }, snapshot()).reason,
    "outside-original-buy-plan");
  assert.equal((await coordinateFixedCommand(ports, intent, buy)).state, "observed");
  assert.equal(posts, 1); assert.equal(held, 2);
  const row = materialize(0, 2, 2);
  const sell = makeClaim("sell", 0, 2, row);
  assert.equal(authorizeFixedCommandChain(intent, sell, snapshot()).reason, "original-exit-cause-not-latched");
  const exits = await Promise.all(Array.from({ length: 12 }, (_, index) => requestFixedIntentExit(storage, intent, {
    source: index === 0 ? "native-manager" : "manual", reason: index === 0 ? "stop_premium" : "manual",
    requestedAt: new Date(now() + index).toISOString() })));
  assert.ok(exits.every(r => r?.contentHash === exits[0]?.contentHash));
  assert.equal((exits[0]!.body.exitRequest as FixedIntentExitRequest).source, "native-manager",
    "a later manual click cannot relabel the winning native stop");
  assert.equal(authorizeFixedCommandChain(intent, makeClaim("buy", 1, 2), snapshot()).reason, "exit-already-required");
  {
    const savedRecords = [...db.entries()].map(([id, r]) => [id, structuredClone(r)] as const);
    const pending = structuredClone(broker.get(buy.command.clientOrderId)!);
    broker.set(buy.command.clientOrderId, { ...pending, filled_qty: "4", filled_avg_price: "3", status: "filled" });
    held = 4;
    await coordinateFixedCommand(ports, intent, buy);
    assert.equal(authorizeFixedCommandChain(intent, sell, snapshot()).reason, "sell-coverage-not-materialized",
      "known qty4/basis3 must be materialized before a fresh claim sells stale qty2/basis2");
    const reservedSnapshot = snapshot();
    reservedSnapshot.records = [...reservedSnapshot.records, fixedProtocolRecord({ id: sell.command.id,
      intentId: intent.id, kind: "command", recordedAt: new Date(now()).toISOString(), body: { ...sell } })];
    const change = fixedReserveSellCas(row, sell.command.id);
    reservedSnapshot.rows = [{ ...row, ...change.update } as FixedEconomicRow];
    assert.equal(authorizeFixedCommandChain(intent, sell, reservedSnapshot).allowed, true,
      "late buys after an owned reservation do not revoke its already-frozen sell allocation");
    db.clear(); for (const [id, value] of savedRecords) db.set(id, value);
    broker.set(buy.command.clientOrderId, pending); held = 2;
  }
  // Lose exact buy visibility after durably recording its two fills. Stops must
  // still liquidate proven exposure; this is not an assumption that buy is done.
  const pendingBuy = broker.get(buy.command.clientOrderId)!;
  broker.delete(buy.command.clientOrderId);
  assert.equal(authorizeFixedCommandChain(intent, sell, snapshot()).allowed, true);
  assert.equal((await coordinateFixedCommand(ports, intent, sell)).state, "resolved",
    "final guard accepts its own row reservation");
  assert.equal(posts, 2); assert.equal(held, 0);
  const nextBeforeBooking = makeClaim("sell", 1, 2, row);
  assert.equal(authorizeFixedCommandChain(intent, nextBeforeBooking, snapshot()).reason, "prior-sell-not-booked");
  assert.equal((await bookFixedSellCommand(bookPorts, intent, sell.command.id)).state, "booked");
  assert.equal(rows.get(row.id)!.realized_pnl, -200);
  // Remaining two entry contracts fill after the stop. Reconcile the SAME buy
  // command, retain the closed basis, and use the original latched exit reason.
  broker.set(buy.command.clientOrderId, { ...pendingBuy, filled_qty: "4", filled_avg_price: "3", status: "filled" });
  held = 2;
  assert.equal((await coordinateFixedCommand(ports, intent, buy)).state, "resolved");
  assert.equal(posts, 2, "late buy recovery never resubmits");
  const remainder = materialize(1, 2, 4);
  const lateSell = makeClaim("sell", 1, 2, remainder);
  assert.equal(authorizeFixedCommandChain(intent, lateSell, snapshot()).allowed, true);
  const missingBook = snapshot(); missingBook.records = missingBook.records.filter(r => r.id !== fixedLedgerId("booking", [sell.command.id]));
  assert.equal(authorizeFixedCommandChain(intent, lateSell, missingBook).reason, "prior-sell-not-booked");
  const missingTerminal = snapshot(); missingTerminal.records = missingTerminal.records.filter(r => r.id !== fixedLedgerId("terminal", [sell.command.id]));
  assert.equal(authorizeFixedCommandChain(intent, lateSell, missingTerminal).allowed, false,
    "a booking without its terminal proof cannot authorize another sell");
  const staleHoldings = { ...snapshot(), brokerObservedAtMs: now() - 2_001 };
  assert.equal(authorizeFixedCommandChain(intent, lateSell, staleHoldings).reason, "holdings-unavailable-or-stale");
  assert.equal((await coordinateFixedCommand(ports, intent, lateSell)).state, "resolved");
  assert.equal((await bookFixedSellCommand(bookPorts, intent, lateSell.command.id)).state, "booked");
  assert.equal(posts, 3); assert.equal(held, 0);
  assert.equal(rows.get(row.id)!.avg_entry_price, 2); assert.equal(rows.get(row.id)!.realized_pnl, -200,
    "late buys and subsequent sell never rewrite original closed economics");
  assert.equal(rows.get(remainder.id)!.avg_entry_price, 4);
  assert.equal(rows.get(remainder.id)!.realized_pnl, -600);
  assert.equal(rows.get(remainder.id)!.close_reason, "stop_premium");
  console.log("fixedEntryChainAuthorization: PASS · persisted finite plan, pending-buy native exit, owned final reservation, terminal+booked sell sequencing, first exit cause and late-buy all-out continuation");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
