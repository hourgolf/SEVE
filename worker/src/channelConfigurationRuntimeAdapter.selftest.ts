import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import {
  applyReceiptBoundRuntimeFleetOverlay,
  buildProductionReceiptBoundRuntimeConfiguration,
  buildReceiptBoundRuntimeConfiguration,
  configurationWriteStampForChannel,
  evaluateNextSafeEntry,
  stampReceiptBoundEntry,
  validateReceiptBoundRuntimeStartup,
} from "./channelConfigurationRuntimeAdapter.js";
import {
  RC54_MANAGER_PROFILES,
} from "./rc54ManagerPolicy.js";
import { RC54_ROOTS } from "./rc54ReleasePolicy.js";
import type { AccountRow, ChannelConfig } from "./store.js";

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
const productionRuntime = buildProductionReceiptBoundRuntimeConfiguration({
  compiled,
  projection,
  activationReceipt: receipt,
  databaseIdentity: {
    releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
      compiled.channelSpecs.map((spec, index) => [
        spec.id,
        `bbbbbbbb-bbbb-4bbb-8bb${index}-bbbbbbbbbbb${index}`,
      ]),
    ),
  },
});

const sourceChannel = (slug: string): ChannelConfig => {
  const root = RC54_ROOTS.find((candidate) => candidate.slug === slug);
  if (!root) throw new Error(`unknown fixture root: ${slug}`);
  return {
    id: root.strategistId,
    slug,
    name: slug,
    status: "draft",
    spec_json: null,
    underlying: root.underlying,
    executor: "stream",
    account_id: null,
    is_active: true,
    capital_pct: 1,
    aggression: 0,
    max_contracts: 99,
    daily_stop_usd: 999,
    daily_target_usd: 999,
    underlying_stop_pct: 0,
    muted: false,
    soloed: false,
    boosted: false,
    event_policy: "standdown",
    entry_dte: 0,
    strike_offset: 0,
    premium_stop_pct: 90,
    take_profit_pct: 90,
    pyramid_adds: 0,
    stall_minutes: 0,
    stall_max_favor_pct: 0,
    gap_min: 0,
    runner_frac: 0,
    runner_giveback_pct: 0,
  };
};
const sourceChannels = RC54_ROOTS.map((root) => sourceChannel(root.slug));
const accountIds = [...new Set(RC54_ROOTS.map((root) => root.accountId))].sort();
const accounts: AccountRow[] = accountIds.map((id) => ({
  id,
  name: id,
  mode: "paper",
  cred_ref: null,
  is_armed: true,
  is_halted: false,
  master_daily_stop_usd: 0,
}));

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
  assert.equal(runtime.configurationAuthority, "receipt-bound-new-entry-only");
  assert.equal(runtime.historicalMutationAuthorized, false);
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

check("receipt-bound overlay ignores mutable strategist economics and routing", () => {
  const overlaid = applyReceiptBoundRuntimeFleetOverlay({
    channels: sourceChannels,
    runtime: productionRuntime,
  });
  for (const root of productionRuntime.roots) {
    const channel = overlaid.find((candidate) => candidate.slug === root.slug);
    assert.ok(channel);
    assert.equal(channel.id, root.strategistId);
    assert.equal(channel.account_id, root.accountId);
    assert.equal(channel.max_contracts, root.riskLimits.maxContracts);
    assert.equal(channel.capital_pct, root.riskLimits.maxRiskUsd);
    assert.equal(channel.entry_dte, root.entryDte);
    assert.equal(channel.strike_offset, root.strikeOffset);
    assert.equal(channel.premium_stop_pct, root.stopLoss.catastrophePct);
    assert.equal(
      channel.take_profit_pct,
      root.takeProfit.kind === "bank" ? root.takeProfit.targetPct : 0,
    );
    assert.equal(channel.runner_frac, root.takeProfit.fraction);
  }
});

check("one reviewed root produces one exact all-or-none database write stamp", () => {
  const root = productionRuntime.roots[0];
  assert.ok(root);
  const stamp = configurationWriteStampForChannel({
    runtime: productionRuntime,
    channelSlug: root.slug,
  });
  assert.equal(stamp.channel_spec_version_id, root.channelSpecVersionDatabaseId);
  assert.equal(stamp.release_manifest_id, productionRuntime.releaseManifestDatabaseId);
  assert.equal(stamp.configuration_epoch_id, productionRuntime.configurationEpochId);
  assert.equal(stamp.configuration_identity.channelSlug, root.slug);
  assert.equal(stamp.configuration_identity.accountId, root.accountId);
  assert.equal(stamp.configuration_identity.channelSpecContentHash, root.channelSpecContentHash);
  assert.equal(stamp.entry_policy.configuration.configurationEpochId, runtime.configurationEpochId);
  assert.equal(stamp.entry_policy.quantity, root.quantity);
  assert.deepEqual(stamp.entry_policy.takeProfit, root.takeProfit);
  assert.deepEqual(stamp.entry_policy.stopLoss, root.stopLoss);
  assert.deepEqual(stamp.entry_policy.ratchetParameters, root.ratchetParameters);
});

check("simulation-only runtime cannot produce a database write stamp", () => {
  assert.throws(() => configurationWriteStampForChannel({
    runtime,
    channelSlug: runtime.roots[0]?.slug ?? "",
  }), /verified database identity/);
});

check("generic startup validation proves paper routes and worker compatibility", () => {
  const result = validateReceiptBoundRuntimeStartup({
    runtime: productionRuntime,
    channels: sourceChannels,
    accounts,
    fundMode: "paper",
    workerCompatibilityVersion: productionRuntime.workerCompatibilityVersion,
    resolvedCredentialAccountIds: accountIds,
  });
  assert.equal(result.state, "ready");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.channels.length, sourceChannels.length);
  assert.deepEqual(result.configuredPaperAccountIds, accountIds);
  assert.equal(result.configurationEpochId, productionRuntime.configurationEpochId);
  assert.equal(result.orderAuthority, false);
});

check("generic startup fails closed on credentials, account mode, or compatibility", () => {
  const result = validateReceiptBoundRuntimeStartup({
    runtime: productionRuntime,
    channels: sourceChannels,
    accounts: accounts.map((account, index) =>
      index === 0 ? { ...account, mode: "live" } : account),
    fundMode: "paper",
    workerCompatibilityVersion: "wrong-worker-version",
    resolvedCredentialAccountIds: accountIds.slice(1),
  });
  assert.equal(result.state, "blocked");
  assert.equal(
    result.blockers.some((blocker) => blocker.includes("account_not_paper")),
    true,
  );
  assert.equal(
    result.blockers.some((blocker) => blocker.includes("credential_route_missing")),
    true,
  );
  assert.equal(
    result.blockers.includes("runtime_configuration:worker_compatibility_mismatch"),
    true,
  );
});

check("source strategist mismatch blocks the overlay", () => {
  assert.throws(() => applyReceiptBoundRuntimeFleetOverlay({
    runtime: productionRuntime,
    channels: sourceChannels.map((channel, index) => index
      ? channel
      : { ...channel, id: "99999999-9999-4999-8999-999999999999" }),
  }), /strategist mismatch/);
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

check("adapter is reachable only through the default-off reviewed bridge", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const configSource = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  assert.match(indexSource, /channelConfigurationRuntimeAdapter/);
  assert.match(indexSource, /if \(config\.channelConfigurationRuntimeEnabled\)/);
  assert.match(
    configSource,
    /CHANNEL_CONFIGURATION_RUNTIME_ENABLED",\s*false/,
  );
  assert.match(indexSource, /resolution\.state === "blocked"[\s\S]*throw new Error/);
});

console.log(`channel configuration runtime adapter self-test passed (${checks} checks)`);
