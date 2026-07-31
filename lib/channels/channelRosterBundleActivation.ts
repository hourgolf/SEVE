import {
  contentHash,
  type JsonObject,
} from "./channelControlPlane";
import type { LivePortfolioTruth } from "./channelPortfolioCapacity";
import type { ChannelRosterBundlePreview } from "./channelRosterBundle";

export const CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION =
  "channel-roster-bundle-activation-v1" as const;

export interface ChannelRosterBundleWorkerAcknowledgement {
  version: typeof CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION;
  id: string;
  bundleId: string;
  baseManifestId: string;
  baseManifestContentHash: string;
  candidateManifestId: string;
  candidateManifestContentHash: string;
  configurationEpochId: string;
  workerCompatibilityVersion: string;
  workerRuntimeVersion: string;
  bootId: string;
  posture: "staged-no-order-authority";
  accountMode: "paper";
  acknowledgedAt: string;
  evidenceRef: string;
  runtimeMutation: false;
  orderAuthority: false;
}

export interface ChannelRosterBundleOperatorApproval {
  version: typeof CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION;
  id: string;
  bundleId: string;
  workerAcknowledgementId: string;
  candidateManifestContentHash: string;
  configurationEpochId: string;
  operatorId: string;
  approvalEvidenceRef: string;
  approvedAt: string;
  activationBoundary: "next-safe-entry";
  runtimeMutationScope: "receipt-bound-new-entry-only";
  orderAuthority: false;
}

export interface ChannelRosterBundleActivationReview {
  version: typeof CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION;
  state: "receipt-ready" | "blocked";
  blockers: string[];
  evidenceRefs: string[];
  reviewedAt: string;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

export interface ChannelRosterBundleActivationPlan {
  version: typeof CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION;
  bundleId: string;
  activationReceiptId: string;
  approvalId: string;
  workerAcknowledgementId: string;
  configurationEpochId: string;
  priorManifestId: string;
  priorManifestContentHash: string;
  candidateManifestId: string;
  candidateManifestContentHash: string;
  rollbackTargetManifestId: string;
  exactDiffs: JsonObject[];
  capacityEvaluationHash: string;
  activatedAt: string;
  activationScope: "prospective-new-entry-only";
  openPositionPolicyPreservation: "entry-epoch-immutable";
  historicalEvidenceMutation: false;
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function evidence(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500
      || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function frozen<T>(value: T): Readonly<T> {
  const copy = structuredClone(value);
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) {
      return;
    }
    for (const child of Object.values(candidate)) visit(child);
    Object.freeze(candidate);
  };
  visit(copy);
  return copy;
}

export function buildRosterBundleWorkerAcknowledgement(input: {
  preview: ChannelRosterBundlePreview;
  id: string;
  baseManifestContentHash: string;
  workerRuntimeVersion: string;
  bootId: string;
  acknowledgedAt: string;
  evidenceRef: string;
}): Readonly<ChannelRosterBundleWorkerAcknowledgement> {
  const candidate = input.preview.candidate;
  if (input.preview.state !== "ready-for-worker-ack" || !candidate
      || !input.preview.configurationEpochId) {
    throw new Error("worker cannot acknowledge a blocked roster bundle");
  }
  if (![input.id, input.preview.id, input.bootId].every((value) => UUID.test(value))) {
    throw new Error("worker acknowledgement identities must be UUIDs");
  }
  timestamp(input.acknowledgedAt, "worker acknowledgement timestamp");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.baseManifestContentHash)) {
    throw new Error("base manifest content hash is invalid");
  }
  return frozen({
    version: CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION,
    id: input.id.toLowerCase(),
    bundleId: input.preview.id.toLowerCase(),
    baseManifestId: input.preview.activeManifestId,
    baseManifestContentHash: input.baseManifestContentHash,
    candidateManifestId: candidate.manifest.id,
    candidateManifestContentHash: candidate.manifest.contentHash,
    configurationEpochId: input.preview.configurationEpochId,
    workerCompatibilityVersion: candidate.manifest.workerCompatibilityVersion,
    workerRuntimeVersion: evidence(input.workerRuntimeVersion, "worker runtime version"),
    bootId: input.bootId.toLowerCase(),
    posture: "staged-no-order-authority",
    accountMode: "paper",
    acknowledgedAt: input.acknowledgedAt,
    evidenceRef: evidence(input.evidenceRef, "worker evidence reference"),
    runtimeMutation: false,
    orderAuthority: false,
  });
}

export function buildRosterBundleOperatorApproval(input: {
  preview: ChannelRosterBundlePreview;
  acknowledgement: ChannelRosterBundleWorkerAcknowledgement;
  id: string;
  operatorId: string;
  approvalEvidenceRef: string;
  approvedAt: string;
}): Readonly<ChannelRosterBundleOperatorApproval> {
  const candidate = input.preview.candidate;
  if (input.preview.state !== "ready-for-worker-ack" || !candidate
      || !input.preview.configurationEpochId) {
    throw new Error("operator cannot approve a blocked roster bundle");
  }
  if (![input.id, input.operatorId].every((value) => UUID.test(value))) {
    throw new Error("operator approval identities must be UUIDs");
  }
  if (input.acknowledgement.bundleId !== input.preview.id
      || input.acknowledgement.candidateManifestContentHash
        !== candidate.manifest.contentHash
      || input.acknowledgement.configurationEpochId
        !== input.preview.configurationEpochId) {
    throw new Error("operator approval worker acknowledgement drifted");
  }
  timestamp(input.approvedAt, "operator approval timestamp");
  return frozen({
    version: CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION,
    id: input.id.toLowerCase(),
    bundleId: input.preview.id.toLowerCase(),
    workerAcknowledgementId: input.acknowledgement.id,
    candidateManifestContentHash: candidate.manifest.contentHash,
    configurationEpochId: input.preview.configurationEpochId,
    operatorId: input.operatorId.toLowerCase(),
    approvalEvidenceRef: evidence(
      input.approvalEvidenceRef,
      "operator approval evidence reference",
    ),
    approvedAt: input.approvedAt,
    activationBoundary: "next-safe-entry",
    runtimeMutationScope: "receipt-bound-new-entry-only",
    orderAuthority: false,
  });
}

export function reviewRosterBundleActivation(input: {
  preview: ChannelRosterBundlePreview;
  acknowledgement: ChannelRosterBundleWorkerAcknowledgement | null;
  approval: ChannelRosterBundleOperatorApproval | null;
  live: LivePortfolioTruth;
  reviewedAt: string;
  maxEvidenceAgeMs?: number;
}): Readonly<ChannelRosterBundleActivationReview> {
  const blockers = [...input.preview.blockers];
  const refs = [...input.preview.evidenceRefs];
  const reviewedAt = timestamp(input.reviewedAt, "activation review timestamp");
  const maxAgeMs = input.maxEvidenceAgeMs ?? 30_000;
  const candidate = input.preview.candidate;
  const acknowledgement = input.acknowledgement;
  const approval = input.approval;
  if (input.preview.state !== "ready-for-worker-ack" || !candidate
      || !input.preview.capacity || !input.preview.configurationEpochId) {
    blockers.push("bundle-activation:preview_not_ready");
  } else if (input.preview.capacity.state !== "pass"
      || input.preview.historicalEvidenceMutation !== false
      || input.preview.executionAuthority !== false
      || input.preview.runtimeMutationAuthorized !== false
      || input.preview.orderAuthority !== false) {
    blockers.push("bundle-activation:preview_posture_invalid");
  }
  if (!acknowledgement) {
    blockers.push("bundle-activation:worker_ack_missing");
  } else {
    refs.push(acknowledgement.evidenceRef);
    const acknowledgedAt = timestamp(
      acknowledgement.acknowledgedAt,
      "worker acknowledgement timestamp",
    );
    if (acknowledgement.bundleId !== input.preview.id
        || !UUID.test(acknowledgement.id)
        || !UUID.test(acknowledgement.bootId)
        || !acknowledgement.evidenceRef.trim()
        || acknowledgement.baseManifestId !== input.preview.activeManifestId
        || acknowledgement.baseManifestContentHash
          !== input.preview.activeManifestContentHash
        || acknowledgement.candidateManifestId !== candidate?.manifest.id
        || acknowledgement.candidateManifestContentHash
          !== candidate?.manifest.contentHash
        || acknowledgement.configurationEpochId
          !== input.preview.configurationEpochId
        || acknowledgement.workerCompatibilityVersion
          !== candidate?.manifest.workerCompatibilityVersion
        || acknowledgement.posture !== "staged-no-order-authority"
        || acknowledgement.accountMode !== "paper"
        || acknowledgement.runtimeMutation !== false
        || acknowledgement.orderAuthority !== false) {
      blockers.push("bundle-activation:worker_ack_identity_mismatch");
    }
    if (acknowledgedAt < reviewedAt - maxAgeMs
        || acknowledgedAt > reviewedAt + 5_000) {
      blockers.push("bundle-activation:worker_ack_stale_or_future");
    }
  }
  if (!approval) {
    blockers.push("bundle-activation:operator_approval_missing");
  } else {
    refs.push(approval.approvalEvidenceRef);
    const approvedAt = timestamp(approval.approvedAt, "operator approval timestamp");
    if (!acknowledgement
        || !UUID.test(approval.id)
        || !UUID.test(approval.operatorId)
        || !approval.approvalEvidenceRef.trim()
        || approval.bundleId !== input.preview.id
        || approval.workerAcknowledgementId !== acknowledgement.id
        || approval.candidateManifestContentHash !== candidate?.manifest.contentHash
        || approval.configurationEpochId !== input.preview.configurationEpochId
        || approval.activationBoundary !== "next-safe-entry"
        || approval.runtimeMutationScope !== "receipt-bound-new-entry-only"
        || approval.orderAuthority !== false) {
      blockers.push("bundle-activation:approval_identity_mismatch");
    }
    if (acknowledgement
        && approvedAt < timestamp(
          acknowledgement.acknowledgedAt,
          "worker acknowledgement timestamp",
        )) {
      blockers.push("bundle-activation:approval_precedes_worker_ack");
    }
    if (approvedAt < reviewedAt - 2 * 60 * 60_000
        || approvedAt > reviewedAt + 5_000) {
      blockers.push("bundle-activation:approval_stale_or_future");
    }
  }
  const liveAt = timestamp(input.live.observedAt, "live portfolio timestamp");
  if (!input.live.complete || input.live.openOrders !== 0
      || input.live.positions.length !== 0) {
    blockers.push("bundle-activation:portfolio_not_proven_flat");
  }
  if (liveAt < reviewedAt - maxAgeMs || liveAt > reviewedAt + 5_000) {
    blockers.push("bundle-activation:portfolio_truth_stale_or_future");
  }
  return frozen({
    version: CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION,
    state: blockers.length ? "blocked" : "receipt-ready",
    blockers: [...new Set(blockers)].sort(),
    evidenceRefs: [...new Set(refs)].sort(),
    reviewedAt: input.reviewedAt,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}

export function buildRosterBundleActivationPlan(input: {
  preview: ChannelRosterBundlePreview;
  acknowledgement: ChannelRosterBundleWorkerAcknowledgement;
  approval: ChannelRosterBundleOperatorApproval;
  review: ChannelRosterBundleActivationReview;
  activationReceiptId: string;
  priorManifestContentHash: string;
  activatedAt: string;
}): Readonly<ChannelRosterBundleActivationPlan> {
  const candidate = input.preview.candidate;
  if (input.review.state !== "receipt-ready" || !candidate
      || !input.preview.capacity || !input.preview.configurationEpochId) {
    throw new Error("blocked roster activation cannot produce a receipt plan");
  }
  if (!UUID.test(input.activationReceiptId)
      || input.approval.bundleId !== input.preview.id
      || input.acknowledgement.bundleId !== input.preview.id
      || input.priorManifestContentHash
        !== input.preview.activeManifestContentHash) {
    throw new Error("roster activation receipt identity is invalid");
  }
  timestamp(input.activatedAt, "activation timestamp");
  return frozen({
    version: CHANNEL_ROSTER_BUNDLE_ACTIVATION_VERSION,
    bundleId: input.preview.id,
    activationReceiptId: input.activationReceiptId.toLowerCase(),
    approvalId: input.approval.id,
    workerAcknowledgementId: input.acknowledgement.id,
    configurationEpochId: input.preview.configurationEpochId,
    priorManifestId: input.preview.activeManifestId,
    priorManifestContentHash: input.priorManifestContentHash,
    candidateManifestId: candidate.manifest.id,
    candidateManifestContentHash: candidate.manifest.contentHash,
    rollbackTargetManifestId: input.preview.rollbackTargetManifestId,
    exactDiffs: structuredClone(input.preview.diffs) as unknown as JsonObject[],
    capacityEvaluationHash: contentHash(
      input.preview.capacity as unknown as JsonObject,
    ),
    activatedAt: input.activatedAt,
    activationScope: "prospective-new-entry-only",
    openPositionPolicyPreservation: "entry-epoch-immutable",
    historicalEvidenceMutation: false,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
