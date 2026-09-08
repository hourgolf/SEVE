import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand, fixedLedgerId, buildFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, parseFixedProtocolRecord,
  type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { coordinateFixedCommand, type FixedCommandClaim, type FixedCommandPorts, type FixedBrokerOrder } from "./fixedEntryCommandCoordinator.js";
import { authorizeFixedCommandChain } from "./fixedEntryChainAuthorization.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
import { bookFixedSellCommand, type FixedSellBookingPorts } from "./fixedEntrySellBooking.js";
import { materializeFixedEntryCoverage, fixedPositionIdentityMatches,
  type FixedMaterializedPosition, type FixedCoveragePorts } from "./fixedEntryCoverageMaterialization.js";
import { fixedRowCasMatches, fixedFencedProjection, readFixedRowFence } from "./fixedEntryRowFence.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
import { buildFixedEntryExecutionPlan } from "./fixedEntryExecutionPlan.js";
export function fixedCoverageHarness(options: { spreadCapture?: boolean; intent?: FixedEntryIntent } = {}) {
  const fixture = options.intent ?? fixedEntryIntentFixture();
  const { protocol: _p, id: _id, sessionSlotId: _slot, contentHash: _hash, ...input } = fixture;
  const intent = options.spreadCapture ? buildFixedEntryIntent({ ...input, executionPlan: buildFixedEntryExecutionPlan({
    ...fixture.executionPlan, spreadCapture: true }) }) : fixture;
  const db = new Map<string, ExecutionObservationDraft>();
  const positions = new Map<string, FixedMaterializedPosition>();
  const broker = new Map<string, FixedBrokerOrder>();
  let held = 0, posts = 0, inserts = 0, changes = 0;
  let at = Date.parse("2026-09-08T14:30:03.000Z");
  const storage: ImmutableClaimStorage = { async insert(row) {
    if (db.has(row.id)) return "existing"; db.set(row.id, structuredClone(row)); return "inserted";
  }, read: async id => structuredClone(db.get(id) ?? null) };
  const original = fixedProtocolObservation(intent, fixedProtocolRecord({ id: intent.id, intentId: intent.id,
    kind: "intent", recordedAt: intent.createdAt, body: { intent } }));
  db.set(original.id, original);
  const coverage: FixedCoveragePorts = { storage, now: () => at,
    snapshot: async () => ({ records: [...db.values()].map(r => parseFixedProtocolRecord(r.payload.fixed_entry_record)!),
      positions: [...positions.values()].map(r => structuredClone(r)), brokerNetQty: held, brokerObservedAtMs: at }),
    readPosition: async id => structuredClone(positions.get(id) ?? null),
    insertPosition: async row => {
      inserts++; if (positions.has(row.id)) return "existing";
      positions.set(row.id, structuredClone(row)); return "inserted";
    },
    cas: async change => {
      changes++; const row = positions.get(change.expected.id);
      if (!row || !fixedRowCasMatches(row, change.expected)) return { state: "lost-race", row: null };
      const after = { ...row, ...structuredClone(change.update) } as FixedMaterializedPosition;
      positions.set(after.id, after); return { state: "applied", row: fixedFencedProjection(after) };
    } };
  const makeClaim = (side: "buy" | "sell", sequence: number, qty: number, row: FixedMaterializedPosition | null = null): FixedCommandClaim => {
    const command = fixedOrderCommand({ intentId: intent.id, side, sequence, quantity: qty });
    const rung = side === "buy" ? intent.executionPlan.buyRungs[sequence] : null;
    return { command, request: { symbol: intent.occ, qty: String(qty), side, type: rung?.type ?? "market", time_in_force: "day",
      client_order_id: command.clientOrderId, ...(rung?.limitPrice ? { limit_price: rung.limitPrice } : {}) }, expiresAt: "2026-09-08T14:30:30.000Z", sellRow: row,
      exitReason: side === "sell" ? "stop_premium" : null };
  };
  const commandPorts: FixedCommandPorts = { storage, now: () => at,
    authorizeFresh: async (originalIntent, claim) => {
      const s = await coverage.snapshot(originalIntent);
      return authorizeFixedCommandChain(originalIntent, claim, { records: s.records, rows: s.positions,
        brokerNetQty: s.brokerNetQty, brokerObservedAtMs: s.brokerObservedAtMs, nowMs: at }).allowed;
    },
    reserveSell: async change => await coverage.cas(change) as Awaited<ReturnType<FixedCommandPorts["reserveSell"]>>,
    lookupExact: async (_account, coid) => structuredClone(broker.get(coid) ?? null),
    submitOnce: async (_account, request) => {
      posts++; const qty = request.side === "buy" ? 2 : Number(request.qty);
      held += request.side === "buy" ? qty : -qty;
      const order = { id: fixedLedgerId("broker-fixture", [request.client_order_id]), client_order_id: request.client_order_id,
        symbol: request.symbol, qty: request.qty, side: request.side, filled_qty: String(qty),
        filled_avg_price: request.side === "buy" ? "2" : "1", status: qty === Number(request.qty) ? "filled" : "partially_filled" };
      broker.set(request.client_order_id, order); return order;
    } };
  const bookPorts: FixedSellBookingPorts = { storage, now: () => at, readRow: coverage.readPosition,
    cas: async change => await coverage.cas(change) as Awaited<ReturnType<FixedSellBookingPorts["cas"]>> };
  const buy = makeClaim("buy", 0, 4);
  return { intent, db, positions, broker, coverage, commandPorts, bookPorts, buy, makeClaim,
    counts: () => ({ posts, inserts, changes }), setHeld: (n: number) => { held = n; }, setNow: (n: number) => { at = n; },
    lateBuy: async () => {
      const old = broker.get(buy.command.clientOrderId)!;
      broker.set(buy.command.clientOrderId, { ...old, filled_qty: "4", filled_avg_price: "3", status: "filled" });
      held += 2; at += 1000;
      return coordinateFixedCommand(commandPorts, intent, buy);
    } };
}
