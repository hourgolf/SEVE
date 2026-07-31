import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileReleaseManifest } from "../../lib/channels/channelControlPlane.js";
import {
  CHANNEL_PORTFOLIO_CAPACITY_VERSION,
  type PortfolioCapacityEnvelope,
} from "../../lib/channels/channelPortfolioCapacity.js";
import {
  buildChannelRosterBundlePreview,
} from "../../lib/channels/channelRosterBundle.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "../../lib/channels/rc54ControlPlaneFixture.js";
import type { ResearchChannelRegistry } from "../../lib/channels/researchChannelRegistry.js";
import {
  stageStoredChannelRosterBundle,
} from "./channelRosterBundleWatcher.js";
import {
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID,
  RC54_ROOTS,
} from "./rc54ReleasePolicy.js";
import {
  RC54_WORKER_VERSION,
  WORKER_RUNTIME_VERSION,
} from "./version.js";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const bundleId = "11111111-1111-4111-8111-111111111111";
const acknowledgementId = "22222222-2222-4222-8222-222222222222";
const lifecycleReceiptId = "33333333-3333-4333-8333-333333333333";
const operatorId = "44444444-4444-4444-8444-444444444444";
const bootId = "55555555-5555-4555-8555-555555555555";
const observedAt = "2026-07-31T20:00:02.000Z";
const paperAccounts = [...new Set(active.channelSpecs.map((spec) => spec.accountId))];

const registry: ResearchChannelRegistry = {
  registryVersion: "research-channel-registry-v1",
  entries: [],
  bySlug: {},
  summary: { registered: 0, paperEligible: 0, blocked: 0 },
  contentHash: `sha256:${"a".repeat(64)}`,
  executionAuthority: false,
  runtimeMutationAuthorized: false,
  orderAuthority: false,
};

const envelope: PortfolioCapacityEnvelope = {
  version: CHANNEL_PORTFOLIO_CAPACITY_VERSION,
  paperOnly: true,
  maxContractsPerEntry: 12,
  accounts: paperAccounts.map((accountId) => ({
    accountId,
    equityUsd: 100_000,
    maxConcurrentDebitUsd: 20_000,
    maxConcurrentRiskUsd: 10_000,
    maxDebitPctOfEquity: 0.20,
    maxRiskPctOfEquity: 0.10,
    maxOpenPositions: 12,
  })),
  underlyings: ["SPY", "QQQ", "IWM"].map((underlying) => ({
    underlying,
    maxConcurrentDebitUsd: 20_000,
    maxConcurrentRiskUsd: 10_000,
    maxOpenPositions: 12,
  })),
  correlationGroups: [{
    id: "US-INDEX-LONG-PREMIUM",
    underlyings: ["SPY", "QQQ", "IWM"],
    maxConcurrentDebitUsd: 30_000,
    maxConcurrentRiskUsd: 15_000,
    maxOpenPositions: 18,
  }],
};

const preview = buildChannelRosterBundlePreview({
  active,
  registry,
  draft: {
    id: bundleId,
    baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    changes: [{ slug: "pb-ride", quantity: 4 }],
    reason: "Stage a bounded paper-only atomic sizing canary.",
    evidenceRefs: ["fixture:operator:bundle"],
    operatorId,
    createdAt: "2026-07-31T20:00:00.000Z",
  },
  envelope,
  live: {
    complete: true,
    observedAt: "2026-07-31T20:00:00.000Z",
    openOrders: 0,
    positions: [],
  },
  collectionStates: new Map(active.channelSpecs.map((spec) =>
    [spec.channelId, "active" as const])),
});
assert.equal(preview.state, "ready-for-worker-ack");
assert.ok(preview.candidate);
assert.ok(preview.capacity);

const bundle = {
  id: bundleId,
  state: "draft",
  base_manifest_key: active.manifest.id,
  base_manifest_content_hash: active.manifest.contentHash,
  candidate_manifest: preview.candidate.manifest,
  candidate_specs: preview.candidate.channelSpecs,
  worker_projection: preview.candidate.workerProjection,
  dashboard_projection: preview.candidate.dashboardProjection,
  validation_results: preview.candidate.validationResults,
  capacity_evaluation: preview.capacity,
  exact_diffs: preview.diffs,
  evidence_refs: preview.evidenceRefs,
  configuration_epoch_id: preview.configurationEpochId,
};

const startupReceipt = {
  releaseId: RC54_RELEASE_ID,
  workerVersion: RC54_WORKER_VERSION,
  releaseConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
  fundMode: "paper",
  roots: RC54_ROOTS.map((root) => ({
    slug: root.slug,
    accountId: root.accountId,
    managerProfileId: root.managerProfileId,
    quantity: root.quantity,
  })),
  runtimeReadiness: {
    heldCaptureReady: true,
    heldCaptureStartedBeforeBootDecision: true,
  },
};

function stage(overrides: Record<string, unknown> = {}) {
  return stageStoredChannelRosterBundle({
    active,
    envelope: { bundle: { ...bundle, ...overrides } },
    acknowledgementId,
    validatedLifecycleReceiptId: lifecycleReceiptId,
    currentReleaseId: active.manifest.releaseId,
    currentWorkerVersion: RC54_WORKER_VERSION,
    currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
    bootId,
    paperMode: true,
    heldCaptureReady: true,
    startupReceipt,
    observedAt,
  });
}

const staged = stage();
assert.equal(staged.state, "acknowledged");
assert.deepEqual(staged.blockers, []);
assert.equal(staged.acknowledgementRpcArgs?.p_bundle_id, bundleId);
assert.equal(
  staged.acknowledgementRpcArgs?.p_validated_lifecycle_receipt_id,
  lifecycleReceiptId,
);
assert.equal(staged.runtimeMutation, false);
assert.equal(staged.orderAuthority, false);

const drifted = stage({ configuration_epoch_id: `sha256:${"0".repeat(64)}` });
assert.equal(drifted.state, "blocked");
assert.ok(drifted.blockers.includes("bundle:configuration_epoch_drift"));
assert.equal(drifted.acknowledgementRpcArgs, null);

const authorityBearing = stage({
  capacity_evaluation: { ...preview.capacity, orderAuthority: true },
});
assert.equal(authorityBearing.state, "blocked");
assert.ok(authorityBearing.blockers.includes("bundle:capacity_invalid"));
assert.equal(authorityBearing.acknowledgementRpcArgs, null);

const storeSource = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const watcherSource = readFileSync(
  new URL("./channelRosterBundleWatcher.ts", import.meta.url),
  "utf8",
);
assert.match(storeSource, /loadPendingChannelRosterBundles/);
assert.match(storeSource, /state,lifecycle_receipt_id/);
assert.match(storeSource, /\.eq\("state", "draft"\)/);
assert.match(storeSource, /acknowledge_channel_roster_bundle/);
assert.match(indexSource, /stageStoredChannelRosterBundle/);
assert.match(indexSource, /acknowledgeChannelRosterBundle/);
assert.doesNotMatch(indexSource, /envelope\.bundle\.state === "validated"/);
assert.match(indexSource, /}, 30_000\); \/\/ one-shot draft acknowledgement/);
assert.match(
  indexSource,
  /if \(!channelControlMutationWindow\(Date\.now\(\)\)\.allowed\) return;/,
);
assert.doesNotMatch(watcherSource, /from "\.\/alpaca|from "\.\/execute/);
assert.doesNotMatch(watcherSource, /placeOrder|submitOrder/);

console.log("channel-roster-bundle-watcher-selftest: 10/10 passed");
