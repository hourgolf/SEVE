import { advanceManager, managerIdsForChannel, recoverManagerState, type ManagerExit } from "../../engine/managerPolicy.js";
import { buildManagerShadowObservation, managerShadowTraceId } from "./managerShadowObservationModel.js";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  passed++;
}

check("lock stop is terminal", advanceManager("LOCK20/30", {}, -31, false).exit?.reason, "stop");
check("lock target is terminal", advanceManager("LOCK20/30", {}, 21, false).exit?.reason, "target");
const banked = advanceManager("BANK20/RUN50", {}, 24, false);
check("bank arms without terminal exit", banked.exit, null);
check("bank runner blends both halves", advanceManager("BANK20/RUN50", banked.state, 0, false).exit?.returnPct, 12);
const armed = advanceManager("ARM20/HALF-GIVEBACK", {}, 25, false);
const higher = advanceManager("ARM20/HALF-GIVEBACK", armed.state, 60, false);
check("giveback uses running peak", advanceManager("ARM20/HALF-GIVEBACK", higher.state, 29, false).exit?.reason, "giveback");
check("restart recovery is explicit", recoverManagerState("BANK20/RUN50", 80), { bankReturnPct: 20, recovered: true });
check("bell control waits", advanceManager("BELL/no-stop", {}, -50, false).exit, null);
check("bell control exits at bell", advanceManager("BELL/no-stop", {}, -50, true).exit?.reason, "bell");
const pb2Bank = advanceManager("PB2-BANK15/HALF-GIVEBACK", {}, 16, false);
const pb2Peak = advanceManager("PB2-BANK15/HALF-GIVEBACK", pb2Bank.state, 60, false);
check("pb2 candidate banks then follows runner peak", pb2Peak.state, { bankReturnPct: 16, armedPeakPct: 60 });
check("pb2 candidate exits runner at half peak", advanceManager("PB2-BANK15/HALF-GIVEBACK", pb2Peak.state, 30, false).exit?.reason, "runner_half_giveback");
check("pb2 candidate is channel scoped", [managerIdsForChannel("pb-ride-2").length, managerIdsForChannel("pb-ride").length], [9, 8]);

const position = {
  id: "11111111-1111-4111-8111-111111111111", occ_symbol: "SPY260713C00600000",
  opt_type: "call" as const, qty: 1, avg_entry_price: 1,
  opened_at: "2026-07-13T14:31:00.000Z",
};
const channel = { id: "22222222-2222-4222-8222-222222222222", slug: "test-channel", underlying: "SPY" };
const accountId = "33333333-3333-4333-8333-333333333333";
const exit = advanceManager("LOCK20/30", {}, 22, false).exit as ManagerExit;
const base = { channel, position, accountId, exit, observedAtMs: Date.parse("2026-07-13T14:32:00Z"),
  quoteAgeMs: 500, bid: 1.22, mid: 1.24, currentReturnPct: 22, peakReturnPct: 22, minutesHeld: 1 };
const row = buildManagerShadowObservation(base);
if (!row) throw new Error("valid manager shadow row rejected");
passed++;
check("shadow action cannot be mistaken for an order", [row.action, row.blocked_reason, row.payload.shadowOnly], ["exit", "observation_only", true]);
check("exit identity ignores retry time", buildManagerShadowObservation({ ...base, observedAtMs: base.observedAtMs + 10_000 })?.id, row.id);
const alternateExit = { ...exit, reason: "later_bell", returnPct: -5 };
check("first-exit identity ignores later trigger", managerShadowTraceId({ position, exit: alternateExit }), row.trace_id);
const other = advanceManager("LOCK30/30", {}, 31, false).exit as ManagerExit;
check("manager identity is independent", managerShadowTraceId({ position, exit: other }) === row.trace_id, false);
check("pre-cohort positions are excluded", buildManagerShadowObservation({ ...base, position: { ...position, opened_at: "2026-07-12T14:31:00Z" } }), null);

console.log(`manager-shadow-selftest: ${passed}/${passed} PASS`);
