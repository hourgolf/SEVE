import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRc54ControlPlaneBootstrap,
  reconstructRc54Bootstrap,
} from "../../lib/channels/rc54ControlPlaneBootstrap.js";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import type {
  StoredReceiptBoundControlPlaneRead,
} from "../../lib/channels/channelControlPlanePersistence.js";
import {
  resolveDormantChannelRuntimeAuthority,
  type ChannelRuntimeBridgeInput,
} from "./channelConfigurationRuntimeBridge.js";
import type { AccountRow, ChannelConfig } from "./store.js";

const baseline = reconstructRc54Bootstrap(buildRc54ControlPlaneBootstrap());
const canary = buildRc54NoopConfigurationCanary();
const candidate = canary.simulation.candidate.compiled;
const receipt = canary.simulation.receipt;
assert.ok(candidate);
assert.ok(receipt);

const channels: ChannelConfig[] = candidate.workerProjection.roots.map((root) => ({
  id: root.strategistId,
  slug: root.slug,
  name: root.slug,
  status: "draft",
  spec_json: null,
  underlying: root.underlying,
  executor: "stream",
  account_id: null,
  is_active: true,
  capital_pct: 0,
  aggression: 0,
  max_contracts: 99,
  daily_stop_usd: 0,
  daily_target_usd: 0,
  underlying_stop_pct: 0,
  muted: false,
  soloed: false,
  boosted: false,
  event_policy: "standdown",
  entry_dte: 0,
  strike_offset: 0,
  premium_stop_pct: 99,
  take_profit_pct: 99,
  pyramid_adds: 0,
  stall_minutes: 0,
  stall_max_favor_pct: 0,
  gap_min: 0,
  runner_frac: 0,
  runner_giveback_pct: 0,
}));
const accountIds = [
  ...new Set(candidate.workerProjection.roots.map((root) => root.accountId)),
].sort();
const accounts: AccountRow[] = accountIds.map((id) => ({
  id,
  name: id,
  mode: "paper",
  cred_ref: null,
  is_armed: true,
  is_halted: false,
  master_daily_stop_usd: 0,
}));
const runtime: ChannelRuntimeBridgeInput = {
  channels,
  accounts,
  fundMode: "paper",
  workerCompatibilityVersion: candidate.manifest.workerCompatibilityVersion,
  resolvedCredentialAccountIds: accountIds,
  allowUnadoptedRc54Baseline: false,
};
const databaseIdentity = {
  releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
    candidate.channelSpecs.map((spec, index) => [
      spec.id,
      `bbbbbbbb-bbbb-4bbb-8bb${index}-bbbbbbbbbbb${index}`,
    ]),
  ),
};
const receiptBoundStored: StoredReceiptBoundControlPlaneRead = {
  compiled: candidate,
  activationReceipt: receipt,
  databaseIdentity,
  state: "receipt-bound",
  error: null,
};
const baselineStored: StoredReceiptBoundControlPlaneRead = {
  compiled: baseline,
  activationReceipt: null,
  databaseIdentity: {
    releaseManifestDatabaseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
      baseline.channelSpecs.map((spec, index) => [
        spec.id,
        `dddddddd-dddd-4ddd-8dd${index}-ddddddddddd${index}`,
      ]),
    ),
  },
  state: "baseline-active",
  error: null,
};

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

check("an explicit pre-adoption fallback preserves sealed RC5.4", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "not-adopted",
      error: null,
    },
    runtime: { ...runtime, allowUnadoptedRc54Baseline: true },
  });
  assert.equal(result.state, "sealed-rc5.4");
  assert.equal(result.sourceState, "not-adopted");
  assert.equal(result.requiresExistingRc54StartupGate, true);
  assert.equal(result.orderAuthority, false);
});

check("missing adoption fails closed once adoption is required", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "not-adopted",
      error: null,
    },
    runtime,
  });
  assert.equal(result.state, "blocked");
  assert.deepEqual(result.blockers, ["runtime_bridge:control_plane_adoption_required"]);
});

check("a read failure cannot silently fall back to RC5.4", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: {
      compiled: null,
      activationReceipt: null,
      databaseIdentity: null,
      state: "failed",
      error: "fixture:network",
    },
    runtime: { ...runtime, allowUnadoptedRc54Baseline: true },
  });
  assert.equal(result.state, "blocked");
  assert.match(result.blockers[0] ?? "", /control_plane_read_failed/);
});

check("the exact adopted baseline remains under the sealed RC5.4 gate", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: baselineStored,
    runtime,
  });
  assert.equal(result.state, "sealed-rc5.4");
  assert.equal(result.sourceState, "baseline-active");
  assert.equal(result.runtime, null);
  assert.equal(result.requiresExistingRc54StartupGate, true);
});

check("baseline identity drift blocks instead of reinterpreting RC5.4", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: {
      ...baselineStored,
      compiled: {
        ...baseline,
        manifest: {
          ...baseline.manifest,
          contentHash: `sha256:${"0".repeat(64)}`,
        },
      },
    },
    runtime,
  });
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.includes("runtime_bridge:baseline_manifest_hash_mismatch"));
});

check("one exact activation receipt resolves the generic runtime", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: receiptBoundStored,
    runtime,
  });
  assert.equal(result.state, "receipt-bound");
  if (result.state !== "receipt-bound") throw new Error("fixture did not resolve");
  assert.equal(result.configurationEpochId, receipt.configurationEpochId);
  assert.equal(result.runtime.databaseIdentityState, "verified");
  assert.equal(result.runtime.configurationAuthority, "receipt-bound-new-entry-only");
  assert.equal(result.runtime.historicalMutationAuthorized, false);
  assert.equal(result.orderAuthority, false);
  for (const root of result.runtime.roots) {
    const channel = result.channels.find((item) => item.slug === root.slug);
    assert.ok(channel);
    assert.equal(channel.account_id, root.accountId);
    assert.equal(channel.max_contracts, root.riskLimits.maxContracts);
  }
});

check("receipt-bound state without a receipt blocks", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: { ...receiptBoundStored, activationReceipt: null },
    runtime,
  });
  assert.equal(result.state, "blocked");
  assert.deepEqual(result.blockers, ["runtime_bridge:activation_receipt_missing"]);
});

check("worker compatibility drift blocks receipt-bound startup", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: receiptBoundStored,
    runtime: { ...runtime, workerCompatibilityVersion: "fixture:wrong-worker" },
  });
  assert.equal(result.state, "blocked");
  assert.ok(
    result.blockers.includes("runtime_configuration:worker_compatibility_mismatch"),
  );
});

check("a non-paper routed account blocks receipt-bound startup", () => {
  const result = resolveDormantChannelRuntimeAuthority({
    stored: receiptBoundStored,
    runtime: {
      ...runtime,
      accounts: accounts.map((account, index) => index
        ? account
        : { ...account, mode: "live" }),
    },
  });
  assert.equal(result.state, "blocked");
  assert.ok(result.blockers.some((item) => item.includes("account_not_paper")));
});

check("the bridge remains dormant in the active worker entrypoint", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(indexSource, /channelConfigurationRuntimeBridge/);
  assert.doesNotMatch(indexSource, /resolveDormantChannelRuntimeAuthority/);
  assert.doesNotMatch(indexSource, /loadDormantChannelRuntimeAuthority/);
});

console.log(`channel configuration runtime bridge self-test passed (${checks} checks)`);
