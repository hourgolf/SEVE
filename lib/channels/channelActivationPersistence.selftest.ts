import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  prepareActivationPreview,
  prepareProposalActivation,
  prepareWorkerAcknowledgement,
} from "./channelActivationPersistence.js";
import type {
  SafeBoundaryInput,
  WorkerCompatibilityProof,
} from "./channelActivation.js";
import type {
  DynamicReadinessEvidence,
  JsonObject,
  ProposalReplaySummary,
} from "./channelControlPlane.js";
import type { CapturePathObservation } from "./channelConfigurationWorkflow.js";
import { buildOperatorProposal } from "./channelProposalWrite.js";
import { compileReleaseManifest } from "./channelControlPlane.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const PREVIEW_ID = "22222222-2222-4222-8222-222222222222";
const ACK_ID = "33333333-3333-4333-8333-333333333333";
const BOOT_ID = "44444444-4444-4444-8444-444444444444";
const OPERATOR_ID = "55555555-5555-4555-8555-555555555555";
const APPROVAL_ID = "66666666-6666-4666-8666-666666666666";
const PREPARED_AT = "2026-07-29T00:00:20.000Z";
const OBSERVED_AT = "2026-07-29T00:00:10.000Z";
const ACKNOWLEDGED_AT = "2026-07-29T00:00:15.000Z";
const APPROVED_AT = "2026-07-29T00:00:16.000Z";
const SCHEDULED_FOR = "2026-07-29T00:00:17.000Z";
const ACTIVATED_AT = "2026-07-29T00:00:18.000Z";

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const base = active.channelSpecs.find((spec) => spec.slug === "orb-ustop-ctl");
assert.ok(base);
const built = buildOperatorProposal(
  active,
  {
    baseSpecVersionId: base.id,
    baseSpecContentHash: base.contentHash,
    proposedPatch: { quantity: 1, maxDebitUsd: 200 },
    reason: "Bounded persistence-path fixture only.",
    evidenceRefs: ["fixture:bounded-review"],
    changeClass: "bounded-parameter",
  },
  OPERATOR_ID,
  PROPOSAL_ID,
  "2026-07-29T00:00:00.000Z",
);

const readiness: DynamicReadinessEvidence = {
  replaySufficiency: {
    ok: true,
    fact: "Exact fixture replay is sufficient.",
    evidenceRefs: ["fixture:replay"],
  },
  evidenceReadiness: {
    ok: true,
    fact: "Fixture evidence paths are complete.",
    evidenceRefs: ["fixture:evidence"],
  },
  safeBoundary: {
    ok: true,
    fact: "Fixture boundary observer is available.",
    evidenceRefs: ["fixture:boundary"],
  },
};
const replaySummary: ProposalReplaySummary = {
  state: "sufficient",
  exactSamples: 12,
  censoredSamples: 0,
  limitations: [],
  evidenceRefs: ["fixture:replay"],
};
const capacityCollisionImpact: JsonObject = {
  state: "pass",
  evidenceRefs: ["fixture:capacity", "fixture:collision"],
};
const captureObservations: CapturePathObservation[] = [
  "quote-capture",
  "held-capture",
  "manager-observer",
  "broker-reconciliation",
  "sentinel-evidence",
].map((path) => ({
  path: path as CapturePathObservation["path"],
  state: "observed",
  observedAt: OBSERVED_AT,
  evidenceRef: `fixture:capture:${path}`,
}));

const preview = prepareActivationPreview({
  active,
  proposal: built.proposal,
  readiness,
  replaySummary,
  capacityCollisionImpact,
  captureObservations,
  previewId: PREVIEW_ID,
  preparedBy: OPERATOR_ID,
  preparedAt: PREPARED_AT,
});
const worker = prepareWorkerAcknowledgement({
  preview,
  acknowledgementId: ACK_ID,
  previewId: PREVIEW_ID,
  workerReleaseId: active.manifest.releaseId,
  bootId: BOOT_ID,
  acknowledgedAt: ACKNOWLEDGED_AT,
  evidenceRef: "fixture:worker-ack",
});
const accountIds = [
  ...new Set(active.channelSpecs.map((spec) => spec.accountId)),
].sort();
const boundary: SafeBoundaryInput = {
  observedAt: OBSERVED_AT,
  accountInventoryEvidenceRef: "fixture:account-inventory",
  configuredAccounts: accountIds.map((accountId) => ({
    accountId,
    mode: "paper",
  })),
  brokerAccounts: accountIds.map((accountId) => ({
    accountId,
    openPositions: {
      state: "observed",
      count: 0,
      evidenceRef: `fixture:${accountId}:positions`,
    },
    openOrders: {
      state: "observed",
      count: 0,
      evidenceRef: `fixture:${accountId}:orders`,
    },
  })),
  deskOpenPositions: {
    state: "observed",
    count: 0,
    evidenceRef: "fixture:desk-positions",
  },
};
const compatibility: WorkerCompatibilityProof = {
  workerCompatibilityVersion: active.manifest.workerCompatibilityVersion,
  workerReleaseId: active.manifest.releaseId,
  bootId: BOOT_ID,
  paperMode: true,
  observedAt: OBSERVED_AT,
  evidenceRef: "fixture:worker-compatibility",
};
const activation = prepareProposalActivation({
  preview,
  worker,
  compatibility,
  boundary,
  approvalId: APPROVAL_ID,
  operatorId: OPERATOR_ID,
  approvalEvidenceRef: "fixture:explicit-operator-approval",
  approvedAt: APPROVED_AT,
  scheduledFor: SCHEDULED_FOR,
  activatedAt: ACTIVATED_AT,
  evaluatedAt: ACTIVATED_AT,
});

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("validated preview binds one candidate identity and both projections", () => {
  assert.equal(preview.rpcArgs.p_proposal_id, PROPOSAL_ID);
  assert.equal(
    preview.rpcArgs.p_candidate_manifest.contentHash,
    preview.rpcArgs.p_worker_projection.manifestContentHash,
  );
  assert.equal(
    preview.rpcArgs.p_candidate_manifest.contentHash,
    preview.rpcArgs.p_dashboard_projection.manifestContentHash,
  );
  assert.equal(preview.captureContinuity.state, "pass");
  assert.equal(preview.runtimeMutation, false);
  assert.equal(preview.orderAuthority, false);
});

check("worker acknowledgement is candidate-specific and has no authority", () => {
  assert.equal(worker.acknowledgement.proposalId, PROPOSAL_ID);
  assert.equal(
    worker.acknowledgement.manifestContentHash,
    preview.rpcArgs.p_candidate_manifest.contentHash,
  );
  assert.equal(
    worker.acknowledgement.configurationEpochId,
    preview.rpcArgs.p_configuration_epoch_id,
  );
  assert.equal(worker.acknowledgement.posture, "staged-no-order-authority");
  assert.equal(worker.runtimeMutation, false);
  assert.equal(worker.orderAuthority, false);
});

check("activation payload binds approval, boundary, acknowledgement, and receipt", () => {
  assert.equal(activation.rpcArgs.p_proposal_id, PROPOSAL_ID);
  assert.equal(activation.rpcArgs.p_preview_id, PREVIEW_ID);
  assert.equal(activation.rpcArgs.p_worker_acknowledgement_id, ACK_ID);
  assert.equal(
    activation.rpcArgs.p_configuration_epoch_id,
    preview.rpcArgs.p_configuration_epoch_id,
  );
  assert.equal(activation.rpcArgs.p_safe_boundary_proof.globalFlat, true);
  assert.equal(activation.runtimeMutationScope, "receipt-bound-new-entry-only");
  assert.equal(activation.orderAuthority, false);
});

check("missing capture path blocks preview persistence", () => {
  assert.throws(() => prepareActivationPreview({
    active,
    proposal: built.proposal,
    readiness,
    replaySummary,
    capacityCollisionImpact,
    captureObservations: captureObservations.slice(1),
    previewId: PREVIEW_ID,
    preparedBy: OPERATOR_ID,
    preparedAt: PREPARED_AT,
  }), /not validation-ready/);
});

check("insufficient replay blocks preview persistence", () => {
  assert.throws(() => prepareActivationPreview({
    active,
    proposal: built.proposal,
    readiness,
    replaySummary: { ...replaySummary, state: "insufficient" },
    capacityCollisionImpact,
    captureObservations,
    previewId: PREVIEW_ID,
    preparedBy: OPERATOR_ID,
    preparedAt: PREPARED_AT,
  }), /must be sufficient/);
});

check("an open broker order blocks activation", () => {
  const unsafeBoundary: SafeBoundaryInput = {
    ...boundary,
    brokerAccounts: boundary.brokerAccounts.map((account, index) => index
      ? account
      : {
        ...account,
        openOrders: {
          state: "observed",
          count: 1,
          evidenceRef: "fixture:open-order",
        },
      }),
  };
  assert.throws(() => prepareProposalActivation({
    preview,
    worker,
    compatibility,
    boundary: unsafeBoundary,
    approvalId: APPROVAL_ID,
    operatorId: OPERATOR_ID,
    approvalEvidenceRef: "fixture:explicit-operator-approval",
    approvedAt: APPROVED_AT,
    scheduledFor: SCHEDULED_FOR,
    activatedAt: ACTIVATED_AT,
    evaluatedAt: ACTIVATED_AT,
  }), /not receipt-ready/);
});

check("a worker lineage mismatch blocks activation", () => {
  assert.throws(() => prepareProposalActivation({
    preview,
    worker,
    compatibility: { ...compatibility, bootId: "77777777-7777-4777-8777-777777777777" },
    boundary,
    approvalId: APPROVAL_ID,
    operatorId: OPERATOR_ID,
    approvalEvidenceRef: "fixture:explicit-operator-approval",
    approvedAt: APPROVED_AT,
    scheduledFor: SCHEDULED_FOR,
    activatedAt: ACTIVATED_AT,
    evaluatedAt: ACTIVATED_AT,
  }), /not receipt-ready/);
});

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260729010000_channel_proposal_activation_bridge.sql",
    import.meta.url,
  ),
  "utf8",
);

check("migration creates immutable preview, acknowledgement, and approval receipts", () => {
  for (const table of [
    "channel_activation_previews",
    "channel_activation_worker_acknowledgements",
    "channel_activation_approvals",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /reject_channel_activation_evidence_mutation/);
  assert.match(migration, /enforce_channel_activation_approval_insert/);
  assert.match(migration, /channel_activation_approvals_insert_guard/);
  assert.doesNotMatch(
    migration,
    /grant[^;]*delete[^;]*(channel_activation_previews|channel_activation_worker_acknowledgements|channel_activation_approvals)/i,
  );
  assert.doesNotMatch(
    migration,
    /grant[^;]*insert[^;]*channel_activation_approvals/i,
  );
});

check("legacy activation boolean remains pinned false and is not used as authority", () => {
  assert.doesNotMatch(migration, /drop constraint[^;]*activation_authorized/i);
  assert.doesNotMatch(migration, /set\s+activation_authorized\s*=\s*true/i);
  assert.match(migration, /proposal\.activation_authorized is not false/);
  assert.match(migration, /channel_activation_approvals/);
});

check("preview insert guard compares exact ordered worker and dashboard roots", () => {
  assert.match(
    migration,
    /new\.worker_projection -> 'roots' <> \([\s\S]*jsonb_array_elements\([\s\S]*new\.dashboard_projection -> 'roots'/,
  );
  assert.match(
    migration,
    /new\.candidate_manifest -> 'channelSpecVersionIds' <> \([\s\S]*root ->> 'channelSpecVersionId'/,
  );
  assert.match(
    migration,
    /new\.candidate_manifest -> 'channelSpecContentHashes' <> \([\s\S]*root ->> 'channelSpecContentHash'/,
  );
});

check("activation RPC revalidates every configured paper account and open orders", () => {
  assert.match(migration, /from public\.accounts account[\s\S]*lower\(account\.mode\) = 'paper'/);
  assert.match(migration, /configuredPaperAccountIds/);
  assert.match(migration, /openOrders,state/);
  assert.match(migration, /openOrders,count/);
  assert.match(migration, /from public\.positions where status = 'open'/);
});

check("approval creation is confined to the guarded atomic activation RPC", () => {
  assert.match(
    migration,
    /create or replace function public\.activate_channel_change_proposal\([\s\S]*?\)\s*returns table[\s\S]*?security definer/,
  );
  assert.match(
    migration,
    /insert into public\.channel_activation_approvals[\s\S]*insert into public\.activation_receipts/,
  );
  assert.match(
    migration,
    /proposal\.approval_state <> 'validated'[\s\S]*acknowledgement\.configuration_epoch_id <> preview\.configuration_epoch_id/,
  );
});

check("preview and activation retries require exact immutable identities", () => {
  assert.match(
    migration,
    /preview\.base_release_manifest_id <> base_manifest\.id[\s\S]*preview\.prepared_at <> p_prepared_at/,
  );
  assert.match(
    migration,
    /receipt\.scheduled_for <> p_scheduled_for[\s\S]*receipt\.activated_at <> p_activated_at/,
  );
  assert.match(
    migration,
    /approval\.id <> p_approval_id[\s\S]*approval\.preview_id <> p_preview_id[\s\S]*approval\.worker_acknowledgement_id[\s\S]*<> p_worker_acknowledgement_id/,
  );
  assert.match(
    migration,
    /approval\.approval_evidence_ref <> btrim\(p_approval_evidence_ref\)[\s\S]*approval\.approved_at <> p_approved_at/,
  );
});

check("receipt precedes active lifecycle promotion in the atomic RPC", () => {
  const receiptInsert = migration.indexOf("insert into public.activation_receipts");
  const newSpecActive = migration.indexOf(
    "set status = 'active'\n  where id = new_spec.id",
  );
  const newManifestActive = migration.indexOf(
    "set status = 'active'\n  where id = new_manifest.id",
  );
  assert.ok(receiptInsert > 0);
  assert.ok(newSpecActive > receiptInsert);
  assert.ok(newManifestActive > receiptInsert);
});

check("all write RPCs are service-role only", () => {
  for (const fn of [
    "prepare_channel_change_proposal_preview",
    "acknowledge_channel_change_proposal_preview",
    "activate_channel_change_proposal",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]+?\\) from public, anon, authenticated;`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]+?\\) to service_role;`),
    );
  }
});

console.log(`channel activation persistence self-test passed (${checks} checks)`);
