import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileReleaseManifest } from "./channelControlPlane.js";
import type { LivePortfolioTruth } from "./channelPortfolioCapacity.js";
import type { ChannelRosterBundlePreview } from "./channelRosterBundle.js";
import {
  buildRosterBundleActivationPlan,
  buildRosterBundleOperatorApproval,
  buildRosterBundleWorkerAcknowledgement,
  reviewRosterBundleActivation,
} from "./channelRosterBundleActivation.js";
import {
  prepareRosterBundleAcknowledgementWrite,
  prepareRosterBundleActivationWrite,
  rosterBundleActivationWriteIsStable,
} from "./channelRosterBundleActivationPersistence.js";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture.js";

let checks = 0;
const check = (label: string, run: () => void): void => {
  run();
  checks++;
  console.log(`✓ ${label}`);
};

const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
const BUNDLE_ID = "11111111-1111-4111-8111-111111111111";
const ACK_ID = "22222222-2222-4222-8222-222222222222";
const BOOT_ID = "33333333-3333-4333-8333-333333333333";
const APPROVAL_ID = "44444444-4444-4444-8444-444444444444";
const OPERATOR_ID = "55555555-5555-4555-8555-555555555555";
const RECEIPT_ID = "66666666-6666-4666-8666-666666666666";
const BASE_HASH = `sha256:${"a".repeat(64)}`;
const EPOCH = `sha256:${"b".repeat(64)}`;
const ACK_AT = "2026-07-31T20:00:00.000Z";
const APPROVED_AT = "2026-07-31T20:00:05.000Z";
const REVIEWED_AT = "2026-07-31T20:00:10.000Z";

function preview(): ChannelRosterBundlePreview {
  return {
    version: "channel-roster-bundle-v1",
    id: BUNDLE_ID,
    state: "ready-for-worker-ack",
    activeManifestId: active.manifest.id,
    activeManifestContentHash: BASE_HASH,
    candidate: active,
    configurationEpochId: EPOCH,
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
      limitations: ["OCC remains an entry-time broker check."],
      executionAuthority: false,
      runtimeMutationAuthorized: false,
      orderAuthority: false,
    },
    blockers: [],
    evidenceRefs: ["operator:test:bundle-preview"],
    rollbackTargetManifestId: active.manifest.id,
    historicalEvidenceMutation: false,
    executionAuthority: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  };
}

function live(observedAt = REVIEWED_AT): LivePortfolioTruth {
  return { complete: true, observedAt, openOrders: 0, positions: [] };
}

function handshake() {
  const candidate = preview();
  const acknowledgement = buildRosterBundleWorkerAcknowledgement({
    preview: candidate,
    id: ACK_ID,
    baseManifestContentHash: BASE_HASH,
    workerRuntimeVersion: "stream-2026-07-31a",
    bootId: BOOT_ID,
    acknowledgedAt: ACK_AT,
    evidenceRef: "worker:test:bundle-ack",
  });
  const approval = buildRosterBundleOperatorApproval({
    preview: candidate,
    acknowledgement,
    id: APPROVAL_ID,
    operatorId: OPERATOR_ID,
    approvalEvidenceRef: "operator:test:bundle-approval",
    approvedAt: APPROVED_AT,
  });
  return { candidate, acknowledgement, approval };
}

check("exact worker ack, approval, and flat truth reach receipt-ready", () => {
  const input = handshake();
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: input.approval,
    live: live(),
    reviewedAt: REVIEWED_AT,
  });
  assert.equal(review.state, "receipt-ready");
  assert.deepEqual(review.blockers, []);
  assert.equal(review.runtimeMutationAuthorized, false);
  assert.equal(review.orderAuthority, false);
});

check("worker acknowledgement must match the exact candidate epoch", () => {
  const input = handshake();
  const acknowledgement = {
    ...input.acknowledgement,
    configurationEpochId: `sha256:${"0".repeat(64)}`,
  };
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement,
    approval: input.approval,
    live: live(),
    reviewedAt: REVIEWED_AT,
  });
  assert.ok(review.blockers.includes(
    "bundle-activation:worker_ack_identity_mismatch",
  ));
});

check("stale worker evidence fails closed", () => {
  const input = handshake();
  const acknowledgement = {
    ...input.acknowledgement,
    acknowledgedAt: "2026-07-31T19:58:00.000Z",
  };
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement,
    approval: input.approval,
    live: live(),
    reviewedAt: REVIEWED_AT,
  });
  assert.ok(review.blockers.includes(
    "bundle-activation:worker_ack_stale_or_future",
  ));
});

check("missing approval cannot be inferred from a worker ack", () => {
  const input = handshake();
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: null,
    live: live(),
    reviewedAt: REVIEWED_AT,
  });
  assert.ok(review.blockers.includes(
    "bundle-activation:operator_approval_missing",
  ));
});

check("open orders or positions block activation", () => {
  const input = handshake();
  const open = live();
  open.openOrders = 1;
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: input.approval,
    live: open,
    reviewedAt: REVIEWED_AT,
  });
  assert.ok(review.blockers.includes(
    "bundle-activation:portfolio_not_proven_flat",
  ));
});

check("activation plan pins prospective epoch and exact prior rollback", () => {
  const input = handshake();
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: input.approval,
    live: live(),
    reviewedAt: REVIEWED_AT,
  });
  const plan = buildRosterBundleActivationPlan({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: input.approval,
    review,
    activationReceiptId: RECEIPT_ID,
    priorManifestContentHash: BASE_HASH,
    activatedAt: REVIEWED_AT,
  });
  assert.equal(plan.configurationEpochId, EPOCH);
  assert.equal(plan.rollbackTargetManifestId, active.manifest.id);
  assert.equal(plan.activationScope, "prospective-new-entry-only");
  assert.equal(plan.openPositionPolicyPreservation, "entry-epoch-immutable");
  assert.equal(plan.historicalEvidenceMutation, false);
  assert.equal(plan.runtimeMutationAuthorized, false);
  assert.equal(plan.orderAuthority, false);
});

check("worker and activation writes serialize exact receipt-bound identities", () => {
  const input = handshake();
  const acknowledgement = prepareRosterBundleAcknowledgementWrite({
    acknowledgement: input.acknowledgement,
    validatedLifecycleReceiptId: "77777777-7777-4777-8777-777777777777",
  });
  assert.equal(acknowledgement.rpc, "acknowledge_channel_roster_bundle");
  assert.equal(acknowledgement.runtimeMutationAuthorized, false);
  const review = reviewRosterBundleActivation({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: input.approval,
    live: live(),
    reviewedAt: REVIEWED_AT,
  });
  const plan = buildRosterBundleActivationPlan({
    preview: input.candidate,
    acknowledgement: input.acknowledgement,
    approval: input.approval,
    review,
    activationReceiptId: RECEIPT_ID,
    priorManifestContentHash: BASE_HASH,
    activatedAt: REVIEWED_AT,
  });
  const safeBoundaryProof = {
    protocolVersion: "channel-activation-protocol-v1",
    globalFlat: true,
    observedAt: REVIEWED_AT,
    accountInventoryEvidenceRef: "supabase:accounts:test",
    configuredPaperAccountIds: ["paper-1"],
    brokerAccounts: [{
      accountId: "paper-1",
      openPositions: { state: "observed", count: 0, evidenceRef: "broker:positions" },
      openOrders: { state: "observed", count: 0, evidenceRef: "broker:orders" },
    }],
    deskOpenPositions: { state: "observed", count: 0, evidenceRef: "desk:positions" },
  };
  const left = prepareRosterBundleActivationWrite({
    plan,
    approval: input.approval,
    approvedLifecycleReceiptId: "88888888-8888-4888-8888-888888888888",
    safeBoundaryProof,
  });
  const right = prepareRosterBundleActivationWrite({
    plan,
    approval: input.approval,
    approvedLifecycleReceiptId: "88888888-8888-4888-8888-888888888888",
    safeBoundaryProof,
  });
  assert.equal(left.rpc, "activate_channel_roster_bundle");
  assert.equal(left.prospectiveOnly, true);
  assert.equal(left.orderAuthority, false);
  assert.equal(rosterBundleActivationWriteIsStable(left, right), true);
});

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260731151500_channel_roster_bundle_activation.sql",
  import.meta.url,
), "utf8");

check("activation migration uses one receipt family for the whole atomic diff", () => {
  for (const table of [
    "channel_roster_bundle_worker_acknowledgements",
    "channel_roster_bundle_approvals",
    "channel_roster_bundle_activation_receipts",
    "channel_roster_bundle_activation_specs",
    "channel_roster_bundle_activation_removals",
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`${table} enable row level security`));
  }
  assert.match(migration, /create or replace function public\.acknowledge_channel_roster_bundle/);
  assert.match(migration, /create or replace function public\.create_channel_roster_rollback_draft/);
  assert.match(migration, /current_receipt\.state not in \('draft', 'validated'\)/);
  assert.match(migration, /if current_receipt\.state = 'draft' then/);
  assert.match(migration, /effective_lifecycle_receipt_id := current_receipt\.id/);
  assert.match(migration, /create or replace function public\.activate_channel_roster_bundle/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /channel_roster_bundle_activation_specs bundle_spec/);
  assert.match(migration, /control_plane_adoption_receipts adoption/);
  assert.match(migration, /activation_scope = 'prospective-new-entry-only'/);
  assert.match(migration, /open_position_policy_preservation = 'entry-epoch-immutable'/);
  assert.match(migration, /drop constraint channel_spec_versions_content_hash_key/);
  assert.match(migration, /collection_preserved/);
  assert.match(migration, /validated_lifecycle_receipt_id uuid not null unique/);
  assert.match(
    migration,
    /acknowledgement\.acknowledged_at < p_activated_at - interval '5 minutes'/,
  );
  assert.match(migration, /rollback candidate does not restore exact target semantics/);
  assert.match(migration, /then 'rolled-back'/);
});

check("atomic apply rechecks all accounts flat before any active transition", () => {
  assert.match(migration, /configuredPaperAccountIds/);
  assert.match(migration, /brokerAccounts/);
  assert.match(migration, /openPositions,count}' is distinct from '0'/);
  assert.match(migration, /openOrders,count}' is distinct from '0'/);
  assert.match(migration, /exists \(select 1 from public\.positions where status = 'open'\)/);
  assert.match(migration, /channel_collection_state_current collection/);
  assert.match(migration, /roster activation requires active collection for every paper channel/);
  assert.match(migration, /paper channel activation requires active collection/);
  assert.match(migration, /serialize_collection_against_activation/);
  assert.match(migration, /seve:paper-collection-activation/);
  assert.match(migration, /channel_collection_receipts_activation_serialization/);
  const proofCheck = migration.indexOf("roster activation did not prove every paper account and desk flat");
  const collectionCheck = migration.indexOf("roster activation requires active collection for every paper channel");
  const approvalInsert = migration.indexOf("insert into public.channel_roster_bundle_approvals");
  const activeSpec = migration.indexOf("update public.channel_spec_versions new_spec");
  assert.ok(proofCheck >= 0 && proofCheck < approvalInsert);
  assert.ok(collectionCheck > proofCheck && collectionCheck < approvalInsert);
  assert.ok(approvalInsert < activeSpec);
});

check("activation migration is service-only, prospective, and order-dark", () => {
  assert.match(migration, /grant execute on function public\.acknowledge_channel_roster_bundle[\s\S]+?to service_role;/);
  assert.match(migration, /grant execute on function public\.activate_channel_roster_bundle[\s\S]+?to service_role;/);
  assert.doesNotMatch(migration, /grant execute[\s\S]+?to authenticated;/);
  assert.doesNotMatch(migration, /insert into public\.(positions|position_plans|execution_observations|orders)/i);
  assert.doesNotMatch(migration, /update public\.(positions|position_plans|execution_observations|orders)/i);
  assert.doesNotMatch(migration, /delete from/i);
  assert.match(migration, /historical_evidence_mutation[\s\S]+?check \(not historical_evidence_mutation\)/);
  assert.match(migration, /order_authority[\s\S]+?check \(not order_authority\)/);
  assert.match(migration, /commit;\s*$/);
});

check("rollback parent lookup compares the exact target manifest once", () => {
  assert.match(
    migration,
    /where rollback_target\.manifest_key\s*= bundle\.rollback_context ->> 'exactTargetManifestId'\s*and target_spec\.version_key/,
  );
  assert.doesNotMatch(
    migration,
    /exactTargetManifestId'\s*= bundle\.rollback_context ->> 'exactTargetManifestId'/,
  );
});

console.log(`channel-roster-bundle-activation-selftest: ${checks}/${checks} passed`);
