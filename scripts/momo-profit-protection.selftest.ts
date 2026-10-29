import assert from "node:assert/strict";
import { mapOpenPositions } from "../worker/src/exitGuard.js";
import { compileReleaseManifest, managerPolicyContentHash } from "../lib/channels/channelControlPlane.js";
import { buildOperatorProposal } from "../lib/channels/channelProposalWrite.js";
import { buildShadowActivationCandidate } from "../lib/channels/channelActivation.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "../lib/channels/rc54ControlPlaneFixture.js";
import { MOMO_PROTECTED_MANAGER, MOMO_PROTECTED_MANAGER_VERSION, momoProfitProtection,
  PROFIT_PROTECTION_COMPATIBILITY } from "../lib/channels/profitProtection.js";
import { buildReceiptBoundEntryPolicy, parseReceiptBoundEntryPolicy } from "../worker/src/receiptBoundEntryPolicy.js";
import type { ReceiptBoundRuntimeRoot } from "../worker/src/channelConfigurationRuntimeAdapter.js";
import type { PositionRow } from "../worker/src/store.js";
import { observeProfitProtection, profitProtectionTransition, profitProtectionExitRequired,
  type ProfitProtectionState } from "../worker/src/profitProtection.js";
import { managerIdsForObservedConfiguration, advanceManager } from "../engine/managerPolicy.js";
import { executableManagerFromChannelSpec } from "../lib/research/executableShadowManager.js";
import { supportsManifestCompatibility, RC54_WORKER_VERSION } from "../worker/src/version.js";

async function main() {
process.env.ALPACA_KEY ??= "selftest";
process.env.ALPACA_SECRET ??= "selftest";
process.env.SUPABASE_URL ??= "https://selftest.invalid";
const { premiumExitReason } = await import("../worker/src/exitRules.js");

const fixture = JSON.parse(JSON.stringify(RC54_CONTROL_PLANE_FIXTURE).replaceAll("momo-shape", "momo-shape-2"));
const active = compileReleaseManifest(fixture);
const base = active.channelSpecs.find(s => s.slug === "momo-shape-2")!;
assert.ok(base);
const manager = {
  managerProfileId: MOMO_PROTECTED_MANAGER,
  managerLabel: "BANK30 / RUN50 KEEP67 · ARM +15 / FLOOR +5 · STOP -30",
  takeProfit: { kind: "bank" as const, fraction: 0.5 as const, targetPct: 30 },
  stopLoss: { catastrophePct: 30, priceBasis: "executable-option-bid" as const },
  ratchetParameters: { kind: "a13" as const, engageReturnPct: 50, givebackPct: 33,
    retainGainPct: 67, fixedTargetPct: null, profitProtection: momoProfitProtection() },
};
assert.equal(managerPolicyContentHash({ ...manager, liquidationEt: "15:25" }), MOMO_PROTECTED_MANAGER_VERSION);
const built = buildOperatorProposal(active, {
  baseSpecVersionId: base.id, baseSpecContentHash: base.contentHash,
  proposedPatch: { managerPolicy: manager }, changeClass: "bounded-parameter",
  reason: "Operator approved Momo early profit protection", evidenceRefs: ["test:paired-research"],
}, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "2026-10-28T22:00:00Z");
const candidate = buildShadowActivationCandidate({ active, proposal: built.proposal });
assert.ok(candidate.compiled);
assert.equal(candidate.compiled.manifest.workerCompatibilityVersion, PROFIT_PROTECTION_COMPATIBILITY);
assert.equal(candidate.validationResults.some(r => r.state === "block"), false);
assert.ok(supportsManifestCompatibility(PROFIT_PROTECTION_COMPATIBILITY, RC54_WORKER_VERSION));
const spec = candidate.compiled.channelSpecs.find(s => s.slug === base.slug)!;
assert.deepEqual(spec.stopLoss, manager.stopLoss);
assert.equal(spec.quantity, base.quantity);
assert.deepEqual(candidate.compiled.channelSpecs.filter(s => s.slug !== base.slug), active.channelSpecs.filter(s => s.slug !== base.slug));
const root = candidate.compiled.workerProjection.roots.find(s => s.slug === base.slug)!;
const configuration = { identityVersion: 1 as const, releaseManifestId: candidate.compiled.manifest.id,
  releaseManifestContentHash: candidate.compiled.manifest.contentHash, channelSpecVersionId: spec.id,
  channelSpecContentHash: spec.contentHash, configurationEpochId: `sha256:${"1".repeat(64)}`,
  channelSlug: spec.slug, accountId: spec.accountId, managerProfileId: spec.managerProfileId, managerVersion: spec.managerVersion };
const policy = buildReceiptBoundEntryPolicy({ ...root, configuration, reentryPolicy: "disabled",
  scalePolicy: spec.scalePolicy, releaseManifestDatabaseId: null, channelSpecVersionDatabaseId: null } as ReceiptBoundRuntimeRoot);
assert.equal(policy.policyVersion, "receipt-bound-entry-policy-v4");
assert.ok(parseReceiptBoundEntryPolicy(JSON.parse(JSON.stringify(policy))));
assert.equal(parseReceiptBoundEntryPolicy({ ...policy, policyVersion: "receipt-bound-entry-policy-v2" }), null);
assert.equal(parseReceiptBoundEntryPolicy({ ...policy, quantity: 4 }), null);
assert.equal(parseReceiptBoundEntryPolicy({ ...policy, stopLoss: { ...policy.stopLoss, catastrophePct: 50 } }), null);

const row = { id: "test-root", avg_entry_price: 1, qty: 2, runner_of: null,
  peak_mark: 1, opened_at: "2026-10-28T14:00:00Z" } as PositionRow;
const input = { policy, state: row, entry: 1, remainingQty: 2, bid: 1.15, ask: 1.16,
  bidSize: 10, ageMs: 50, providerClock: true };
assert.equal(profitProtectionTransition(input), "arm");
assert.equal(profitProtectionTransition({ ...input, nativeExitReason: "target_premium" }), "arm");
assert.equal(profitProtectionTransition({ ...input, nativeExitReason: "trail_giveback" }), null);
assert.equal(profitProtectionTransition({ ...input, bid: 1.149 }), null);
assert.equal(profitProtectionTransition({ ...input, bid: 1.05 }), null, "no floor before arm");
for (const invalid of [{ providerClock: false }, { ageMs: 15_001 }, { ageMs: -1 },
  { bidSize: 1 }, { bid: NaN }, { ask: 1.14 }])
  assert.equal(profitProtectionTransition({ ...input, ...invalid }), null);
await observeProfitProtection(input, async () => null);
assert.equal(row.profit_protection_armed_at, undefined, "failed persistence cannot claim armed");
const durable: ProfitProtectionState = {};
const persist = async (transition: "arm" | "exit") => {
  if (transition === "arm") durable.profit_protection_armed_at ??= "2026-10-28T14:01:00Z";
  else durable.profit_protection_exit_required_at ??= "2026-10-28T14:02:00Z";
  return { ...durable };
};
await observeProfitProtection(input, persist);
assert.equal(profitProtectionTransition(input), null, "arm is not repeated");
assert.equal(profitProtectionTransition({ ...input, bid: 1.051 }), null);
await observeProfitProtection({ ...input, bid: 1.05 }, persist);
assert.ok(profitProtectionExitRequired(policy, row));
const restarted = mapOpenPositions({ data: [JSON.parse(JSON.stringify(row))], error: null })[0]!;
assert.ok(profitProtectionExitRequired(policy, restarted), "restart preserves committed exit");
const check = (r: PositionRow, bid: number, peak = 1.2) => premiumExitReason({ row: r, slug: spec.slug,
  premiumStopPct: 30, givebackTrail: null, isManual: false, minutesToClose: 200,
  isRunner: !!r.runner_of, runnerGivebackPct: 33, receiptBoundEntryPolicy: policy }, bid, peak);
assert.equal(check(restarted, 1.4), "early_profit_floor", "recovery cannot cancel committed exit or re-bank");
assert.equal(check(restarted, 0), "early_profit_floor", "quote outage cannot erase latch");
assert.equal(check(restarted, 0.6), "premium_stop", "catastrophe priority");
const partial = { ...restarted, id: "partial", qty: 1 };
assert.equal(check(partial, 1.4), "early_profit_floor", "exit only remaining partial contract");
const unlatched = { ...row, profit_protection_exit_required_at: null };
assert.equal(check(unlatched, 1.3, 1.3), "target_premium", "existing half-bank preserved");
const runner = { ...unlatched, qty: 1, runner_of: "banked-root" };
assert.equal(check(runner, 1.3, 1.3), null, "runner never re-banks");
assert.equal(check(runner, 1.39, 1.6), "trail_giveback", "existing A13 preserved");
assert.equal(check(runner, 0.86, 1.3), "runner_ratchet", "existing peak-price rule preserved");
const replay = executableManagerFromChannelSpec(spec, "2026-10-28T19:25:00Z");
assert.ok(replay.kind === "bank_runner");
assert.deepEqual(replay.profitProtection, { armReturnPct: 15, floorReturnPct: 5 });
assert.ok(managerIdsForObservedConfiguration(spec.slug, spec.managerProfileId, spec.managerVersion).includes("MOMO-B30-R50-K67-CONTROL"));
assert.ok(!managerIdsForObservedConfiguration(spec.slug, spec.managerProfileId, "wrong-hash").includes("MOMO-B30-R50-K67-CONTROL"));
const bank = advanceManager("MOMO-B30-R50-K67-CONTROL", {}, 30, false);
assert.equal(bank.state.bankReturnPct, 30);
assert.equal(advanceManager("MOMO-B30-R50-K67-CONTROL", bank.state, 5, false).exit, null);
assert.equal(advanceManager("MOMO-B30-R50-K67-CONTROL", bank.state, -14, false).exit?.returnPct, 8);
console.log("profit-protection-selftest: proposal, compatibility, immutable policy, quote qualification, durable arm/latch, restart, partial remainder, native priority and displaced control PASS");

}
main().catch(error => { console.error(error); process.exitCode = 1; });
