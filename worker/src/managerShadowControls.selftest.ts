import assert from "node:assert/strict";
import { advanceManager, managerIdsForChannel, managerIdsForObservedConfiguration, recoverManagerState, FORWARD_CONTROL_NATIVE_VERSIONS as versions } from "../../engine/managerPolicy.js";
import { buildManagerShadowEnrollments, encodeManagerShadowRun, decodeManagerShadowRun, managerAllocation, quantityWeightedReturnPct } from "./managerShadowBookModel.js";

const base = {
  positionId: "11111111-1111-4111-8111-111111111111", strategistId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333", channelSlug: "momo-shape-2",
  nativeManagerProfileId: "BANK30-R50-K67", occSymbol: "SPY260901C00600000", underlying: "SPY", optionSide: "call" as const,
  nativeManagerVersion: versions["momo-shape-2"],
  entryPrice: 1, entryPriceBasis: "broker_fill" as const, entryAt: "2026-09-01T14:31:00Z",
  admittedAt: "2026-09-01T14:31:00.250Z", admissionSource: "fill_hook" as const,
  originalQty: 5, quoteMaxAgeMs: 15_000, paperMode: true,
};
const runs = buildManagerShadowEnrollments(base);
assert.equal(runs.length, 10);
assert.equal(new Set(runs.map(r => r.id)).size, 10);
assert(!runs.some(r => r.managerId === "ARM20/HALF-GIVEBACK"), "named equivalent is not independent evidence");
const newIds = ["MOMO2-B20-BE-R50", "FULL-R20-K50", "FULL-R50-K67"];
for (const id of newIds) {
  const run = runs.find(r => r.managerId === id)!;
  assert(run);
  assert.deepEqual(decodeManagerShadowRun(encodeManagerShadowRun(run, { sourceBootId: "77777777-7777-4777-8777-777777777777" })!), run, "new controls survive durable restart without changing state");
}
const late = buildManagerShadowEnrollments({ ...base, admissionSource: "recovery_open", admittedAt: "2026-09-01T15:00:00Z" });
assert(!late.some(r => newIds.includes(r.managerId)), "late recovery must not manufacture previously unobserved control history");
assert.equal(buildManagerShadowEnrollments({ ...base, admissionSource: "recovery_open" }).length, 10);
assert.equal(buildManagerShadowEnrollments({ ...base, nativeManagerVersion: "changed" }).length, 8, "same label with a different policy hash cannot borrow declared controls");
assert.deepEqual(managerIdsForObservedConfiguration("momo-shape-2", "other-native"), managerIdsForChannel("momo-shape-2"));
assert.equal(managerIdsForObservedConfiguration("grind-smart-entries", "FULL-R50-K75", versions["grind-smart-entries"]).at(-1), "GRIND-SMART-ALL-OUT-8");
const level = managerIdsForObservedConfiguration("vb-level-break", "VB-LEVEL-ALL-OUT-30", versions["vb-level-break"]);
assert(level.includes("LOCK50/30") && level.includes("VB-LEVEL-CURRENT-LOCK25"));
assert(!level.includes("LOCK30/30"), "do not duplicate the current native all-out30 arm");
assert(!managerIdsForChannel("vb-level-break", "2026-08-25").includes("LOCK50/30"), "old recorded inventory remains intact");
for (const old of late.filter(r => r.managerId !== "ARM20/HALF-GIVEBACK")) assert.equal(old.id, runs.find(r => r.managerId === old.managerId)?.id, "existing run IDs remain retry stable");
assert(managerIdsForObservedConfiguration("orb-trend-rider", "ORB-ALL-OUT-50", versions["orb-trend-rider"]).includes("ORB-TREND-SOURCE-30/35"));
assert.equal(advanceManager("ORB-TREND-SOURCE-30/35", {}, -32, false).exit, null);
assert.equal(advanceManager("ORB-TREND-SOURCE-30/35", {}, 31, false).exit?.returnPct, 31);

assert.equal(advanceManager("GRIND-SMART-ALL-OUT-8", {}, 9, false).exit?.returnPct, 9, "observed overshoot, not imaginary target fill");
assert.equal(advanceManager("GRIND-SMART-ALL-OUT-8", {}, -36, false).exit?.returnPct, -36);
assert.equal(advanceManager("MOMO2-B20-BE-R50", {}, -35, false).exit, null, "displaced momo has40 stop, not generic30");
assert.equal(advanceManager("MOMO2-B20-BE-R50", {}, -41, false).exit?.reason, "prebank_stop");
const bank = advanceManager("MOMO2-B20-BE-R50", {}, 22, false);
assert.equal(bank.exit, null);
const exit = advanceManager("MOMO2-B20-BE-R50", bank.state, -2, false).exit!;
assert.equal(exit.reason, "runner_floor");
assert.equal(exit.returnPct, 10);
const allocation = managerAllocation(5, "MOMO2-B20-BE-R50")!;
assert.equal(allocation.bankQty, 2);
assert.equal(allocation.runnerQty, 3);
// Policy gives a normalized half/half result; durable execution model weights real lots.
assert.equal(quantityWeightedReturnPct({ managerId: "MOMO2-B20-BE-R50", allocation }, exit.state, -2), 7.6);
const armed = advanceManager("FULL-R50-K67", {}, 60, false);
assert.equal(armed.exit, null);
assert.equal(advanceManager("FULL-R50-K67", armed.state, 41, false).exit, null);
assert.equal(advanceManager("FULL-R50-K67", armed.state, 39, false).exit?.returnPct, 39);
assert.equal(advanceManager("FULL-R20-K50", {}, -31, false).exit?.reason, "prearm_stop");
const r20 = advanceManager("FULL-R20-K50", {}, 24, false);
assert.equal(advanceManager("FULL-R20-K50", r20.state, 11, false).exit?.returnPct, 11);
assert.equal(advanceManager("FULL-R50-K67", {}, 8, true).exit?.reason, "bell");
assert.deepEqual(recoverManagerState("MOMO2-B20-BE-R50", 29), { bankReturnPct: 20, recovered: true });
console.log("manager-shadow-controls: PASS · exact displaced policies, causal paths, real lot weights, forward enrollment, restart/identity safety");
