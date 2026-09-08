import assert from "node:assert/strict";
import { fixedContractAdmissionPolicy, FIXED_CONTRACT_WORKER_COMPATIBILITY } from "../../lib/channels/fixedContractAdmission.js";
import { evaluateFixedContractAffordability, evaluateFixedContinuationAffordability, makeFixedContractSubmissionGuard, type OptionsAffordabilitySnapshot } from "./fixedContractAffordability.js";
import { supportsManifestCompatibility, RC54_WORKER_VERSION } from "./version.js";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import { applyReceiptBoundRuntimeFleetOverlay, buildReceiptBoundRuntimeConfiguration } from "./channelConfigurationRuntimeAdapter.js";
import { buildReceiptBoundEntryPolicy, parseReceiptBoundEntryPolicy, receiptBoundBankTargetReached,
  receiptBoundA13GivebackReached, receiptBoundFixedTargetReached } from "./receiptBoundEntryPolicy.js";
import type { ChannelConfig } from "./store.js";

const account: OptionsAffordabilitySnapshot = { observedAtMs: 1_000, optionsBuyingPowerUsd: 10_000,
  status: "ACTIVE", tradingBlocked: false, accountBlocked: false, tradeSuspendedByUser: false, optionsTradingLevel: 2 };
const evaluate = (ask: number, patch: Partial<Parameters<typeof evaluateFixedContractAffordability>[0]> = {}) =>
  evaluateFixedContractAffordability({ policy: fixedContractAdmissionPolicy(), slug: "vb-macd-state",
    quantity: 4, bid: ask - .01, ask, quoteAgeMs: 100, account, nowMs: 1_001, ...patch });
for (const ask of [1.75, 1.76, 4.20, 4.21, 10, 25]) {
  const result = evaluate(ask); assert.equal(result.allowed, true, String(ask));
  assert.equal(result.requestedDebitUsd, ask * 400);
  assert.equal(result.requestedNominalStopUsd, ask * 200);
}
assert.equal(evaluate(25.01).reason, "fixed_contract_buying_power_insufficient");
const exactRemainder = { policy: fixedContractAdmissionPolicy(), slug: "vb-macd-state", quantity: 3,
  provenBoughtQty: 1, bid: 1.04, ask: 1.05, quoteAgeMs: 100, nowMs: 1_001,
  account: { ...account, optionsBuyingPowerUsd: 315 } };
assert.equal(evaluateFixedContinuationAffordability(exactRemainder).requestedDebitUsd, 315);
assert.equal(evaluateFixedContinuationAffordability(exactRemainder).allowed, true);
assert.equal(evaluateFixedContinuationAffordability({ ...exactRemainder,
  account: { ...exactRemainder.account, optionsBuyingPowerUsd: 314.99 } }).reason, "fixed_contract_buying_power_insufficient");
for (const nowMs of [NaN, Infinity, -Infinity]) {
  assert.equal(evaluateFixedContinuationAffordability({ ...exactRemainder, nowMs }).reason, "fixed_contract_account_unavailable");
}
for (const provenBoughtQty of [0, 1, 2, 3]) {
  const quantity = 4 - provenBoughtQty;
  const continuation = { policy: fixedContractAdmissionPolicy(), slug: "vb-macd-state", quantity,
    bid: 9.99, ask: 10, quoteAgeMs: 100, account: { ...account, optionsBuyingPowerUsd: quantity * 1000 },
    nowMs: 1_001, provenBoughtQty };
  assert.equal(evaluateFixedContinuationAffordability(continuation).allowed, true);
  assert.equal(evaluateFixedContinuationAffordability({ ...continuation, account: { ...continuation.account, optionsBuyingPowerUsd: quantity * 1000 - 1 } }).allowed, false);
  assert.equal(evaluateFixedContinuationAffordability({ ...continuation, quantity: quantity - 1 }).allowed, false,
    "buying power cannot silently reduce the remaining four-contract intent");
}
for (const patch of [{ account: null }, { quantity: 3 }, { ask: NaN }, { ask: Infinity }, { bid: 0 },
  { bid: 2, ask: 1 }, { quoteAgeMs: 120_001 }, { quoteAgeMs: -1 }, { nowMs: 3_001 }, { nowMs: NaN },
  { account: { ...account, optionsBuyingPowerUsd: null } },
  { account: { ...account, optionsBuyingPowerUsd: NaN } },
  { account: { ...account, optionsBuyingPowerUsd: 0 } },
  { account: { ...account, tradingBlocked: true } },
  { account: { ...account, tradeSuspendedByUser: null } },
  { account: { ...account, optionsTradingLevel: 1 } }]) {
  assert.equal(evaluate(2, patch).allowed, false, JSON.stringify(patch));
}
const guard = makeFixedContractSubmissionGuard();
assert.equal(guard.claim("account"), true);
assert.equal(guard.claim("account"), false);
assert.equal(guard.claim("other-account"), true);
guard.finish("account", false); // partial/nonterminal fill or unknown request outcome
assert.equal(guard.claim("account"), false);
assert.equal(guard.state("account"), "reconciliation-required");
guard.finish("other-account", true); // known terminal zero/partial/full fill
assert.equal(guard.claim("other-account"), true);
assert.equal(supportsManifestCompatibility(RC54_WORKER_VERSION, RC54_WORKER_VERSION), true);
assert.equal(supportsManifestCompatibility(FIXED_CONTRACT_WORKER_COMPATIBILITY, RC54_WORKER_VERSION), true);
assert.equal(supportsManifestCompatibility("unknown", RC54_WORKER_VERSION), false);
assert.equal(supportsManifestCompatibility(FIXED_CONTRACT_WORKER_COMPATIBILITY, "old-unsupported-worker"), false);
// The old worker's strict equality fails closed for the new manifest identifier.
assert.notEqual(FIXED_CONTRACT_WORKER_COMPATIBILITY, RC54_WORKER_VERSION);

const canary = buildRc54NoopConfigurationCanary();
const runtime = buildReceiptBoundRuntimeConfiguration({ compiled: canary.simulation.candidate.compiled!,
  projection: canary.simulation.candidate.projection!, activationReceipt: canary.simulation.receipt! });
const oldRoot = runtime.roots.find(r => r.slug === "vb-macd-state")!;
const wideRoot = { ...oldRoot, quantity: 4, managerProfileId: "VB-MACD-WIDE20-50",
  configuration: { ...oldRoot.configuration, managerProfileId: "VB-MACD-WIDE20-50" },
  premiumCap: 1.75, aggregateDebitCap: 700,
  takeProfit: { kind: "bank" as const, targetPct: 20, fraction: 0 as const },
  stopLoss: { catastrophePct: 50, priceBasis: "executable-option-bid" as const },
  ratchetParameters: { kind: "none" as const, engageReturnPct: null, givebackPct: null, retainGainPct: null, fixedTargetPct: null } };
const legacy = buildReceiptBoundEntryPolicy(wideRoot);
const fixed = buildReceiptBoundEntryPolicy({ ...wideRoot, fixedContractAdmission: fixedContractAdmissionPolicy() });
assert.equal(legacy.policyVersion, "receipt-bound-entry-policy-v2");
assert.equal(fixed.policyVersion, "receipt-bound-entry-policy-v3");
assert.equal(fixed.premiumCap, null); assert.equal(fixed.aggregateDebitCap, null);
assert.deepEqual(fixed.takeProfit, legacy.takeProfit); assert.deepEqual(fixed.stopLoss, legacy.stopLoss);
assert.deepEqual(fixed.ratchetParameters, legacy.ratchetParameters);
assert.equal(parseReceiptBoundEntryPolicy({ ...fixed, premiumCap: 1.75 }), null);
assert.equal(parseReceiptBoundEntryPolicy({ ...fixed, quantity: 3 }), null);
assert.equal(parseReceiptBoundEntryPolicy({ ...fixed, policyVersion: "receipt-bound-entry-policy-v2" }), null);
assert.equal(parseReceiptBoundEntryPolicy({ ...legacy, fixedContractAdmission: fixedContractAdmissionPolicy() }), null);
for (const entryPrice of [.5, 1.75, 4.21, 10]) for (const ratio of [.1, .49, .5, .51, 1, 1.19, 1.2, 1.21, 2]) {
  const common = { isRunner: false, entryPrice, mark: entryPrice * ratio, peak: entryPrice * 1.3 };
  assert.equal(receiptBoundBankTargetReached({ ...common, policy: fixed }), receiptBoundBankTargetReached({ ...common, policy: legacy }));
  assert.equal(receiptBoundA13GivebackReached({ ...common, policy: fixed }), receiptBoundA13GivebackReached({ ...common, policy: legacy }));
  assert.equal(receiptBoundFixedTargetReached({ ...common, policy: fixed }), receiptBoundFixedTargetReached({ ...common, policy: legacy }));
}
for (const root of runtime.roots) {
  const policy = buildReceiptBoundEntryPolicy(root);
  assert.deepEqual(parseReceiptBoundEntryPolicy(JSON.parse(JSON.stringify(policy))), policy);
  assert.equal(policy.fixedContractAdmission, undefined);
}
const channels = runtime.roots.map(root => ({ id: root.strategistId, slug: root.slug,
  fixedContractAdmission: fixedContractAdmissionPolicy() } as ChannelConfig));
const rolledBack = applyReceiptBoundRuntimeFleetOverlay({ channels, runtime });
assert.ok(rolledBack.every(channel => channel.fixedContractAdmission === undefined));
console.log("fixedContractAffordability: PASS · threshold, invalid/missing data, concurrency, uncertainty, v1/v2/v3, native exits and rollback");
