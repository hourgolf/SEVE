import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import {
  buildReceiptBoundRuntimeConfiguration,
  evaluateNextSafeEntry,
  stampReceiptBoundEntry,
} from "./channelConfigurationRuntimeAdapter.js";
import {
  RC54_MANAGER_PROFILES,
} from "./rc54ManagerPolicy.js";
import { RC54_ROOTS } from "./rc54ReleasePolicy.js";

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
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("no-op adapter exactly represents sealed RC5.4 economics", () => {
  assert.equal(runtime.state, "receipt-bound");
  assert.equal(runtime.paperOnly, true);
  assert.equal(runtime.runtimeMutationAuthorized, false);
  assert.equal(runtime.orderAuthority, false);
  assert.equal(runtime.roots.length, RC54_ROOTS.length);
  for (const sealed of RC54_ROOTS) {
    const root = runtime.roots.find((candidate) => candidate.slug === sealed.slug);
    const profile = RC54_MANAGER_PROFILES[sealed.managerProfileId];
    assert.ok(root);
    assert.equal(root.accountId, sealed.accountId);
    assert.equal(root.quantity, sealed.quantity);
    assert.equal(root.premiumCap, sealed.premiumCap);
    assert.equal(root.aggregateDebitCap, sealed.aggregateDebitCap);
    assert.equal(root.managerProfileId, sealed.managerProfileId);
    assert.equal(root.stopLoss.catastrophePct, profile.catastropheStopPct);
    assert.equal(root.takeProfit.targetPct, profile.bankTargetPct);
    assert.equal(root.takeProfit.fraction, profile.runnerFraction);
    assert.equal(root.configuration.configurationEpochId, runtime.configurationEpochId);
  }
});

check("eligible next entry uses the exact receipt-bound quantity and account", () => {
  const root = runtime.roots.find((candidate) => candidate.slug === "orb-ustop-ctl");
  assert.ok(root);
  const result = evaluateNextSafeEntry({
    runtime,
    channelSlug: root.slug,
    routedAccountId: root.accountId,
    ask: 1.25,
    evaluatedAt: "2026-07-28T23:00:20.000Z",
    safeBoundaryReceiptObserved: true,
  });
  assert.equal(result.state, "eligible");
  assert.equal(result.quantity, 2);
  assert.equal(result.aggregateDebit, 250);
  assert.equal(result.configuration?.channelSpecVersionId, root.channelSpecVersionId);
  assert.equal(result.orderAuthority, false);
});

check("missing receipt cannot create a runtime configuration", () => {
  assert.throws(() => buildReceiptBoundRuntimeConfiguration({
    compiled,
    projection,
    activationReceipt: null,
  }), /requires an activation receipt/);
});

check("missing runtime, boundary receipt, or account agreement blocks", () => {
  const root = runtime.roots[0];
  assert.ok(root);
  const missingRuntime = evaluateNextSafeEntry({
    runtime: null,
    channelSlug: root.slug,
    routedAccountId: root.accountId,
    ask: 1,
    evaluatedAt: "2026-07-28T23:00:20.000Z",
    safeBoundaryReceiptObserved: true,
  });
  assert.equal(missingRuntime.state, "blocked");
  assert.equal(missingRuntime.blockers.includes("runtime_configuration:missing"), true);
  const mismatched = evaluateNextSafeEntry({
    runtime,
    channelSlug: root.slug,
    routedAccountId: "wrong-account",
    ask: 1,
    evaluatedAt: "2026-07-28T23:00:20.000Z",
    safeBoundaryReceiptObserved: false,
  });
  assert.equal(mismatched.state, "blocked");
  assert.equal(mismatched.blockers.includes("runtime_configuration:account_route_mismatch"), true);
  assert.equal(mismatched.blockers.includes("runtime_configuration:safe_boundary_receipt_missing"), true);
});

check("future activation and debit-cap violations block", () => {
  const root = runtime.roots.find((candidate) => candidate.slug === "orb-ustop-ctl");
  assert.ok(root);
  const result = evaluateNextSafeEntry({
    runtime,
    channelSlug: root.slug,
    routedAccountId: root.accountId,
    ask: root.premiumCap + 0.01,
    evaluatedAt: "2026-07-28T22:00:00.000Z",
    safeBoundaryReceiptObserved: true,
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.blockers.includes("runtime_configuration:not_yet_active"), true);
  assert.equal(result.blockers.includes("runtime_configuration:premium_cap"), true);
  assert.equal(result.blockers.includes("runtime_configuration:aggregate_debit_cap"), true);
});

check("new entry stamp binds the same manifest, spec, and epoch", () => {
  const stamp = stampReceiptBoundEntry({
    runtime,
    compiled,
    projection,
    channelSlug: "orb-ustop-ctl",
    positionId: "position:runtime-adapter-fixture",
    enteredAt: "2026-07-28T23:00:20.000Z",
  });
  const root = runtime.roots.find((candidate) => candidate.slug === stamp.channelSlug);
  assert.ok(root);
  assert.equal(stamp.releaseManifestId, runtime.releaseManifestId);
  assert.equal(stamp.channelSpecVersionId, root.channelSpecVersionId);
  assert.equal(stamp.configurationEpochId, runtime.configurationEpochId);
  assert.equal(stamp.quantity, root.quantity);
  assert.equal(stamp.accountId, root.accountId);
});

check("adapter is dormant and not imported by the active worker", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(indexSource, /channelConfigurationRuntimeAdapter/);
});

console.log(`channel configuration runtime adapter self-test passed (${checks} checks)`);
