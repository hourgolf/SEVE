import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRc54ControlPlaneBootstrap } from "./rc54ControlPlaneBootstrap";
import {
  reconstructStoredActivationReceipt,
  reconstructStoredControlPlane,
  reconstructStoredRosterBundleActivationAuthority,
} from "./channelControlPlanePersistence";
import { buildShadowRuntimeProjection } from "./channelActivation";
import { buildRc54NoopConfigurationCanary } from "./rc54NoopConfigurationCanary";

const bootstrap = buildRc54ControlPlaneBootstrap();
const databaseIds = new Map(
  bootstrap.specs.map((spec, index) => [
    spec.versionKey,
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);
const manifestRow: Record<string, unknown> = {
  id: "10000000-0000-4000-8000-000000000001",
  manifest_key: bootstrap.manifest.manifestKey,
  release_id: bootstrap.manifest.releaseId,
  cohort_id: bootstrap.manifest.cohortId,
  worker_compatibility_version: bootstrap.manifest.workerCompatibilityVersion,
  legacy_configuration_hash: bootstrap.manifest.legacyConfigurationHash,
  paper_live_authority: bootstrap.manifest.paperLiveAuthority,
  admission_policy_version: bootstrap.manifest.admissionPolicyVersion,
  collision_policy_version: bootstrap.manifest.collisionPolicyVersion,
  activation_boundary: bootstrap.manifest.activationBoundary,
  admission_policies: bootstrap.manifest.admissionPolicies,
  rollback_target_manifest_id: bootstrap.manifest.rollbackTargetManifestId,
  manifest_json: bootstrap.manifest.manifestJson,
  content_hash: bootstrap.manifest.contentHash,
  created_by: bootstrap.manifest.createdBy,
  created_at: bootstrap.manifest.createdAt,
  valid_from: bootstrap.manifest.createdAt,
  status: "active",
  parent: null,
};
const specRows: Array<Record<string, unknown>> = bootstrap.specs.map((spec) => ({
  id: databaseIds.get(spec.versionKey),
  version_key: spec.versionKey,
  channel_id: spec.channelId,
  channel_slug: spec.channelSlug,
  strategy_identity: spec.strategyIdentity,
  strategy_version: spec.strategyVersion,
  signal_version: spec.signalVersion,
  manager_profile_id: spec.managerProfileId,
  manager_version: spec.managerVersion,
  account_id: spec.accountId,
  account_role: spec.accountRole,
  account_mode: spec.accountMode,
  symbol_scope: spec.symbolScope,
  family_id: spec.familyId,
  cohort: spec.cohort,
  priority: spec.priority,
  quantity: spec.quantity,
  max_debit_usd: spec.maxDebitUsd,
  entry_parameters: spec.entryParameters,
  exit_parameters: spec.exitParameters,
  take_profit: spec.takeProfit,
  stop_loss: spec.stopLoss,
  ratchet_parameters: spec.ratchetParameters,
  reentry_policy: spec.reentryPolicy,
  scale_policy: spec.scalePolicy,
  collision_domain: spec.collisionDomain,
  risk_limits: spec.riskLimits,
  valid_from: spec.validFrom,
  valid_until: null,
  created_by: spec.createdBy,
  created_at: spec.createdAt,
  content_hash: spec.contentHash,
  status: "active",
  parent: spec.parentVersionKey
    ? { version_key: spec.parentVersionKey }
    : null,
}));
const membershipRows = bootstrap.memberships.map((membership) => ({
  ordinal: membership.ordinal,
  channel_spec_version_id: databaseIds.get(membership.versionKey),
}));

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("active database rows reconstruct the exact generic manifest", () => {
  const compiled = reconstructStoredControlPlane({
    manifestRow,
    membershipRows,
    specRows,
  });
  assert.equal(compiled.manifest.contentHash, bootstrap.manifest.contentHash);
  assert.equal(compiled.manifest.id, bootstrap.manifest.manifestKey);
  assert.equal(compiled.manifest.status, "active");
  assert.equal(compiled.channelSpecs.length, bootstrap.specs.length);
  assert.deepEqual(
    compiled.channelSpecs.map((spec) => spec.contentHash).sort(),
    bootstrap.specs.map((spec) => spec.contentHash).sort(),
  );
});

check("a non-active manifest cannot become proposal authority", () => {
  assert.throws(() => reconstructStoredControlPlane({
    manifestRow: { ...manifestRow, status: "draft" },
    membershipRows,
    specRows,
  }), /not active/);
});

check("spec hash drift fails closed", () => {
  assert.throws(() => reconstructStoredControlPlane({
    manifestRow,
    membershipRows,
    specRows: specRows.map((row, index) => index === 0
      ? { ...row, quantity: Number(row.quantity) + 1 }
      : row),
  }), /spec hash drifted/);
});

check("manifest receipt disagreement fails closed", () => {
  assert.throws(() => reconstructStoredControlPlane({
    manifestRow: {
      ...manifestRow,
      manifest_json: {
        ...(manifestRow.manifest_json as Record<string, unknown>),
        releaseId: "wrong-release",
      },
    },
    membershipRows,
    specRows,
  }), /manifest receipt disagrees/);
});

check("membership gaps and duplicates fail closed", () => {
  assert.throws(() => reconstructStoredControlPlane({
    manifestRow,
    membershipRows: membershipRows.map((row, index) => index === 1
      ? { ...row, ordinal: 3 }
      : row),
    specRows,
  }), /membership is incomplete/);
});

check("proposal route uses active authority, fails closed, then uses RC5.4 only before adoption", () => {
  const route = readFileSync(new URL(
    "../../app/api/channel-proposals/route.ts",
    import.meta.url,
  ), "utf8");
  assert.match(route, /await loadActiveCompiledControlPlane\(sb\)/);
  assert.match(route, /activeRead\.state === "failed"/);
  assert.match(route, /active control-plane identity is unavailable/);
  assert.match(route, /activeRead\.compiled[\s\S]+buildOperatorProposal\([\s\S]+buildRc54OperatorProposal/);
});

check("stored activation receipt reconstructs only against its exact active manifest", () => {
  const canary = buildRc54NoopConfigurationCanary();
  const compiled = canary.simulation.candidate.compiled;
  const receipt = canary.simulation.receipt;
  assert.ok(compiled);
  assert.ok(receipt);
  const row: Record<string, unknown> = {
    id: receipt.id,
    schema_version: receipt.schemaVersion,
    configuration_epoch_id: receipt.configurationEpochId,
    proposal_id: receipt.proposalId,
    exact_diff: receipt.exactDiff,
    validation_results: receipt.validationResults,
    validator_versions: receipt.validatorVersions,
    approved_by: receipt.approvedBy,
    scheduled_for: receipt.scheduledFor,
    activated_at: receipt.activatedAt,
    safe_boundary_proof: receipt.safeBoundaryProof,
    worker_acknowledgement: receipt.workerAcknowledgement,
    rollback_target_manifest_id: receipt.rollbackTargetManifestId,
    old_content_hash: receipt.oldContentHash,
    new_content_hash: receipt.newContentHash,
    manifest_content_hash: receipt.manifestContentHash,
    old_spec: { version_key: receipt.oldSpecVersionId },
    new_spec: { version_key: receipt.newSpecVersionId },
    manifest: { manifest_key: receipt.releaseManifestId },
  };
  const reconstructed = reconstructStoredActivationReceipt(row, compiled);
  assert.equal(reconstructed.id, receipt.id);
  assert.equal(reconstructed.configurationEpochId, receipt.configurationEpochId);
  assert.throws(
    () => reconstructStoredActivationReceipt({
      ...row,
      manifest_content_hash: `sha256:${"f".repeat(64)}`,
    }, compiled),
    /malformed or drifted/,
  );
});

check("atomic roster receipt reconstructs as exact runtime authority", () => {
  const canary = buildRc54NoopConfigurationCanary();
  const compiled = canary.simulation.candidate.compiled;
  assert.ok(compiled);
  const projection = buildShadowRuntimeProjection(compiled);
  const row: Record<string, unknown> = {
    id: "91919191-9191-4919-8919-919191919191",
    schema_version: 1,
    configuration_epoch_id: projection.configurationEpochId,
    candidate_manifest_key: compiled.manifest.id,
    candidate_manifest_content_hash: compiled.manifest.contentHash,
    rollback_target_manifest_key: compiled.manifest.rollbackTargetManifestId,
    exact_diffs: [{ slug: compiled.channelSpecs[0].slug }],
    capacity_evaluation: { state: "pass" },
    safe_boundary_proof: { globalFlat: true },
    worker_acknowledgement: { posture: "staged-no-order-authority" },
    activated_at: "2026-07-31T21:05:00.000Z",
    activation_scope: "prospective-new-entry-only",
    open_position_policy_preservation: "entry-epoch-immutable",
    historical_evidence_mutation: false,
    order_authority: false,
  };
  const authority = reconstructStoredRosterBundleActivationAuthority(
    row,
    compiled,
  );
  assert.equal(authority.receiptKind, "roster-bundle");
  assert.equal(authority.activatedSpecs?.length, compiled.channelSpecs.length);
  assert.throws(() => reconstructStoredRosterBundleActivationAuthority({
    ...row,
    candidate_manifest_content_hash: `sha256:${"f".repeat(64)}`,
  }, compiled), /malformed or drifted/);
});

check("runtime loader distinguishes baseline adoption from normal receipt authority", () => {
  const source = readFileSync(new URL(
    "./channelControlPlanePersistence.ts",
    import.meta.url,
  ), "utf8");
  assert.match(source, /loadStoredReceiptBoundControlPlane/);
  assert.match(source, /state: "receipt-bound"/);
  assert.match(source, /state: "baseline-active"/);
  assert.match(source, /channel_roster_bundle_activation_receipts/);
  assert.match(source, /multiple_authority_receipt_families/);
  assert.match(source, /active_control_plane:authority_receipt_missing/);
  assert.match(source, /multiple_for_active_manifest/);
});

console.log(`channel control-plane persistence self-test passed (${checks} checks)`);
