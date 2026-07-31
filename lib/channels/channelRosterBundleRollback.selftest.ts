import assert from "node:assert/strict";
import { compileReleaseManifest } from "./channelControlPlane.js";
import {
  CHANNEL_PORTFOLIO_CAPACITY_VERSION,
  type LivePortfolioTruth,
  type PortfolioCapacityEnvelope,
} from "./channelPortfolioCapacity.js";
import { buildChannelRosterBundlePreview } from "./channelRosterBundle.js";
import { buildShadowRuntimeProjection } from "./channelActivation.js";
import {
  buildExactRosterRollbackPreview,
  prepareExactRosterRollbackDraftWrite,
  rollbackRestoresExactSemantics,
} from "./channelRosterBundleRollback.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";
import type { ResearchChannelRegistry } from "./researchChannelRegistry.js";

const target = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const accounts = [...new Set(target.channelSpecs.map((spec) => spec.accountId))];
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
  accounts: accounts.map((accountId) => ({
    accountId,
    equityUsd: 100_000,
    maxConcurrentDebitUsd: 10_000,
    maxConcurrentRiskUsd: 5_000,
    maxDebitPctOfEquity: 0.10,
    maxRiskPctOfEquity: 0.05,
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
const flat = (): LivePortfolioTruth => ({
  complete: true,
  observedAt: "2026-07-31T21:00:00.000Z",
  openOrders: 0,
  positions: [],
});
const collectionStates = new Map<string, "active" | "paused" | "archived">(
  target.channelSpecs.map((spec) => [spec.channelId, "active" as const]),
);
const changed = buildChannelRosterBundlePreview({
  active: target,
  registry,
  draft: {
    id: "11111111-1111-4111-8111-111111111111",
    baseManifestId: target.manifest.id,
    baseManifestContentHash: target.manifest.contentHash,
    changes: [{ slug: "vb-macd-state", membership: "exclude" }],
    reason: "Remove one runtime member while preserving independent collection.",
    evidenceRefs: ["fixture:remove"],
    operatorId: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-07-31T20:59:00.000Z",
  },
  envelope,
  live: flat(),
  collectionStates,
});
assert.equal(changed.state, "ready-for-worker-ack");
assert.ok(changed.candidate);

const draft = {
  id: "33333333-3333-4333-8333-333333333333",
  rollbackOfActivationReceiptId: "44444444-4444-4444-8444-444444444444",
  activeManifestId: changed.candidate.manifest.id,
  activeManifestContentHash: changed.candidate.manifest.contentHash,
  exactTargetManifestId: target.manifest.id,
  exactTargetManifestContentHash: target.manifest.contentHash,
  reason: "Restore the exact immutable prior roster and policy semantics.",
  evidenceRefs: ["fixture:activation-receipt", "fixture:operator-rollback"],
  operatorId: "55555555-5555-4555-8555-555555555555",
  createdAt: "2026-07-31T21:00:00.000Z",
};
const rollback = buildExactRosterRollbackPreview({
  active: changed.candidate,
  target,
  draft,
  envelope,
  live: flat(),
  collectionStates,
});
assert.equal(rollback.state, "ready-for-worker-ack");
assert.equal(rollbackRestoresExactSemantics({ preview: rollback, target }), true);
assert.equal(
  rollback.bundlePreview?.configurationEpochId,
  buildShadowRuntimeProjection(rollback.bundlePreview!.candidate!)
    .configurationEpochId,
);
assert.equal(rollback.bundlePreview?.candidate?.channelSpecs.length, 9);
assert.ok(rollback.bundlePreview?.diffs.some((diff) =>
  diff.slug === "vb-macd-state"
    && diff.fields.some((field) => field.after === "included")));
assert.equal(rollback.historicalEvidenceMutation, false);
assert.equal(rollback.orderAuthority, false);
const write = prepareExactRosterRollbackDraftWrite({
  draft,
  preview: rollback,
  registry,
  initialReceiptId: "66666666-6666-4666-8666-666666666666",
});
assert.equal(write.rpc, "create_channel_roster_rollback_draft");
assert.equal(write.args.p_target_manifest_key, target.manifest.id);
assert.equal(write.runtimeMutationAuthorized, false);
assert.equal(write.orderAuthority, false);

const open = flat();
open.openOrders = 1;
const blocked = buildExactRosterRollbackPreview({
  active: changed.candidate,
  target,
  draft,
  envelope,
  live: open,
  collectionStates,
});
assert.equal(blocked.state, "blocked");
assert.ok(blocked.blockers.includes("capacity:open_orders_present"));

const redundant = buildExactRosterRollbackPreview({
  active: target,
  target,
  draft: {
    ...draft,
    activeManifestId: target.manifest.id,
    activeManifestContentHash: target.manifest.contentHash,
  },
  envelope,
  live: flat(),
  collectionStates,
});
assert.equal(redundant.state, "blocked");
assert.ok(redundant.blockers.includes("rollback:already_exact_target"));

const pausedCollection = new Map(collectionStates);
pausedCollection.set(
  target.channelSpecs.find((spec) => spec.slug === "vb-macd-state")!.channelId,
  "paused",
);
const collectionBlocked = buildExactRosterRollbackPreview({
  active: changed.candidate,
  target,
  draft,
  envelope,
  live: flat(),
  collectionStates: pausedCollection,
});
assert.equal(collectionBlocked.state, "blocked");
assert.ok(collectionBlocked.blockers.includes(
  "rollback:paper_collection_not_active:vb-macd-state",
));

console.log("channel-roster-bundle-rollback-selftest: 17/17 passed");
