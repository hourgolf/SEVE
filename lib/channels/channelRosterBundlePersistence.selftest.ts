import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileReleaseManifest } from "./channelControlPlane.js";
import type {
  ChannelRosterBundleDraft,
  ChannelRosterBundlePreview,
} from "./channelRosterBundle.js";
import {
  prepareResearchChannelRegistrationWrite,
  prepareRosterBundleDraftWrite,
  prepareRosterBundleLifecycleWrite,
  rosterBundleWriteIsStable,
} from "./channelRosterBundlePersistence.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";
import {
  registerResearchChannel,
  type ResearchChannelRegistry,
} from "./researchChannelRegistry.js";

let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

const BUNDLE_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";
const OPERATOR_ID = "33333333-3333-4333-8333-333333333333";
const REGISTRATION_ID = "44444444-4444-4444-8444-444444444444";
const CHANNEL_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-07-31T14:30:00.000Z";
const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);

function draft(): ChannelRosterBundleDraft {
  return {
    id: BUNDLE_ID,
    baseManifestId: active.manifest.id,
    baseManifestContentHash: active.manifest.contentHash,
    changes: [{ slug: "vb-macd-state", executionPosture: "observe-only" }],
    reason: "Pause one channel atomically while preserving collection.",
    evidenceRefs: ["operator:test:bundle-persistence"],
    operatorId: OPERATOR_ID,
    createdAt: NOW,
  };
}

function registry(): ResearchChannelRegistry {
  return {
    registryVersion: "research-channel-registry-v1",
    entries: [],
    bySlug: {},
    summary: { registered: 0, paperEligible: 0, blocked: 0 },
    contentHash: `sha256:${"a".repeat(64)}`,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  };
}

function readyPreview(): ChannelRosterBundlePreview {
  return {
    version: "channel-roster-bundle-v1",
    id: BUNDLE_ID,
    state: "ready-for-worker-ack",
    activeManifestId: active.manifest.id,
    activeManifestContentHash: active.manifest.contentHash,
    candidate: active,
    configurationEpochId: `sha256:${"b".repeat(64)}`,
    diffs: [{
      slug: "vb-macd-state",
      source: "active-manifest",
      fields: [{
        field: "executionPosture",
        before: '"paper"',
        after: '"observe-only"',
      }],
    }],
    capacity: {
      version: "channel-portfolio-capacity-v1",
      state: "pass",
      evaluatedPaperSlugs: active.channelSpecs.map((spec) => spec.slug),
      metrics: [],
      blockers: [],
      limitations: ["OCC eligibility remains an entry-time broker check."],
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    },
    blockers: [],
    evidenceRefs: ["operator:test:bundle-persistence"],
    rollbackTargetManifestId: active.manifest.id,
    historicalEvidenceMutation: false,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  };
}

check("passing roster preview serializes deterministically without authority", () => {
  const left = prepareRosterBundleDraftWrite({
    draft: draft(),
    preview: readyPreview(),
    registry: registry(),
    initialReceiptId: RECEIPT_ID,
  });
  const right = prepareRosterBundleDraftWrite({
    draft: draft(),
    preview: readyPreview(),
    registry: registry(),
    initialReceiptId: RECEIPT_ID,
  });
  assert.equal(rosterBundleWriteIsStable(left, right), true);
  assert.equal(left.rpc, "create_channel_roster_bundle_draft");
  assert.equal(left.runtimeMutationAuthorized, false);
  assert.equal(left.orderAuthority, false);
});

check("blocked roster preview cannot be persisted", () => {
  const preview = readyPreview();
  preview.state = "blocked";
  assert.throws(() => prepareRosterBundleDraftWrite({
    draft: draft(),
    preview,
    registry: registry(),
    initialReceiptId: RECEIPT_ID,
  }), /fully passing roster preview/);
});

check("blocked research registration remains persistable but authority-dark", () => {
  const registration = registerResearchChannel({
    id: "research:blocked-fixture:1.0.0",
    channelId: CHANNEL_ID,
    slug: "blocked-fixture",
    registeredAt: NOW,
    registeredBy: "system:selftest",
    cartridge: null,
    candidateSpec: null,
    declaredBlockers: ["inventory:cartridge_missing"],
  });
  const write = prepareResearchChannelRegistrationWrite({
    registration,
    recordId: REGISTRATION_ID,
  });
  assert.equal(write.args.p_state, "registered-blocked");
  assert.ok(write.args.p_blockers.includes("registry:cartridge_missing"));
  assert.equal(write.executionAuthority, false);
  assert.equal(write.runtimeMutationAuthorized, false);
  assert.equal(write.orderAuthority, false);
});

check("cancel and supersede lifecycle writes are exact", () => {
  const canceled = prepareRosterBundleLifecycleWrite({
    receiptId: RECEIPT_ID,
    bundleId: BUNDLE_ID,
    targetState: "canceled",
    reason: "Operator canceled this unactivated roster draft.",
    evidenceRefs: ["operator:test:cancel"],
    operatorId: OPERATOR_ID,
    effectiveAt: NOW,
  });
  assert.equal(canceled.args.p_successor_bundle_id, null);
  assert.throws(() => prepareRosterBundleLifecycleWrite({
    receiptId: RECEIPT_ID,
    bundleId: BUNDLE_ID,
    targetState: "superseded",
    reason: "Operator replaced this unactivated roster draft.",
    evidenceRefs: ["operator:test:supersede"],
    operatorId: OPERATOR_ID,
    effectiveAt: NOW,
  }), /distinct successor/);
  assert.throws(() => prepareRosterBundleLifecycleWrite({
    receiptId: RECEIPT_ID,
    bundleId: BUNDLE_ID,
    targetState: "canceled",
    successorBundleId: REGISTRATION_ID,
    reason: "Operator canceled this unactivated roster draft.",
    evidenceRefs: ["operator:test:cancel"],
    operatorId: OPERATOR_ID,
    effectiveAt: NOW,
  }), /cannot name a successor/);
});

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260731144500_research_registry_roster_bundles.sql",
  import.meta.url,
), "utf8");

check("migration stores append-only registry and atomic bundle evidence", () => {
  for (const table of [
    "research_channel_registrations",
    "channel_roster_bundles",
    "channel_roster_bundle_lifecycle_receipts",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`${table} enable row level security`));
  }
  assert.match(migration, /reject_operator_activation_artifact_mutation/);
  assert.match(migration, /create_research_channel_registration/);
  assert.match(migration, /create_channel_roster_bundle_draft/);
  assert.match(migration, /transition_channel_roster_bundle/);
  assert.match(migration, /roster initial receipt idempotency conflict/);
  assert.match(migration, /p_capacity_evaluation ->> 'state' <> 'pass'/);
  assert.match(migration, /p_candidate_manifest -> 'channelSpecVersionIds'/);
  assert.match(migration, /p_candidate_manifest -> 'channelSpecContentHashes'/);
  assert.match(migration, /research_channel_registration_current registration/);
  assert.match(migration, /registration\.state = 'paper-eligible'/);
  assert.match(migration, /base_spec\.version_key in/);
  assert.match(migration, /p_target_state not in \('canceled', 'superseded'\)/);
  assert.match(migration, /successor_receipt\.state not in \('draft', 'validated'\)/);
  assert.match(migration, /successor\.base_manifest_content_hash[\s\S]+?current_bundle\.base_manifest_content_hash/);
  assert.match(migration, /successor\.created_at < current_bundle\.created_at/);
});

check("migration grants only service-role APIs and cannot activate or trade", () => {
  assert.match(migration, /grant execute on function public\.create_research_channel_registration[\s\S]+?to service_role;/);
  assert.match(migration, /grant execute on function public\.create_channel_roster_bundle_draft[\s\S]+?to service_role;/);
  assert.match(migration, /grant execute on function public\.transition_channel_roster_bundle[\s\S]+?to service_role;/);
  assert.doesNotMatch(migration, /grant execute[\s\S]+?to authenticated;/);
  assert.doesNotMatch(migration, /insert into public\.activation_receipts/i);
  assert.doesNotMatch(migration, /update\s+public\.(release_manifests|channel_spec_versions|positions|position_plans|execution_observations|orders)/i);
  assert.doesNotMatch(migration, /delete\s+from/i);
  assert.match(migration, /runtime_mutation_authorized[\s\S]+?check \(not runtime_mutation_authorized\)/);
  assert.match(migration, /order_authority[\s\S]+?check \(not order_authority\)/);
  assert.match(migration, /commit;\s*$/);
});

console.log(`channel-roster-bundle-persistence-selftest: ${checks}/${checks} passed`);
