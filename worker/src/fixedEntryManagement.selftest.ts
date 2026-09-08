import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import type { FixedManagementInput } from "./fixedEntryManagement.js";
async function main() {
  Object.assign(process.env, { ALPACA_KEY: "fixture", ALPACA_SECRET: "fixture",
    SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture" });
  const { observeFixedNativeManagement, fixedEtClock } = await import("./fixedEntryManagement.js");
  const { premiumExitReason } = await import("./exitRules.js");
  const h = fixedCoverageHarness(); await coordinateFixedCommand(h.commandPorts, h.intent, h.buy);
  const row = (await materializeFixedEntryCoverage(h.coverage, h.intent)).position!;
  const s = await h.coverage.snapshot(h.intent), nowMs = h.coverage.now();
  const base: FixedManagementInput = { nowMs, fundHalted: false, accountHalted: false, eventWindow: false,
    source: "sweep", quote: { bid: 1.9, ask: 2, observedAtMs: nowMs }, brokerMark: null };
  for (const bid of [0.99, 1, 1.001, 1.5, 2, 2.399, 2.4, 3, 10]) {
    const observed = observeFixedNativeManagement(h.intent, s, { ...base, quote: { bid, ask: bid + 0.1, observedAtMs: nowMs } });
    const native = premiumExitReason({ row, slug: h.intent.slug, receiptBoundEntryPolicy: h.intent.writeStamp.entry_policy,
      premiumStopPct: 50, takeProfitPct: 0, givebackTrail: null, isManual: false, isRunner: false, minutesToClose: 330 }, bid, row.peak_mark);
    assert.equal(observed.exit?.reason ?? null, native, `fixed manager preserves native boundary at bid${bid}`);
  }
  assert.equal(observeFixedNativeManagement(h.intent, s, { ...base, quote: { bid: 1, ask: 1.1, observedAtMs: nowMs - 120001 } }).exit, null);
  assert.equal(observeFixedNativeManagement(h.intent, s, { ...base, quote: { bid: 1, ask: 1.1, observedAtMs: nowMs + 1 } }).exit, null);
  const brokerMark = { price: 1, observedAtMs: nowMs };
  assert.equal(observeFixedNativeManagement(h.intent, s, { ...base, quote: null, brokerMark }).exit, null);
  assert.equal(observeFixedNativeManagement(h.intent, s, { ...base, source: "cycle", quote: null, brokerMark }).exit?.reason, "premium_stop");
  assert.equal(observeFixedNativeManagement(h.intent, s, { ...base, source: "cycle", quote: null,
    brokerMark: { ...brokerMark, observedAtMs: nowMs - 2001 } }).exit, null);
  const empty = { ...s, positions: [] };
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, fundHalted: true, quote: null }).exit?.reason, "halt_flatten");
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, eventWindow: true, quote: null }).exit?.reason, "event_flatten");
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, nowMs: Date.parse("2026-09-08T19:24:59Z"), quote: null }).exit, null);
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, nowMs: Date.parse("2026-09-08T19:25:00Z"), quote: null }).exit?.reason, "rc54_eod_flatten");
  assert.throws(() => observeFixedNativeManagement(h.intent, s, { ...base, accountHalted: null }), /mandatory_state_unknown/);
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, fundHalted: true, eventWindow: null }).exit?.reason, "halt_flatten");
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, eventWindow: true, accountHalted: null }).exit?.reason, "event_flatten");
  assert.equal(observeFixedNativeManagement(h.intent, empty, { ...base, nowMs: Date.parse("2026-09-08T19:25:00Z"), eventWindow: null }).exit?.reason, "rc54_eod_flatten");
  assert.equal(observeFixedNativeManagement(h.intent, s, { ...base, eventWindow: null,
    quote: { bid: 1, ask: 1.1, observedAtMs: nowMs } }).exit?.reason, "premium_stop");
  assert.throws(() => observeFixedNativeManagement(h.intent, s, { ...base, nowMs: NaN }), /clock_invalid/);
  assert.deepEqual(fixedEtClock(Date.parse("2026-09-08T04:00:00Z")), { date: "2026-09-08", minute: 0 });
  console.log("fixedEntryManagement: PASS · native20/50 bid boundaries, cycle-only mark fallback, stale/future quotes, missing-row halt/event/EOD and original policy");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
