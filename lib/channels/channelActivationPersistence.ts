import {
  CHANNEL_ACTIVATION_PROTOCOL_VERSION,
  buildImmutableActivationReceipt,
  buildShadowActivationCandidate,
  buildWorkerActivationAcknowledgement,
  reviewActivation,
  type OperatorActivationApproval,
  type SafeBoundaryInput,
  type WorkerActivationAcknowledgement,
  type WorkerCompatibilityProof,
} from "./channelActivation";
import {
  CHANNEL_CONFIGURATION_WORKFLOW_VERSION,
  evaluateCaptureContinuity,
  type CapturePathObservation,
} from "./channelConfigurationWorkflow";
import {
  CHANNEL_CONTROL_PLANE_COMPILER_VERSION,
  canonicalJson,
  type ChannelChangeProposal,
  type CompiledReleaseManifest,
  type DynamicReadinessEvidence,
  type JsonObject,
  type ProposalReplaySummary,
} from "./channelControlPlane";

export const CHANNEL_ACTIVATION_PERSISTENCE_VERSION =
  "channel-activation-persistence-v1" as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PreparedActivationPreview {
  persistenceVersion: typeof CHANNEL_ACTIVATION_PERSISTENCE_VERSION;
  candidate: NonNullable<ReturnType<typeof buildShadowActivationCandidate>>;
  captureContinuity: ReturnType<typeof evaluateCaptureContinuity>;
  rpcArgs: {
    p_preview_id: string;
    p_proposal_id: string;
    p_base_manifest_key: string;
    p_candidate_manifest: JsonObject;
    p_configuration_epoch_id: string;
    p_worker_projection: JsonObject;
    p_dashboard_projection: JsonObject;
    p_validation_results: JsonObject[];
    p_replay_summary: JsonObject;
    p_capacity_collision_impact: JsonObject;
    p_capture_continuity: JsonObject;
    p_prepared_by: string;
    p_prepared_at: string;
  };
  runtimeMutation: false;
  orderAuthority: false;
}

export interface PreparedWorkerAcknowledgement {
  acknowledgement: Readonly<WorkerActivationAcknowledgement>;
  rpcArgs: {
    p_acknowledgement_id: string;
    p_preview_id: string;
    p_source_boot_id: string;
    p_worker_release_id: string;
    p_acknowledged_at: string;
    p_evidence_ref: string;
    p_acknowledgement: JsonObject;
  };
  runtimeMutation: false;
  orderAuthority: false;
}

export interface PreparedProposalActivation {
  approval: Readonly<OperatorActivationApproval>;
  receipt: ReturnType<typeof buildImmutableActivationReceipt>;
  rpcArgs: {
    p_activation_receipt_id: string;
    p_approval_id: string;
    p_proposal_id: string;
    p_preview_id: string;
    p_worker_acknowledgement_id: string;
    p_configuration_epoch_id: string;
    p_operator_id: string;
    p_approval_evidence_ref: string;
    p_approved_at: string;
    p_scheduled_for: string;
    p_activated_at: string;
    p_safe_boundary_proof: JsonObject;
    p_exact_diff: JsonObject;
    p_validator_versions: string[];
  };
  runtimeMutationScope: "receipt-bound-new-entry-only";
  orderAuthority: false;
}

export class ChannelActivationPersistenceError extends Error {
  readonly blockers: string[];

  constructor(message: string, blockers: string[] = []) {
    super(message);
    this.name = "ChannelActivationPersistenceError";
    this.blockers = [...new Set(blockers)].sort();
  }
}

function asJsonObject<T>(value: T): JsonObject {
  return JSON.parse(canonicalJson(value)) as JsonObject;
}

function assertUuid(value: string, field: string): string {
  if (!UUID.test(value)) {
    throw new ChannelActivationPersistenceError(`${field} must be a canonical UUID`);
  }
  return value.toLowerCase();
}

function assertTimestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ChannelActivationPersistenceError(`${field} must be a valid timestamp`);
  }
  return new Date(value).toISOString();
}

function assertCapacityCollisionImpact(
  value: JsonObject,
): asserts value is JsonObject & { state: "pass" } {
  if (value.state !== "pass") {
    throw new ChannelActivationPersistenceError(
      "capacity and collision evidence must pass before preview persistence",
      ["capacity_collision:not_passing"],
    );
  }
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
    throw new ChannelActivationPersistenceError(
      "capacity and collision evidence requires immutable references",
      ["capacity_collision:evidence_missing"],
    );
  }
}

function assertReplaySummary(
  value: ProposalReplaySummary,
): asserts value is ProposalReplaySummary & { state: "sufficient" } {
  if (value.state !== "sufficient" || value.exactSamples < 1) {
    throw new ChannelActivationPersistenceError(
      "exact replay evidence must be sufficient before preview persistence",
      ["replay:not_sufficient"],
    );
  }
  if (!value.evidenceRefs.length) {
    throw new ChannelActivationPersistenceError(
      "exact replay evidence requires immutable references",
      ["replay:evidence_missing"],
    );
  }
}

/**
 * Converts the pure generic candidate into the only database payload accepted
 * by the immutable preview RPC. This function performs no I/O.
 */
export function prepareActivationPreview(input: {
  active: CompiledReleaseManifest;
  proposal: ChannelChangeProposal;
  readiness: DynamicReadinessEvidence;
  replaySummary: ProposalReplaySummary;
  capacityCollisionImpact: JsonObject;
  captureObservations: CapturePathObservation[];
  previewId: string;
  preparedBy: string;
  preparedAt: string;
  maxEvidenceAgeMs?: number;
}): Readonly<PreparedActivationPreview> {
  if (input.proposal.approvalState !== "draft") {
    throw new ChannelActivationPersistenceError(
      "only a draft proposal can be prepared",
      ["proposal:not_draft"],
    );
  }
  assertReplaySummary(input.replaySummary);
  assertCapacityCollisionImpact(input.capacityCollisionImpact);
  const preparedAt = assertTimestamp(input.preparedAt, "preparedAt");
  const candidate = buildShadowActivationCandidate({
    active: input.active,
    proposal: {
      ...input.proposal,
      replaySummary: input.replaySummary,
    },
    readiness: input.readiness,
  });
  const captureContinuity = evaluateCaptureContinuity({
    observations: input.captureObservations,
    evaluatedAt: preparedAt,
    maxAgeMs: input.maxEvidenceAgeMs,
  });
  const blockers = [
    ...candidate.validationResults
      .filter((result) => result.state !== "pass")
      .map((result) => `validation:${result.gate}:${result.code}`),
    ...captureContinuity.blockers,
  ];
  if (!candidate.compiled || !candidate.projection || !candidate.validationReady) {
    blockers.push("candidate:not_ready");
  }
  if (blockers.length || !candidate.compiled || !candidate.projection) {
    throw new ChannelActivationPersistenceError(
      "activation preview is not validation-ready",
      blockers,
    );
  }
  if (candidate.compiled.workerProjection.manifestContentHash
        !== candidate.compiled.dashboardProjection.manifestContentHash
      || candidate.compiled.workerProjection.manifestContentHash
        !== candidate.compiled.manifest.contentHash) {
    throw new ChannelActivationPersistenceError(
      "worker and dashboard projections disagree",
      ["projection:manifest_hash_disagreement"],
    );
  }

  return Object.freeze({
    persistenceVersion: CHANNEL_ACTIVATION_PERSISTENCE_VERSION,
    candidate,
    captureContinuity,
    rpcArgs: {
      p_preview_id: assertUuid(input.previewId, "previewId"),
      p_proposal_id: assertUuid(input.proposal.id, "proposal.id"),
      p_base_manifest_key: input.active.manifest.id,
      p_candidate_manifest: asJsonObject(candidate.compiled.manifest),
      p_configuration_epoch_id: candidate.projection.configurationEpochId,
      p_worker_projection: asJsonObject(candidate.compiled.workerProjection),
      p_dashboard_projection: asJsonObject(candidate.compiled.dashboardProjection),
      p_validation_results: candidate.validationResults.map(asJsonObject),
      p_replay_summary: asJsonObject(input.replaySummary),
      p_capacity_collision_impact: asJsonObject(input.capacityCollisionImpact),
      p_capture_continuity: asJsonObject(captureContinuity),
      p_prepared_by: assertUuid(input.preparedBy, "preparedBy"),
      p_prepared_at: preparedAt,
    },
    runtimeMutation: false,
    orderAuthority: false,
  });
}

/**
 * Builds the exact worker acknowledgement RPC payload. The caller may persist
 * it only from a current paper worker after independently validating the
 * candidate projection. This function itself performs no I/O.
 */
export function prepareWorkerAcknowledgement(input: {
  preview: Readonly<PreparedActivationPreview>;
  acknowledgementId: string;
  previewId: string;
  workerReleaseId: string;
  bootId: string;
  acknowledgedAt: string;
  evidenceRef: string;
}): Readonly<PreparedWorkerAcknowledgement> {
  const acknowledgedAt = assertTimestamp(input.acknowledgedAt, "acknowledgedAt");
  if (!input.workerReleaseId.trim()) {
    throw new ChannelActivationPersistenceError("workerReleaseId is required");
  }
  if (!input.evidenceRef.trim()) {
    throw new ChannelActivationPersistenceError("worker evidence reference is required");
  }
  const acknowledgement = buildWorkerActivationAcknowledgement({
    candidate: input.preview.candidate,
    workerReleaseId: input.workerReleaseId,
    bootId: assertUuid(input.bootId, "bootId"),
    acknowledgedAt,
    evidenceRef: input.evidenceRef.trim(),
  });
  return Object.freeze({
    acknowledgement,
    rpcArgs: {
      p_acknowledgement_id: assertUuid(input.acknowledgementId, "acknowledgementId"),
      p_preview_id: assertUuid(input.previewId, "previewId"),
      p_source_boot_id: assertUuid(input.bootId, "bootId"),
      p_worker_release_id: input.workerReleaseId.trim(),
      p_acknowledged_at: acknowledgedAt,
      p_evidence_ref: input.evidenceRef.trim(),
      p_acknowledgement: asJsonObject(acknowledgement),
    },
    runtimeMutation: false,
    orderAuthority: false,
  });
}

/**
 * Produces the single atomic activation RPC payload after the generic review
 * has passed. It cannot grant order authority and does not perform the RPC.
 */
export function prepareProposalActivation(input: {
  preview: Readonly<PreparedActivationPreview>;
  worker: Readonly<PreparedWorkerAcknowledgement>;
  compatibility: WorkerCompatibilityProof;
  boundary: SafeBoundaryInput;
  approvalId: string;
  operatorId: string;
  approvalEvidenceRef: string;
  approvedAt: string;
  scheduledFor: string;
  activatedAt: string;
  evaluatedAt: string;
  maxEvidenceAgeMs?: number;
}): Readonly<PreparedProposalActivation> {
  const operatorId = assertUuid(input.operatorId, "operatorId");
  const approvedAt = assertTimestamp(input.approvedAt, "approvedAt");
  const scheduledFor = assertTimestamp(input.scheduledFor, "scheduledFor");
  const activatedAt = assertTimestamp(input.activatedAt, "activatedAt");
  const evaluatedAt = assertTimestamp(input.evaluatedAt, "evaluatedAt");
  if (!input.approvalEvidenceRef.trim()) {
    throw new ChannelActivationPersistenceError("approval evidence reference is required");
  }
  if (input.worker.acknowledgement.proposalId
      !== input.preview.candidate.proposal.id) {
    throw new ChannelActivationPersistenceError(
      "worker acknowledgement does not belong to the preview",
      ["worker_ack:proposal_mismatch"],
    );
  }
  const approval: OperatorActivationApproval = {
    proposalId: input.preview.candidate.proposal.id,
    approvedBy: operatorId,
    approvedAt,
    evidenceRef: input.approvalEvidenceRef.trim(),
  };
  const approvedCandidate = {
    ...input.preview.candidate,
    proposal: {
      ...input.preview.candidate.proposal,
      approvalState: "approved" as const,
      validationResults: input.preview.candidate.validationResults,
      replaySummary: input.preview.rpcArgs
        .p_replay_summary as unknown as ProposalReplaySummary,
    },
  };
  const review = reviewActivation({
    candidate: approvedCandidate,
    approval,
    boundary: input.boundary,
    compatibility: input.compatibility,
    workerAcknowledgement: input.worker.acknowledgement,
    evaluatedAt,
    maxEvidenceAgeMs: input.maxEvidenceAgeMs,
  });
  if (review.state !== "receipt-ready" || review.blockers.length
      || !review.safeBoundaryProof) {
    throw new ChannelActivationPersistenceError(
      "proposal activation is not receipt-ready",
      review.blockers.length ? review.blockers : [`review:${review.state}`],
    );
  }
  const receipt = buildImmutableActivationReceipt({
    review,
    scheduledFor,
    activatedAt,
  });
  if (receipt.configurationEpochId
      !== input.preview.rpcArgs.p_configuration_epoch_id) {
    throw new ChannelActivationPersistenceError(
      "activation receipt disagrees with preview epoch",
      ["receipt:configuration_epoch_mismatch"],
    );
  }
  if (!receipt.validatorVersions.includes(CHANNEL_CONTROL_PLANE_COMPILER_VERSION)
      || !receipt.validatorVersions.includes(CHANNEL_ACTIVATION_PROTOCOL_VERSION)) {
    throw new ChannelActivationPersistenceError(
      "activation receipt validator identity is incomplete",
      ["receipt:validator_versions"],
    );
  }
  if (CHANNEL_CONFIGURATION_WORKFLOW_VERSION !== "channel-configuration-workflow-v1") {
    throw new ChannelActivationPersistenceError("configuration workflow version is incompatible");
  }

  return Object.freeze({
    approval,
    receipt,
    rpcArgs: {
      p_activation_receipt_id: assertUuid(receipt.id, "activationReceiptId"),
      p_approval_id: assertUuid(input.approvalId, "approvalId"),
      p_proposal_id: assertUuid(receipt.proposalId, "proposalId"),
      p_preview_id: assertUuid(input.preview.rpcArgs.p_preview_id, "previewId"),
      p_worker_acknowledgement_id: assertUuid(
        input.worker.rpcArgs.p_acknowledgement_id,
        "workerAcknowledgementId",
      ),
      p_configuration_epoch_id: receipt.configurationEpochId,
      p_operator_id: operatorId,
      p_approval_evidence_ref: approval.evidenceRef,
      p_approved_at: approvedAt,
      p_scheduled_for: scheduledFor,
      p_activated_at: activatedAt,
      p_safe_boundary_proof: receipt.safeBoundaryProof,
      p_exact_diff: receipt.exactDiff,
      p_validator_versions: receipt.validatorVersions,
    },
    runtimeMutationScope: "receipt-bound-new-entry-only",
    orderAuthority: false,
  });
}
