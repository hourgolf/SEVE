import assert from "node:assert/strict";
import {
  buildShadowActivationCandidate,
} from "../../lib/channels/channelActivation.js";
import {
  compileReleaseManifest,
  type ChannelChangeProposal,
  type DynamicReadinessEvidence,
} from "../../lib/channels/channelControlPlane.js";
import {
  RC54_CONTROL_PLANE_FIXTURE,
} from "../../lib/channels/rc54ControlPlaneFixture.js";
import {
  stageStoredChannelActivationPreview,
} from "./channelActivationPreviewWatcher.js";
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
const base = active.channelSpecs[0];
const proposalId = "11111111-1111-4111-8111-111111111111";
const previewId = "22222222-2222-4222-8222-222222222222";
const bootId = "33333333-3333-4333-8333-333333333333";
const acknowledgementId = "44444444-4444-4444-8444-444444444444";
const proposal: ChannelChangeProposal = {
  schemaVersion: 1,
  id: proposalId,
  baseSpecVersionId: base.id,
  baseSpecContentHash: base.contentHash,
  proposedSpecVersionId: `spec:draft:${proposalId}`,
  proposedPatch: { executionPosture: "observe-only" },
  reason: "Pause entries while preserving collection.",
  evidenceRefs: ["fixture:decision-card"],
  authorKind: "operator",
  authorId: "55555555-5555-4555-8555-555555555555",
  changeClass: "governed-operational-policy",
  validationResults: [],
  replaySummary: {
    state: "sufficient",
    exactSamples: 1,
    censoredSamples: 0,
    limitations: ["Protocol simulation only."],
    evidenceRefs: ["fixture:protocol"],
  },
  approvalState: "validated",
  requestedActivationBoundary: "next-safe-entry",
  createdAt: "2026-07-31T04:00:00.000Z",
  activationAuthorized: false,
};
const readiness: DynamicReadinessEvidence = {
  replaySufficiency: {
    ok: true,
    fact: "Exact protocol simulation passed.",
    evidenceRefs: ["fixture:protocol"],
  },
  evidenceReadiness: {
    ok: true,
    fact: "Decision evidence is present.",
    evidenceRefs: ["fixture:decision-card"],
  },
  safeBoundary: {
    ok: true,
    fact: "All paper books are flat.",
    evidenceRefs: ["fixture:boundary"],
  },
};
const candidate = buildShadowActivationCandidate({
  active,
  proposal,
  readiness,
});
assert.ok(candidate.compiled);
assert.ok(candidate.projection);
proposal.validationResults = candidate.validationResults;

const envelope = {
  proposal: {
    id: proposal.id,
    base_spec_content_hash: proposal.baseSpecContentHash,
    proposed_patch: proposal.proposedPatch,
    reason: proposal.reason,
    evidence_refs: proposal.evidenceRefs,
    author_kind: proposal.authorKind,
    author_id: proposal.authorId,
    change_class: proposal.changeClass,
    validation_results: proposal.validationResults,
    replay_summary: proposal.replaySummary,
    approval_state: proposal.approvalState,
    requested_activation_boundary: proposal.requestedActivationBoundary,
    created_at: proposal.createdAt,
    activation_authorized: false,
    base: { version_key: proposal.baseSpecVersionId },
    proposed: { version_key: proposal.proposedSpecVersionId },
  },
  preview: {
    id: previewId,
    proposal_id: proposal.id,
    candidate_manifest: candidate.compiled?.manifest,
    worker_projection: candidate.compiled?.workerProjection,
    dashboard_projection: candidate.compiled?.dashboardProjection,
    validation_results: candidate.validationResults,
    replay_summary: proposal.replaySummary,
    capacity_collision_impact: {
      state: "pass",
      evidenceRefs: ["fixture:capacity"],
    },
    capture_continuity: {
      state: "pass",
      blockers: [],
      evidenceRefs: ["a", "b", "c", "d", "e"],
    },
    configuration_epoch_id: candidate.projection?.configurationEpochId,
    prepared_at: "2026-07-31T04:00:01.000Z",
  },
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

const staged = stageStoredChannelActivationPreview({
  active,
  envelope,
  acknowledgementId,
  currentReleaseId: RC54_RELEASE_ID,
  currentWorkerVersion: RC54_WORKER_VERSION,
  currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
  bootId,
  paperMode: true,
  heldCaptureReady: true,
  startupReceipt,
  observedAt: "2026-07-31T04:00:02.000Z",
});
assert.equal(staged.state, "acknowledged");
assert.deepEqual(staged.blockers, []);
assert.equal(
  staged.acknowledgementRpcArgs?.p_acknowledgement_id,
  acknowledgementId,
);
assert.equal(staged.runtimeMutation, false);
assert.equal(staged.orderAuthority, false);

const drifted = stageStoredChannelActivationPreview({
  active,
  envelope: {
    ...envelope,
    preview: {
      ...envelope.preview,
      configuration_epoch_id: `sha256:${"0".repeat(64)}`,
    },
  },
  acknowledgementId,
  currentReleaseId: RC54_RELEASE_ID,
  currentWorkerVersion: RC54_WORKER_VERSION,
  currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
  bootId,
  paperMode: true,
  heldCaptureReady: true,
  startupReceipt,
  observedAt: "2026-07-31T04:00:02.000Z",
});
assert.equal(drifted.state, "blocked");
assert.ok(drifted.blockers.includes("candidate:configuration_epoch_drift"));
assert.equal(drifted.acknowledgementRpcArgs, null);

console.log("channel-activation-preview-watcher-selftest: 2/2 passed");
