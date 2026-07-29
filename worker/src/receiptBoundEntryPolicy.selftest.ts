import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import {
  buildReceiptBoundRuntimeConfiguration,
} from "./channelConfigurationRuntimeAdapter.js";
import {
  buildReceiptBoundEntryPolicy,
  parseReceiptBoundEntryPolicy,
  receiptBoundA13GivebackReached,
  receiptBoundBankTargetReached,
  receiptBoundConfiguredTakeProfitPct,
  receiptBoundEntryPolicyFromRow,
  receiptBoundEntryPolicyStampPresent,
  receiptBoundFixedTargetReached,
  receiptBoundNativeAtrExitEligible,
  receiptBoundRunnerConfiguration,
} from "./receiptBoundEntryPolicy.js";
import { RC54_MANAGER_PROFILES } from "./rc54ManagerPolicy.js";

const canary = buildRc54NoopConfigurationCanary();
const compiled = canary.simulation.candidate.compiled;
const projection = canary.simulation.candidate.projection;
const receipt = canary.simulation.receipt;
assert.ok(compiled);
assert.ok(projection);
assert.ok(receipt);
const runtime = buildReceiptBoundRuntimeConfiguration({
  compiled,
  projection,
  activationReceipt: receipt,
});

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

check("no-op receipt policies faithfully represent every RC5.4 manager", () => {
  for (const root of runtime.roots) {
    const policy = buildReceiptBoundEntryPolicy(root);
    const sealed = RC54_MANAGER_PROFILES[
      root.managerProfileId as keyof typeof RC54_MANAGER_PROFILES
    ];
    assert.ok(sealed);
    assert.equal(policy.quantity, root.quantity);
    assert.equal(policy.stopLoss.catastrophePct, sealed.catastropheStopPct);
    assert.equal(policy.takeProfit.targetPct, sealed.bankTargetPct);
    assert.equal(policy.takeProfit.fraction, sealed.runnerFraction);
    const expectedRatchet = sealed.runner === "fixed-50"
      ? "fixed-target"
      : sealed.runner;
    assert.equal(policy.ratchetParameters.kind, expectedRatchet);
  }
});

check("bank and fixed-runner targets use only the immutable policy", () => {
  const root = runtime.roots.find((item) =>
    item.ratchetParameters.kind === "fixed-target");
  assert.ok(root);
  const policy = buildReceiptBoundEntryPolicy(root);
  const bank = policy.takeProfit.targetPct;
  const fixed = policy.ratchetParameters.fixedTargetPct;
  assert.ok(bank);
  assert.ok(fixed);
  assert.equal(receiptBoundBankTargetReached({
    policy,
    isRunner: false,
    entryPrice: 1,
    mark: 1 + bank / 100,
  }), true);
  assert.equal(receiptBoundBankTargetReached({
    policy,
    isRunner: true,
    entryPrice: 1,
    mark: 10,
  }), false);
  assert.equal(receiptBoundFixedTargetReached({
    policy,
    isRunner: true,
    entryPrice: 1,
    mark: 1 + fixed / 100,
  }), true);
  assert.equal(receiptBoundConfiguredTakeProfitPct({
    policy,
    isRunner: false,
    reason: "target_premium",
  }), bank);
  assert.equal(receiptBoundConfiguredTakeProfitPct({
    policy,
    isRunner: true,
    reason: "target_premium",
  }), fixed);
});

check("A13 uses the stamped engage and retained-gain parameters", () => {
  const root = runtime.roots.find((item) =>
    item.ratchetParameters.kind === "a13"
      && item.takeProfit.fraction === 0);
  assert.ok(root);
  const policy = buildReceiptBoundEntryPolicy(root);
  const engage = policy.ratchetParameters.engageReturnPct;
  const retain = policy.ratchetParameters.retainGainPct;
  assert.ok(engage);
  assert.ok(retain);
  const peak = 1 + engage / 100;
  const floor = 1 + (peak - 1) * (retain / 100);
  assert.equal(receiptBoundA13GivebackReached({
    policy,
    isRunner: false,
    entryPrice: 1,
    mark: floor,
    peak,
  }), true);
  assert.equal(receiptBoundA13GivebackReached({
    policy,
    isRunner: true,
    entryPrice: 1,
    mark: floor,
    peak,
  }), false);
});

check("native ATR and runner allocation come from the stamped policy", () => {
  const root = runtime.roots.find((item) =>
    item.ratchetParameters.kind === "native-atr");
  assert.ok(root);
  const policy = buildReceiptBoundEntryPolicy(root);
  assert.equal(receiptBoundNativeAtrExitEligible({
    policy,
    isRunner: false,
    sealedReceiptBound: true,
  }), false);
  assert.equal(receiptBoundNativeAtrExitEligible({
    policy,
    isRunner: true,
    sealedReceiptBound: true,
  }), true);
  assert.deepEqual(receiptBoundRunnerConfiguration(policy), {
    frac: policy.takeProfit.fraction,
    givebackPct: 0,
  });
});

check("a malformed stamp remains visibly sealed and cannot be parsed", () => {
  const row = {
    entry_features: {
      receipt_bound_entry_policy: {
        policyVersion: "receipt-bound-entry-policy-v1",
        configuration: {},
      },
    },
  };
  assert.equal(receiptBoundEntryPolicyStampPresent(row), true);
  assert.equal(receiptBoundEntryPolicyFromRow(row), null);
  assert.equal(parseReceiptBoundEntryPolicy(
    row.entry_features.receipt_bound_entry_policy,
  ), null);
});

check("a bounded target change is represented without RC5.4 profile lookup", () => {
  const root = runtime.roots.find((item) =>
    item.takeProfit.kind === "bank"
      && item.takeProfit.targetPct != null);
  assert.ok(root);
  const base = buildReceiptBoundEntryPolicy(root);
  const changed = parseReceiptBoundEntryPolicy({
    ...base,
    takeProfit: {
      ...base.takeProfit,
      targetPct: Number(base.takeProfit.targetPct) + 5,
    },
    managerProfileId: `${base.managerProfileId}:bounded-preview`,
    managerVersion: `sha256:${"1".repeat(64)}`,
    configuration: {
      ...base.configuration,
      managerProfileId: `${base.managerProfileId}:bounded-preview`,
      managerVersion: `sha256:${"1".repeat(64)}`,
      channelSpecContentHash: `sha256:${"2".repeat(64)}`,
      configurationEpochId: `sha256:${"3".repeat(64)}`,
    },
  });
  assert.ok(changed);
  assert.equal(
    receiptBoundConfiguredTakeProfitPct({
      policy: changed,
      isRunner: false,
      reason: "target_premium",
    }),
    Number(base.takeProfit.targetPct) + 5,
  );
});

check("worker exit paths call the immutable policy helpers", () => {
  const exitRules = readFileSync(new URL("./exitRules.ts", import.meta.url), "utf8");
  const decide = readFileSync(new URL("./decide.ts", import.meta.url), "utf8");
  const execute = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(exitRules, /receiptBoundBankTargetReached/);
  assert.match(exitRules, /receiptBoundFixedTargetReached/);
  assert.match(exitRules, /receiptBoundA13GivebackReached/);
  assert.match(decide, /const sealedManagedRow = sealedRc54Row \|\| sealedReceiptBoundRow/);
  assert.match(decide, /sealedReceiptBoundRow[\s\S]*\? 0[\s\S]*ch\.premium_stop_pct/);
  assert.match(execute, /receiptBoundRunnerConfiguration\(receiptBoundPolicy\)/);
  assert.match(execute, /receiptBoundConfiguredTakeProfitPct/);
  assert.match(index, /receiptBoundPolicyStamped[\s\S]*\? 0[\s\S]*ch\.premium_stop_pct/);
});

console.log(`receipt-bound entry policy self-test passed (${checks} checks)`);
