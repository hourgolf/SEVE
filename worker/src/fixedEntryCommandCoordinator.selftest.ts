import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedOrderCommand, fixedBuySeal } from "./fixedEntryLedgerModel.js";
import { fixedProtocolObservation, fixedProtocolRecord, type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import { fixedRowId, fixedRowCasMatches, fixedCoverageCas, fixedFencedProjection, type FixedFencedRow } from "./fixedEntryRowFence.js";
import { coordinateFixedCommand, fixedFillFromExactOrder, validateFixedCommandClaim,
  type FixedBrokerOrder, type FixedCommandClaim, type FixedCommandPorts } from "./fixedEntryCommandCoordinator.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";

function harness(side: "buy" | "sell" = "buy") {
  const intent = fixedEntryIntentFixture();
  const command = fixedOrderCommand({ intentId: intent.id, side, sequence: 0, quantity: side === "buy" ? 4 : 2 });
  let row: FixedFencedRow = { id: fixedRowId(intent.id, 0), status: "open", qty: 2, avg_entry_price: 2,
    entry_features: { receipt_bound_entry_policy: intent.writeStamp.entry_policy, fixed_entry_coverage: {
      protocol: "fixed-entry-row-v1", intentId: intent.id, generation: 0, revision: 0, activeSellCommandId: null } } };
  const claim: FixedCommandClaim = { command, request: { symbol: intent.occ, qty: String(command.quantity), side,
    type: "market", time_in_force: "day", client_order_id: command.clientOrderId },
    expiresAt: "2026-09-08T14:30:30.000Z", sellRow: side === "sell" ? structuredClone(row) : null,
    exitReason: side === "sell" ? "stop_premium" : null };
  const rows = new Map<string, ExecutionObservationDraft>();
  const original = fixedProtocolObservation(intent, fixedProtocolRecord({ id: intent.id, intentId: intent.id,
    kind: "intent", recordedAt: intent.createdAt, body: { intent } }));
  rows.set(original.id, original);
  const storage: ImmutableClaimStorage = {
    async insert(value) { if (rows.has(value.id)) return "existing"; rows.set(value.id, structuredClone(value)); return "inserted"; },
    async read(id) { return structuredClone(rows.get(id) ?? null); },
  };
  let postCount = 0, lookupCount = 0, guardCount = 0;
  let broker: FixedBrokerOrder | null = null;
  const filled = (): FixedBrokerOrder => ({ id: "00000000-0000-4000-8000-000000000099",
    client_order_id: command.clientOrderId, symbol: intent.occ, side, qty: String(command.quantity),
    filled_qty: String(command.quantity), filled_avg_price: "2", status: "filled" });
  const ports: FixedCommandPorts = { storage,
    now: () => Date.parse("2026-09-08T14:30:02.000Z"),
    authorizeFresh: async () => { guardCount++; return true; },
    reserveSell: async change => {
      if (!fixedRowCasMatches(row, change.expected)) return { state: "lost-race", row: null };
      row = { ...row, ...structuredClone(change.update) } as FixedFencedRow;
      return { state: "applied", row: structuredClone(row) };
    },
    submitOnce: async () => { postCount++; broker = filled(); return structuredClone(broker); },
    lookupExact: async (account, coid) => {
      assert.equal(account, intent.accountId); assert.equal(coid, command.clientOrderId);
      lookupCount++; return structuredClone(broker);
    },
  };
  return { intent, command, claim, ports, rows, filled,
    counts: () => ({ postCount, lookupCount, guardCount }),
    setBroker: (value: FixedBrokerOrder | null) => { broker = value; },
    setRow: (value: FixedFencedRow) => { row = value; }, getRow: () => structuredClone(row) };
}
async function main() {
  {
    const h = harness();
    const results = await Promise.all(Array.from({ length: 20 }, () => coordinateFixedCommand(h.ports, h.intent, h.claim)));
    assert.equal(h.counts().postCount, 1, "twenty overlapping workers permit only one POST");
    assert.equal(results.filter(r => r.postAttempted).length, 1);
    const recovered = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(recovered.state, "resolved"); assert.equal(recovered.fill?.filledQty, 4);
    assert.equal(h.counts().postCount, 1, "restart cannot regain the consumed capability");
    assert.equal(h.counts().guardCount, 21, "all contenders preflight; only INSERT winner gets final preflight");
  }
  for (const persisted of [false, true]) {
    const h = harness(); let attempted = 0;
    h.ports.submitOnce = async () => { attempted++; if (persisted) h.setBroker(h.filled()); throw new Error("lost POST response"); };
    const first = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(first.state, persisted ? "resolved" : "unresolved"); assert.equal(first.postAttempted, true);
    for (let restart = 0; restart < 3; restart++) await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(attempted, 1, "404 and elapsed restarts must not trigger retry");
  }
  {
    const h = harness(); const insert = h.ports.storage.insert;
    h.ports.storage.insert = async value => { await insert(value); return "unknown"; };
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).state, "unresolved");
    h.ports.storage.insert = insert;
    await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(h.counts().postCount, 0, "unknown INSERT plus matching readback is not permission");
  }
  {
    const h = harness();
    h.ports.submitOnce = async () => {
      const pending = { ...h.filled(), status: "partially_filled", filled_qty: "2" };
      h.setBroker(pending); return pending;
    };
    const first = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(first.state, "observed"); assert.equal(first.fill?.filledQty, 2);
    h.setBroker(h.filled());
    const late = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(late.state, "resolved"); assert.equal(late.fill?.filledQty, 4);
    assert.equal(late.postAttempted, false, "late fills are recovered through exact lookup");
  }
  {
    const h = harness("sell");
    const expanded = fixedCoverageCas(h.getRow(), 4, 3);
    h.setRow({ ...h.getRow(), ...expanded.update } as FixedFencedRow);
    const r = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(r.reason, "row-reservation-failed"); assert.equal(r.state, "resolved");
    assert.equal(h.counts().postCount, 0, "stale qty2 exit cannot sell after recovery expands row to4");
    assert.equal(h.getRow().qty, 4);
  }
  {
    const h = harness("sell"); const reserve = h.ports.reserveSell;
    h.ports.reserveSell = async change => { await reserve(change); return { state: "unknown", row: null }; };
    const r = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(r.reason, "row-reservation-failed"); assert.equal(h.counts().postCount, 0);
    assert.equal((h.getRow().entry_features.fixed_entry_coverage as { activeSellCommandId: string }).activeSellCommandId, h.command.id);
    await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(h.counts().postCount, 0, "reservation readback never revives the abandoned submit permission");
  }
  {
    const h = harness("sell"); let n = 0;
    h.ports.authorizeFresh = async () => ++n === 1;
    const r = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(r.reason, "guard-rejected"); assert.equal(r.state, "resolved");
    assert.equal(h.counts().postCount, 0);
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).state, "resolved");
  }
  {
    const h = harness(); let n = 0;
    let stopped=false;
    h.ports.canSubmitNow=()=>!stopped;
    h.ports.authorizeFresh=async()=>{if(++n===2)stopped=true;return true;};
    const r=await coordinateFixedCommand(h.ports,h.intent,h.claim);
    assert.equal(r.state,"resolved");assert.equal(r.reason,"guard-rejected");assert.equal(r.postAttempted,false);
    assert.equal(h.counts().postCount,0);
    stopped=false;await coordinateFixedCommand(h.ports,h.intent,h.claim);
    assert.equal(h.counts().postCount,0,"restart cannot revive an abandoned command");
  }
  {
    const h = harness(); let n = 0;
    h.ports.authorizeFresh = async () => { if (++n === 2) h.ports.now = () => Date.parse(h.claim.expiresAt); return true; };
    const r = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(r.reason, "guard-rejected"); assert.equal(h.counts().postCount, 0, "expiry checked after awaited final guard");
  }
  for(const side of ["buy","sell"] as const){
    const h=harness(side);
    h.ports.canSubmitNow=commandSide=>commandSide!=="buy";
    const result=await coordinateFixedCommand(h.ports,h.intent,h.claim);
    assert.equal(result.postAttempted,side==="sell","recovery-only revokes buys while retaining separately authorized sells");
  }
  {
    const h = harness();
    const seal = fixedBuySeal({ intentId: h.intent.id, sequence: 0, reason: "exit-required" });
    const value = fixedProtocolObservation(h.intent, fixedProtocolRecord({ id: seal.id, intentId: h.intent.id,
      kind: "command", recordedAt: h.intent.createdAt, body: { command: seal } }));
    h.rows.set(value.id, value);
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).reason, "buy-plan-sealed");
    assert.equal(h.counts().postCount, 0);
  }
  {
    const h = harness(); h.rows.clear();
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).reason, "original-intent-not-durable");
    assert.equal(h.counts().postCount, 0);
  }
  {
    const h = harness(); const read = h.ports.storage.read;
    h.ports.submitOnce = async () => {
      h.ports.storage.read = async () => { throw new Error("database unavailable after broker fill"); };
      return h.filled();
    };
    const r = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(r.state, "unresolved"); assert.equal(r.fill?.filledQty, 4, "do not erase known exposure on receipt failure");
    h.ports.storage.read = read;
  }
  {
    const h = harness("sell");
    h.claim.sellRow = { ...h.claim.sellRow!, opened_at: h.intent.createdAt } as FixedFencedRow;
    h.setRow(structuredClone(h.claim.sellRow)); // The database and command share original identity before reservation.
    const reserve = h.ports.reserveSell;
    h.ports.reserveSell = async change => {
      const r = await reserve(change); return { ...r, row: r.row ? fixedFencedProjection(r.row) : null };
    };
    const r = await coordinateFixedCommand(h.ports, h.intent, h.claim);
    assert.equal(r.state, "resolved"); assert.equal(h.counts().postCount, 1, "a correct ownership projection remains valid after full original-identity CAS");
  }
  {
    const h = harness();
    h.ports.authorizeFresh = async (intent, claim) => {
      claim.request.qty = "8"; intent.accountId = "wrong"; return true;
    };
    h.ports.submitOnce = async (account, request) => {
      assert.equal(account, h.intent.accountId); assert.equal(request.qty, "4"); return h.filled();
    };
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).state, "resolved");
    assert.equal(h.claim.request.qty, "4", "guard receives an isolated copy, not the durable request body");
  }
  {
    const h = harness();
    for (const patch of [{ symbol: "SPY260908P00640000" }, { side: "sell" }, { client_order_id: "wrong" },
      { qty: "5" }, { status: "filled", filled_qty: "2" }, { replaced_by: "replacement" },
      { filled_avg_price: null }, { filled_avg_price: "NaN" }]) {
      assert.throws(() => fixedFillFromExactOrder(h.intent, h.command, { ...h.filled(), ...patch }), /broker_identity_or_fill/);
    }
    assert.throws(() => validateFixedCommandClaim(h.intent, { ...h.claim,
      request: { ...h.claim.request, extra: true } }), /unknown_request_fields/);
    h.ports.submitOnce = async () => ({ ...h.filled(), client_order_id: "wrong" });
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).state, "unresolved");
    assert.equal((await coordinateFixedCommand(h.ports, h.intent, h.claim)).postAttempted, false);
  }
  console.log("fixedEntryCommandCoordinator: PASS · overlapping workers, one-use POST, response loss, restart, exact late fills, sell reservation races, guard expiry and buy sealing");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
