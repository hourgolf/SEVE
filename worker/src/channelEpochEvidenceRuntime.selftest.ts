import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRc54NoopConfigurationCanary } from "../../lib/channels/rc54NoopConfigurationCanary.js";
import type { ShadowDecision } from "./decide.js";
import { buildDecisionObservation } from "./executionObservationModel.js";
import {
  buildShadowPlanEvidence,
  observedOpportunityId,
} from "./planShadowModel.js";
import {
  applyReceiptBoundRuntimeFleetOverlay,
  buildProductionReceiptBoundRuntimeConfiguration,
  configurationWriteStampForChannel,
} from "./channelConfigurationRuntimeAdapter.js";
import type { ChannelConfig } from "./store.js";

const canary = buildRc54NoopConfigurationCanary();
const compiled = canary.simulation.candidate.compiled;
const projection = canary.simulation.candidate.projection;
const receipt = canary.simulation.receipt;
assert.ok(compiled);
assert.ok(projection);
assert.ok(receipt);
const databaseIdentity = {
  releaseManifestDatabaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  channelSpecDatabaseIdsByVersionKey: Object.fromEntries(
    compiled.channelSpecs.map((spec, index) => [
      spec.id,
      `bbbbbbbb-bbbb-4bbb-8bb${index}-bbbbbbbbbbb${index}`,
    ]),
  ),
};
const runtime = buildProductionReceiptBoundRuntimeConfiguration({
  compiled,
  projection,
  activationReceipt: receipt,
  databaseIdentity,
});
const root = runtime.roots[0];
assert.ok(root);
const source: ChannelConfig = {
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
};
const channel = applyReceiptBoundRuntimeFleetOverlay({
  channels: [source],
  runtime: {
    ...runtime,
    roots: [root],
  },
})[0];
assert.ok(channel);
const configurationWriteStamp = configurationWriteStampForChannel({
  runtime,
  channelSlug: root.slug,
});
const decisionAtMs = Date.parse("2026-07-28T14:35:00.000Z");
const decision: ShadowDecision = {
  slug: root.slug,
  status: "armed",
  action: "enter",
  reason: "fixture-entry",
  direction: "call",
  occ: "SPY260728C00640000",
  qty: root.quantity,
  blocked: null,
  detail: {
    ask: Math.min(1, root.premiumCap),
    bid: 0.95,
    mid: 0.975,
    expiry: "2026-07-28",
  },
};

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks++;
  void name;
}

check("candidate observation carries the exact reviewed relational and semantic stamp", () => {
  const row = buildDecisionObservation({
    channel,
    decision,
    accountId: root.accountId,
    decisionAtMs,
    observedAtMs: decisionAtMs + 1_000,
    chainAgeMs: 500,
    configurationWriteStamp,
  });
  assert.ok(row);
  assert.equal(
    row.channel_spec_version_id,
    configurationWriteStamp.channel_spec_version_id,
  );
  assert.equal(row.release_manifest_id, configurationWriteStamp.release_manifest_id);
  assert.equal(
    row.configuration_epoch_id,
    configurationWriteStamp.configuration_epoch_id,
  );
  assert.deepEqual(
    row.payload.configurationIdentity,
    configurationWriteStamp.configuration_identity,
  );
});

check("receipt-bound opportunity identity cannot collide with the legacy identity", () => {
  const base = {
    strategistId: channel.id,
    accountId: root.accountId,
    occ: decision.occ ?? "",
    direction: decision.direction ?? "",
    reason: decision.reason,
    decisionAtMs,
  };
  const legacy = observedOpportunityId(base);
  const receiptBound = observedOpportunityId({
    ...base,
    configurationEpochId: configurationWriteStamp.configuration_epoch_id,
  });
  assert.notEqual(receiptBound, legacy);
  assert.equal(legacy, observedOpportunityId(base));
});

check("position plan carries the same exact relational epoch", () => {
  const evidence = buildShadowPlanEvidence({
    channel,
    decision,
    accountId: root.accountId,
    decisionAtMs,
    workerVersion: compiled.manifest.workerCompatibilityVersion,
    defaultPremiumStopPct: 50,
    executableManagerProfile: root.managerProfileId,
    configurationWriteStamp,
  });
  assert.ok(evidence);
  assert.equal(
    evidence.plan.channel_spec_version_id,
    configurationWriteStamp.channel_spec_version_id,
  );
  assert.equal(
    evidence.plan.release_manifest_id,
    configurationWriteStamp.release_manifest_id,
  );
  assert.equal(
    evidence.plan.configuration_epoch_id,
    configurationWriteStamp.configuration_epoch_id,
  );
  assert.deepEqual(
    evidence.epoch.policy_json.configurationIdentity,
    configurationWriteStamp.configuration_identity,
  );
  assert.deepEqual(
    evidence.epoch.policy_json.receiptBoundEntryPolicy,
    configurationWriteStamp.entry_policy,
  );
});

check("legacy evidence omits the new identity without changing its call contract", () => {
  const row = buildDecisionObservation({
    channel,
    decision,
    accountId: root.accountId,
    decisionAtMs,
    observedAtMs: decisionAtMs + 1_000,
    chainAgeMs: 500,
  });
  assert.ok(row);
  assert.equal(row.channel_spec_version_id, null);
  assert.equal(row.release_manifest_id, null);
  assert.equal(row.configuration_epoch_id, null);
  assert.equal(row.payload.configurationIdentity, undefined);
});

check("execution path stamps entry artifacts but not current-config exits", () => {
  const source = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
  assert.match(source, /configurationWriteStamp: positionId[\s\S]*\? null/);
  assert.match(source, /configuration_identity:[\s\S]*configuration_identity/);
  assert.match(
    source,
    /receipt_bound_entry_policy:[\s\S]*entry_policy/,
  );
  assert.match(source, /channel_spec_version_id:[\s\S]*channel_spec_version_id/);
  assert.match(
    source,
    /observed_policy_configuration_epoch_id:[\s\S]*policyIdentity\?\.configurationEpochId/,
  );
});

check("runner and partial remainders copy the parent epoch verbatim", () => {
  const source = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  const mapper = readFileSync(new URL("./exitGuard.ts", import.meta.url), "utf8");
  assert.match(
    mapper,
    /channel_spec_version_id: p\.channel_spec_version_id \?\? null/,
  );
  assert.match(
    mapper,
    /release_manifest_id: p\.release_manifest_id \?\? null/,
  );
  assert.match(
    mapper,
    /configuration_epoch_id: p\.configuration_epoch_id \?\? null/,
  );
  assert.match(
    source,
    /channel_spec_version_id: parent\.channel_spec_version_id \?\? null/,
  );
  assert.match(
    source,
    /release_manifest_id: parent\.release_manifest_id \?\? null/,
  );
  assert.match(
    source,
    /configuration_epoch_id: parent\.configuration_epoch_id \?\? null/,
  );
});

check("runtime stamps only receipt-bound new entries behind the default-off gate", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const configSource = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  assert.match(source, /channelConfigurationRuntimeBridge/);
  assert.match(
    configSource,
    /CHANNEL_CONFIGURATION_RUNTIME_ENABLED",\s*false/,
  );
  assert.match(
    source,
    /currentReceiptRuntime[\s\S]*d\.action === "enter"[\s\S]*receiptBoundRc54ConfigurationWriteStamp/,
  );
  assert.match(
    source,
    /receiptBoundRoot[\s\S]*currentReceiptRuntime && receiptBoundRoot[\s\S]*d\.action === "enter"/,
  );
  assert.match(
    source,
    /captureDecisionObservation\(\{[\s\S]*configurationWriteStamp/,
  );
});

console.log(`channel epoch evidence runtime self-test passed (${checks} checks)`);
