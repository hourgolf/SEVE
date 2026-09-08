import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { fixedLedgerId, buildFixedEntryIntent, type FixedEntryIntent } from "./fixedEntryLedgerModel.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
import { sealFixedEntryBuys, settleFixedEntryIntent } from "./fixedEntryIntentSettlement.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import { bookFixedSellCommand } from "./fixedEntrySellBooking.js";
import { admitFixedEntryIntent, planFixedIntentAdmission, type FixedAdmissionHistory,
  type FixedIntentSeed } from "./fixedEntryIntentAdmission.js";
import { fixedProtocolRecord, fixedProtocolObservation, parseFixedProtocolRecord,
  type ImmutableClaimStorage } from "./fixedEntryLedgerPersistence.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
const fixture = fixedEntryIntentFixture();
function seed(i: FixedEntryIntent = fixture): FixedIntentSeed {
  const { protocol: _p, id: _id, contentHash: _h, sessionSlotId: _s, attempt: _a,
    predecessorIntentId: _pi, predecessorSettlementHash: _ps, ...input } = i;
  return input;
}
async function completed(positive: boolean) {
  const h = fixedCoverageHarness();
  if (positive) { await coordinateFixedCommand(h.commandPorts, h.intent, h.buy); await h.lateBuy(); }
  await requestFixedIntentExit(h.coverage.storage, h.intent, { source: "native-manager", reason: "stop_premium",
    requestedAt: new Date(h.coverage.now()).toISOString() });
  await sealFixedEntryBuys(h.coverage.storage, h.intent, (await h.coverage.snapshot(h.intent)).records,
    "exit-required", new Date(h.coverage.now()).toISOString());
  if (positive) {
    const row = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
    const sell = h.makeClaim("sell", 0, 4, row);
    await coordinateFixedCommand(h.commandPorts, h.intent, sell);
    await bookFixedSellCommand(h.bookPorts, h.intent, sell.command.id);
  }
  assert.ok(await settleFixedEntryIntent(h.coverage.storage, h.intent, await h.coverage.snapshot(h.intent), h.coverage.now()));
  return h;
}
async function history(h: ReturnType<typeof fixedCoverageHarness>): Promise<FixedAdmissionHistory> {
  return { intents: [{ intent: h.intent, snapshot: await h.coverage.snapshot(h.intent) }],
    observedAtMs: h.coverage.now(), legacySessionEntries: 0 };
}
async function main() {
  const now = Date.parse("2026-09-08T14:30:05.000Z");
  const input = { accountId: fixture.accountId, strategistId: fixture.strategistId, sessionDateEt: fixture.sessionDateEt, nowMs: now };
  const empty: FixedAdmissionHistory = { intents: [], observedAtMs: now, legacySessionEntries: 0 };
  assert.equal(planFixedIntentAdmission(empty, input).allowed, true);
  assert.equal(planFixedIntentAdmission({ ...empty, legacySessionEntries: 1 }, input).allowed, false);
  assert.equal(planFixedIntentAdmission({ ...empty, observedAtMs: now - 2001 }, input).allowed, false);
  assert.equal(planFixedIntentAdmission({ ...empty, legacySessionEntries: NaN }, input).allowed, false);
  const pending = fixedCoverageHarness();
  assert.equal(planFixedIntentAdmission(await history(pending), { ...input, nowMs: pending.coverage.now() }).allowed, false);
  assert.equal(planFixedIntentAdmission(await history(pending), { ...input, sessionDateEt: "2026-09-09", nowMs: pending.coverage.now() }).allowed, false,
    "a new session does not hide an unresolved prior intent");
  const zero = await completed(false), zeroHistory = await history(zero);
  const zeroDecision = planFixedIntentAdmission(zeroHistory, { ...input, nowMs: zero.coverage.now() });
  assert.ok(zeroDecision.allowed);
  assert.equal(zeroDecision.predecessor.attempt, 1);
  assert.equal(zeroDecision.predecessor.predecessorIntentId, zero.intent.id);
  const positive = await completed(true), positiveHistory = await history(positive);
  assert.equal(planFixedIntentAdmission(positiveHistory, { ...input, nowMs: positive.coverage.now() }).allowed, false,
    "the logical positive entry consumes the session once regardless of physical position generations");
  assert.equal(planFixedIntentAdmission(positiveHistory, { ...input, sessionDateEt: "2026-09-09", nowMs: positive.coverage.now() }).allowed, true);
  const corrupt = structuredClone(zeroHistory);
  corrupt.intents[0].snapshot.records = corrupt.intents[0].snapshot.records.filter(r => r.id !== fixedLedgerId("intent-settlement", [zero.intent.id]));
  assert.equal(planFixedIntentAdmission(corrupt, { ...input, nowMs: zero.coverage.now() }).allowed, false,
    "closed arithmetic without an actual durable global receipt is insufficient");
  const wrongLink = buildFixedEntryIntent({ ...seed(), ...zeroDecision.predecessor,
    predecessorSettlementHash: `sha256:${"0".repeat(64)}`, createdAt: new Date(zero.coverage.now()).toISOString() });
  const original = fixedProtocolRecord({ id: wrongLink.id, intentId: wrongLink.id, kind: "intent", recordedAt: wrongLink.createdAt, body: { intent: wrongLink } });
  // Even an otherwise valid second intent cannot be admitted while unsettled.
  assert.equal(planFixedIntentAdmission({ ...zeroHistory, intents: [...zeroHistory.intents,
    { intent: wrongLink, snapshot: { records: [original], positions: [] } }] }, { ...input, nowMs: zero.coverage.now() }).allowed, false);
  {
    const db = new Map<string, ExecutionObservationDraft>();
    const storage: ImmutableClaimStorage = { insert: async row => {
      if (db.has(row.id)) return "existing"; db.set(row.id, structuredClone(row)); return "inserted";
    }, read: async id => structuredClone(db.get(id) ?? null) };
    const ports = { storage, now: () => now, history: async () => empty, authorizeCurrent: async () => true };
    const results = await Promise.all(Array.from({ length: 12 }, (_, n) => admitFixedEntryIntent(ports,
      { ...seed(), strategistId: n % 2 ? "00000000-0000-4000-8000-000000000099" : fixture.strategistId,
        reason: n % 2 ? "macd_bear" : fixture.reason, optionSide: n % 2 ? "put" : "call",
        occ: n % 2 ? "SPY260908P00640000" : fixture.occ })));
    assert.equal(results.filter(r => r.state === "created").length, 1);
    assert.equal(db.size, 1);
    assert.ok(results.every(r => r.intent?.contentHash === results[0].intent?.contentHash), "losers recover the winning original identity");
    const late = await admitFixedEntryIntent({ ...ports, authorizeCurrent: async () => false }, seed());
    assert.equal(late.state, "declined");
    assert.equal(db.size, 1);
  }
  {
    let clock = now, reads = 0;
    const db = new Map<string, ExecutionObservationDraft>();
    const storage: ImmutableClaimStorage = { insert: async row => { db.set(row.id, row); return "inserted"; },
      read: async id => db.get(id) ?? null };
    const fresh = await admitFixedEntryIntent({ storage, now: () => clock,
      history: async () => { reads++; return { ...empty, observedAtMs: clock }; },
      authorizeCurrent: async () => { clock += 3_000; return true; } }, seed());
    assert.equal(fresh.state, "created", "expensive authority does not permanently reuse a now-stale history snapshot");
    assert.equal(reads, 2);
    reads = 0; db.clear();
    const consumed = await admitFixedEntryIntent({ storage, now: () => clock,
      history: async () => ({ ...empty, observedAtMs: clock, legacySessionEntries: ++reads === 2 ? 1 : 0 }),
      authorizeCurrent: async () => true }, seed());
    assert.equal(consumed.reason, "session-entry-already-consumed");
    assert.equal(db.size, 0);
    reads = 0;
    const stale = await admitFixedEntryIntent({ storage, now: () => clock,
      history: async () => ({ ...empty, observedAtMs: clock - (++reads === 2 ? 2_001 : 0) }),
      authorizeCurrent: async () => true }, seed());
    assert.equal(stale.reason, "global-history-stale");
    assert.equal(db.size, 0);
    reads = 0;
    const moved = await admitFixedEntryIntent({ storage, now: zero.coverage.now,
      history: async () => ++reads === 1 ? { ...empty, observedAtMs: zero.coverage.now() } : zeroHistory,
      authorizeCurrent: async () => true }, { ...seed(), createdAt: new Date(zero.coverage.now()).toISOString() });
    assert.equal(moved.reason, "global-history-head-changed");
    assert.equal(db.size, 0);
  }
  {
    const badTime = await admitFixedEntryIntent({ storage: zero.coverage.storage, now: zero.coverage.now,
      history: async () => zeroHistory, authorizeCurrent: async () => true }, seed());
    assert.equal(badTime.state, "declined");
    assert.equal(badTime.reason, "intent-created-before-predecessor-settlement");
    const nextSeed = { ...seed(), createdAt: new Date(zero.coverage.now()).toISOString() };
    const result = await admitFixedEntryIntent({ storage: zero.coverage.storage, now: zero.coverage.now,
      history: async () => zeroHistory, authorizeCurrent: async () => true }, nextSeed);
    assert.equal(result.state, "created");
    assert.equal(result.intent?.predecessorIntentId, zero.intent.id);
    assert.equal(result.intent?.attempt, 1);
    assert.notEqual(result.intent?.id, zero.intent.id);
  }
  console.log("fixedEntryIntentAdmission: PASS · global predecessor, full completion evidence, zero/positive session quota, stale history and concurrent original-intent selection");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
