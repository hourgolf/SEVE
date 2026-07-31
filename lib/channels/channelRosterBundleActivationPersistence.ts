import {
  canonicalJson,
  contentHash,
  type JsonObject,
} from "./channelControlPlane";
import type {
  ChannelRosterBundleActivationPlan,
  ChannelRosterBundleOperatorApproval,
  ChannelRosterBundleWorkerAcknowledgement,
} from "./channelRosterBundleActivation";

export const CHANNEL_ROSTER_BUNDLE_ACTIVATION_PERSISTENCE_VERSION =
  "channel-roster-bundle-activation-persistence-v1" as const;

export interface ChannelRosterBundleAcknowledgementWrite {
  rpc: "acknowledge_channel_roster_bundle";
  args: {
    p_acknowledgement_id: string;
    p_validated_lifecycle_receipt_id: string;
    p_bundle_id: string;
    p_source_boot_id: string;
    p_worker_runtime_version: string;
    p_acknowledged_at: string;
    p_evidence_ref: string;
    p_acknowledgement: JsonObject;
  };
  idempotencyHash: string;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface ChannelRosterBundleActivationWrite {
  rpc: "activate_channel_roster_bundle";
  args: {
    p_activation_receipt_id: string;
    p_approval_id: string;
    p_approved_lifecycle_receipt_id: string;
    p_bundle_id: string;
    p_worker_acknowledgement_id: string;
    p_operator_id: string;
    p_approval_evidence_ref: string;
    p_approved_at: string;
    p_activated_at: string;
    p_safe_boundary_proof: JsonObject;
  };
  idempotencyHash: string;
  prospectiveOnly: true;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return structuredClone(value) as JsonObject;
}

function hash<T extends { args: unknown }>(write: T): string {
  return contentHash(write.args as JsonObject);
}

export function prepareRosterBundleAcknowledgementWrite(input: {
  acknowledgement: ChannelRosterBundleWorkerAcknowledgement;
  validatedLifecycleReceiptId: string;
}): ChannelRosterBundleAcknowledgementWrite {
  const acknowledgement = input.acknowledgement;
  if (![acknowledgement.id, acknowledgement.bundleId,
    acknowledgement.bootId, input.validatedLifecycleReceiptId]
    .every((value) => UUID.test(value))) {
    throw new Error("roster acknowledgement persistence identities must be UUIDs");
  }
  if (acknowledgement.runtimeMutation !== false
      || acknowledgement.orderAuthority !== false
      || acknowledgement.posture !== "staged-no-order-authority"
      || acknowledgement.accountMode !== "paper") {
    throw new Error("roster acknowledgement persistence posture is invalid");
  }
  const args: ChannelRosterBundleAcknowledgementWrite["args"] = {
    p_acknowledgement_id: acknowledgement.id.toLowerCase(),
    p_validated_lifecycle_receipt_id:
      input.validatedLifecycleReceiptId.toLowerCase(),
    p_bundle_id: acknowledgement.bundleId.toLowerCase(),
    p_source_boot_id: acknowledgement.bootId.toLowerCase(),
    p_worker_runtime_version: acknowledgement.workerRuntimeVersion,
    p_acknowledged_at: acknowledgement.acknowledgedAt,
    p_evidence_ref: acknowledgement.evidenceRef,
    p_acknowledgement: object(
      acknowledgement,
      "roster worker acknowledgement",
    ),
  };
  const partial = {
    rpc: "acknowledge_channel_roster_bundle" as const,
    args,
    runtimeMutationAuthorized: false as const,
    orderAuthority: false as const,
  };
  return Object.freeze({ ...partial, idempotencyHash: hash(partial) });
}

export function prepareRosterBundleActivationWrite(input: {
  plan: ChannelRosterBundleActivationPlan;
  approval: ChannelRosterBundleOperatorApproval;
  approvedLifecycleReceiptId: string;
  safeBoundaryProof: JsonObject;
}): ChannelRosterBundleActivationWrite {
  const { plan, approval } = input;
  if (![plan.activationReceiptId, plan.bundleId, plan.workerAcknowledgementId,
    approval.id, approval.operatorId, input.approvedLifecycleReceiptId]
    .every((value) => UUID.test(value))) {
    throw new Error("roster activation persistence identities must be UUIDs");
  }
  if (plan.approvalId !== approval.id
      || plan.bundleId !== approval.bundleId
      || plan.workerAcknowledgementId !== approval.workerAcknowledgementId
      || plan.configurationEpochId !== approval.configurationEpochId
      || plan.candidateManifestContentHash
        !== approval.candidateManifestContentHash
      || plan.activationScope !== "prospective-new-entry-only"
      || plan.openPositionPolicyPreservation !== "entry-epoch-immutable"
      || plan.historicalEvidenceMutation !== false
      || plan.runtimeMutationAuthorized !== false
      || plan.orderAuthority !== false
      || approval.orderAuthority !== false) {
    throw new Error("roster activation persistence identity or posture drifted");
  }
  const proof = object(input.safeBoundaryProof, "safe-boundary proof");
  if (proof.globalFlat !== true
      || proof.protocolVersion !== "channel-activation-protocol-v1"
      || !Array.isArray(proof.configuredPaperAccountIds)
      || !proof.configuredPaperAccountIds.length
      || !Array.isArray(proof.brokerAccounts)
      || typeof proof.accountInventoryEvidenceRef !== "string"
      || !proof.accountInventoryEvidenceRef.trim()) {
    throw new Error("safe-boundary proof is incomplete");
  }
  const args: ChannelRosterBundleActivationWrite["args"] = {
    p_activation_receipt_id: plan.activationReceiptId.toLowerCase(),
    p_approval_id: approval.id.toLowerCase(),
    p_approved_lifecycle_receipt_id:
      input.approvedLifecycleReceiptId.toLowerCase(),
    p_bundle_id: plan.bundleId.toLowerCase(),
    p_worker_acknowledgement_id:
      plan.workerAcknowledgementId.toLowerCase(),
    p_operator_id: approval.operatorId.toLowerCase(),
    p_approval_evidence_ref: approval.approvalEvidenceRef,
    p_approved_at: approval.approvedAt,
    p_activated_at: plan.activatedAt,
    p_safe_boundary_proof: proof,
  };
  const partial = {
    rpc: "activate_channel_roster_bundle" as const,
    args,
    prospectiveOnly: true as const,
    orderAuthority: false as const,
  };
  return Object.freeze({ ...partial, idempotencyHash: hash(partial) });
}

export function rosterBundleActivationWriteIsStable(
  left: ChannelRosterBundleActivationWrite,
  right: ChannelRosterBundleActivationWrite,
): boolean {
  return left.idempotencyHash === right.idempotencyHash
    && canonicalJson(left.args) === canonicalJson(right.args);
}
