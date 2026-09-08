import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand, fixedLedgerId, buildFixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { fixedRowId, fixedRowCasMatches, fixedFencedProjection } from "./fixedEntryRowFence.js";
import { coordinateFixedCommand, type FixedCommandClaim, type FixedCommandPorts } from "./fixedEntryCommandCoordinator.js";
import { bookFixedSellCommand, type FixedEconomicRow, type FixedSellBookingPorts } from "./fixedEntrySellBooking.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";

function harness(filledQty: 0 | 1 | 2, filledAt: string | null = "2026-09-08T14:30:02.000Z",
  fillPrice = "1", entryBasis = 2) {
  const intent = fixedEntryIntentFixture();
  let row: FixedEconomicRow = { id: fixedRowId(intent.id, 0), status: "open", qty: 2, avg_entry_price: entryBasis,
    current_mark: 2, realized_pnl: null, unrealized_pnl: 0, closed_at: null, close_reason: null,
    entry_features: { receipt_bound_entry_policy: intent.writeStamp.entry_policy, fixed_entry_coverage: {
      protocol: "fixed-entry-row-v1", intentId: intent.id, generation: 0, revision: 0, activeSellCommandId: null } } };
  const command = fixedOrderCommand({ intentId: intent.id, side: "sell", sequence: 0, quantity: 2 });
  const claim: FixedCommandClaim = { command, request: { symbol: intent.occ, qty: "2", side: "sell",
    type: "market", time_in_force: "day", client_order_id: command.clientOrderId },
    expiresAt: "2026-09-08T14:30:30.000Z", sellRow: structuredClone(row), exitReason: "stop_premium" };
  const db = new Map<string, ExecutionObservationDraft>();
  const original = fixedProtocolObservation(intent, fixedProtocolRecord({ id: intent.id, intentId: intent.id,
    kind: "intent", recordedAt: intent.createdAt, body: { intent } }));
  db.set(original.id, original);
  const storage: ImmutableClaimStorage = {
    async insert(value) { if (db.has(value.id)) return "existing"; db.set(value.id, structuredClone(value)); return "inserted"; },
    async read(id) { return structuredClone(db.get(id) ?? null); },
  };
  let casCount = 0;
  const bookPorts: FixedSellBookingPorts = { storage, now: () => Date.parse("2026-09-08T14:30:03.000Z"),
    readRow: async id => id === row.id ? structuredClone(row) : null,
    cas: async change => {
      casCount++;
      if (!fixedRowCasMatches(row, change.expected)) return { state: "lost-race", row: null };
      row = { ...row, ...structuredClone(change.update) } as FixedEconomicRow;
      return { state: "applied", row: fixedFencedProjection(row) };
    } };
  const commandPorts: FixedCommandPorts = { storage, now: bookPorts.now,
    authorizeFresh: async () => true, reserveSell: bookPorts.cas,
    submitOnce: async () => ({ id: "00000000-0000-4000-8000-000000000077",
      client_order_id: command.clientOrderId, symbol: intent.occ, side: "sell", qty: "2",
      filled_qty: String(filledQty), filled_avg_price: filledQty ? fillPrice : null,
      status: filledQty === 2 ? "filled" : "canceled", filled_at: filledAt }),
    lookupExact: async () => null };
  return { intent, command, claim, commandPorts, bookPorts, db,
    getRow: () => structuredClone(row), setRow: (next: FixedEconomicRow) => { row = next; }, casCount: () => casCount };
}
async function main() {
  for (const qty of [0, 1, 2] as const) {
    const h = harness(qty);
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, h.claim)).state, "resolved");
    const results = await Promise.all(Array.from({ length: 8 }, () => bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)));
    assert.ok(results.some(r => r.state === "booked"));
    const row = h.getRow();
    assert.equal(row.status, qty ? "closed" : "open"); assert.equal(row.qty, qty || 2);
    assert.equal(row.avg_entry_price, 2); assert.equal(row.realized_pnl, qty ? -100 * qty : null);
    assert.deepEqual(row.entry_features.receipt_bound_entry_policy, h.intent.writeStamp.entry_policy);
    assert.equal(row.close_reason, qty ? "stop_premium" : null, "native exit cause is retained, not generic fixed protocol label");
    const before = structuredClone(row);
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked");
    assert.deepEqual(h.getRow(), before, "restart must not rebook P&L or rewrite closed history");
  }
  {
    const h = harness(1); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const cas = h.bookPorts.cas;
    h.bookPorts.cas = async change => { await cas(change); return { state: "unknown", row: null }; };
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked",
      "CAS response loss is resolved by exact economic readback, without any broker action");
  }
  {
    const h = harness(1); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const insert = h.bookPorts.storage.insert;
    h.bookPorts.storage.insert = async value => value.id === fixedLedgerId("booking", [h.command.id]) ? "unknown" : insert(value);
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "unresolved");
    const closed = h.getRow(); const beforeCas = h.casCount();
    h.bookPorts.storage.insert = insert;
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked");
    assert.equal(h.casCount(), beforeCas, "retry after closed-row write but missing receipt must not close again");
    assert.deepEqual(h.getRow(), closed);
  }
  {
    const h = harness(2); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    h.bookPorts.cas = async () => ({ state: "unknown", row: null });
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "unresolved");
    assert.equal(h.getRow().status, "open");
    assert.equal(h.db.has(fixedLedgerId("booking", [h.command.id])), false);
  }
  {
    const h = harness(2); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    h.setRow({ ...h.getRow(), qty: 4, avg_entry_price: 3 });
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).reason, "reserved-row-mismatch");
    assert.equal(h.getRow().status, "open", "unfenced external expansion must not be silently closed");
  }
  {
    const h = harness(2); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const cas = h.bookPorts.cas;
    h.bookPorts.cas = async change => { const r = await cas(change); h.setRow({ ...h.getRow(), realized_pnl: 777 }); return r; };
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "unresolved");
    assert.equal(h.db.has(fixedLedgerId("booking", [h.command.id])), false, "matching marker is insufficient without realized P&L readback");
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).reason, "booked-economics-mismatch");
  }
  {
    const h = harness(0); let guard = 0;
    h.commandPorts.authorizeFresh = async () => ++guard === 1;
    assert.equal((await coordinateFixedCommand(h.commandPorts, h.intent, h.claim)).reason, "guard-rejected");
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked");
    assert.equal((h.getRow().entry_features.fixed_entry_coverage as { activeSellCommandId: unknown }).activeSellCommandId, null);
    assert.equal(h.getRow().status, "open"); assert.equal(h.getRow().qty, 2);
  }
  {
    const h = harness(1, null); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const r = await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id);
    assert.equal(r.state, "booked");
    assert.equal((r.receipt?.body.booking as { closedAtSource: string }).closedAtSource, "terminal-observed-at",
      "missing broker fill time must be labeled rather than invented");
  }
  {
    const h = harness(1); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const read = h.bookPorts.readRow;
    h.bookPorts.readRow = async id => {
      const row = await read(id);
      return row?.closed_at ? { ...row, closed_at: row.closed_at.replace(".000Z", "+00:00") } : row;
    };
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked",
      "equivalent PostgreSQL timestamps must settle on first call");
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked");
  }
  for (const [entry, exit, pnl, mark] of [[1, "1.00105", 0.11, 1.0011], [1, "0.99895", -0.11, 0.999],
    [2, "2.00015", 0.02, 2.0002]] as const) {
    const h = harness(1, null, exit, entry);
    await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const r = await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id);
    assert.equal(r.state, "booked"); assert.equal(h.getRow().realized_pnl, pnl);
    assert.equal(h.getRow().current_mark, mark, "schema mark is quantized while terminal receipt retains exact broker decimal");
  }
  {
    const h = harness(1); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).state, "booked");
    h.setRow({ ...h.getRow(), realized_pnl: 777 });
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).reason, "closed-row-drift-after-booking");
  }
  {
    const h = harness(1); await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    const { protocol: _p, id: _id, contentHash: _h, sessionSlotId: _slot, ...input } = h.intent;
    const wrongIntent = buildFixedEntryIntent({ ...input, writeStamp: { ...input.writeStamp,
      channel_spec_version_id: "00000000-0000-4000-8000-000000000099" } });
    const before = h.getRow();
    assert.equal((await bookFixedSellCommand(h.bookPorts, wrongIntent, h.command.id)).state, "unresolved");
    assert.deepEqual(h.getRow(), before, "same intent slot does not authorize transplanted relational provenance");
    assert.equal(h.db.has(fixedLedgerId("booking", [h.command.id])), false);
  }
  {
    const h = harness(1);
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).reason, "command-missing");
    await coordinateFixedCommand(h.commandPorts, h.intent, h.claim);
    h.db.delete(fixedLedgerId("terminal", [h.command.id]));
    assert.equal((await bookFixedSellCommand(h.bookPorts, h.intent, h.command.id)).reason, "terminal-proof-missing");
    assert.equal(h.getRow().status, "open");
  }
  console.log("fixedEntrySellBooking: PASS · terminal partials, eight concurrent bookers, CAS/receipt loss, immutable closed economics, original native reason, zero-fill reservation release and timestamp provenance");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
