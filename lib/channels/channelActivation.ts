import {
  CHANNEL_CONTROL_PLANE_COMPILER_VERSION,
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  canonicalJson,
  compileReleaseManifest,
  contentHash,
  projectAdmissionPolicyReentry,
  projectActiveVersusDraft,
  type ActivationReceipt,
  type ChannelChangeProposal,
  type ChannelSpecVersion,
  type ChannelSpecVersionDraft,
  type CompiledReleaseManifest,
  type DynamicReadinessEvidence,
  type JsonObject,
  type ReleaseManifestDraft,
  type ValidationGateResult,
} from "./channelControlPlane";

export const CHANNEL_ACTIVATION_PROTOCOL_VERSION = "channel-activation-protocol-v1" as const;
export const CHANNEL_RUNTIME_PROJECTION_MODE = "disabled-shadow" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const STATIC_GATES = new Set([
  "schema",
  "risk",
  "capacity",
  "account-authority",
  "collision",
  "reentry-scaling",
  "rollback",
]);

function immutableCopy<T>(value: T): Readonly<T> {
  const copy = JSON.parse(canonicalJson(value)) as T;
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function withoutContentHash(spec: ChannelSpecVersion): ChannelSpecVersionDraft {
  const { contentHash: _contentHash, ...draft } = spec;
  return draft;
}

function deterministicUuid(value: unknown): string {
  const hex = contentHash(value).slice("sha256:".length);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function timeIssue(
  timestamp: string,
  evaluatedAt: string,
  maxAgeMs: number,
  label: string,
): string | null {
  const observed = Date.parse(timestamp);
  const evaluated = Date.parse(evaluatedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(evaluated)) return `${label}:invalid_timestamp`;
  const age = evaluated - observed;
  if (age < -5_000) return `${label}:future`;
  if (age > maxAgeMs) return `${label}:stale`;
  return null;
}

export interface ShadowRuntimeProjection {
  protocolVersion: typeof CHANNEL_ACTIVATION_PROTOCOL_VERSION;
  mode: typeof CHANNEL_RUNTIME_PROJECTION_MODE;
  readOnly: true;
  paperOnly: true;
  orderAuthority: false;
  activationAuthorized: false;
  state: "comparable" | "blocked";
  blockers: string[];
  releaseId: string;
  manifestId: string;
  manifestContentHash: string;
  parentManifestId: string | null;
  rollbackTargetManifestId: string;
  workerCompatibilityVersion: string;
  configurationEpochId: string;
  workerConfig: CompiledReleaseManifest["workerProjection"];
}

/**
 * Produces a deterministic, read-only projection suitable for comparing a
 * manifest with the current worker seam. It is deliberately impossible for
 * this value to grant activation or order authority.
 */
export function buildShadowRuntimeProjection(
  compiled: CompiledReleaseManifest,
): Readonly<ShadowRuntimeProjection> {
  const blockers: string[] = [];
  if (compiled.manifest.paperLiveAuthority !== "paper-only") blockers.push("manifest:not_paper_only");
  if (compiled.channelSpecs.some((spec) => spec.accountMode !== "paper")) blockers.push("spec:not_paper");
  if (compiled.workerProjection.manifestContentHash !== compiled.manifest.contentHash) {
    blockers.push("projection:manifest_hash_mismatch");
  }
  if (compiled.workerProjection.releaseId !== compiled.manifest.releaseId) {
    blockers.push("projection:release_id_mismatch");
  }
  if (compiled.workerProjection.workerCompatibilityVersion !== compiled.manifest.workerCompatibilityVersion) {
    blockers.push("projection:worker_compatibility_mismatch");
  }
  const specIdentities = compiled.channelSpecs
    .map((spec) => `${spec.id}:${spec.contentHash}`)
    .sort();
  const projectedIdentities = compiled.workerProjection.roots
    .map((root) => `${root.channelSpecVersionId}:${root.channelSpecContentHash}`)
    .sort();
  if (canonicalJson(specIdentities) !== canonicalJson(projectedIdentities)) {
    blockers.push("projection:spec_roster_mismatch");
  }
  for (const result of compiled.validationResults) {
    if (STATIC_GATES.has(result.gate) && result.state !== "pass") {
      blockers.push(`validation:${result.gate}:${result.code}`);
    }
  }
  if ((compiled.activationAuthorized as boolean) || (compiled.workerProjection.activationAuthorized as boolean)) {
    blockers.push("projection:unexpected_activation_authority");
  }
  const configurationEpochId = contentHash({
    protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    manifestContentHash: compiled.manifest.contentHash,
    channelSpecContentHashes: compiled.manifest.channelSpecContentHashes,
  });
  return immutableCopy({
    protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    mode: CHANNEL_RUNTIME_PROJECTION_MODE,
    readOnly: true,
    paperOnly: true,
    orderAuthority: false,
    activationAuthorized: false,
    state: blockers.length ? "blocked" : "comparable",
    blockers,
    releaseId: compiled.manifest.releaseId,
    manifestId: compiled.manifest.id,
    manifestContentHash: compiled.manifest.contentHash,
    parentManifestId: compiled.manifest.parentManifestId,
    rollbackTargetManifestId: compiled.manifest.rollbackTargetManifestId,
    workerCompatibilityVersion: compiled.manifest.workerCompatibilityVersion,
    configurationEpochId,
    workerConfig: compiled.workerProjection,
  });
}

export interface ShadowActivationCandidate {
  proposal: ChannelChangeProposal;
  activeSpec: ChannelSpecVersion | null;
  proposedSpec: ChannelSpecVersion | null;
  diffs: Array<{ field: string; before: string; after: string }>;
  compiled: CompiledReleaseManifest | null;
  projection: Readonly<ShadowRuntimeProjection> | null;
  validationResults: ValidationGateResult[];
  validationReady: boolean;
  activationAuthorized: false;
}

/**
 * Reuses the canonical proposal preview and manifest compiler, then wraps the
 * result in the disabled runtime projection. No runtime imports this adapter.
 */
export function buildShadowActivationCandidate(input: {
  active: CompiledReleaseManifest;
  proposal: ChannelChangeProposal;
  readiness?: DynamicReadinessEvidence;
}): Readonly<ShadowActivationCandidate> {
  const preview = projectActiveVersusDraft(input.active, input.proposal, input.readiness);
  if (!preview.activeSpec || !preview.draftSpec) {
    return immutableCopy({
      proposal: input.proposal,
      activeSpec: preview.activeSpec,
      proposedSpec: preview.draftSpec,
      diffs: preview.diffs,
      compiled: null,
      projection: null,
      validationResults: preview.validationResults,
      validationReady: false,
      activationAuthorized: false,
    });
  }
  const channelSpecs = input.active.channelSpecs.map((spec) =>
    spec.id === preview.activeSpec?.id
      ? withoutContentHash(preview.draftSpec as ChannelSpecVersion)
      : withoutContentHash(spec));
  const draft: ReleaseManifestDraft = {
    ...input.active.manifest,
    id: `manifest:candidate:${input.proposal.id}`,
    releaseId: `${input.active.manifest.releaseId}:candidate:${input.proposal.id}`,
    rollbackTargetManifestId: input.active.manifest.id,
    parentManifestId: input.active.manifest.id,
    createdBy: `${input.proposal.authorKind}:${input.proposal.authorId}`,
    createdAt: input.proposal.createdAt,
    status: "draft",
    channelSpecs,
    admissionPolicies: projectAdmissionPolicyReentry(
      input.active.manifest.admissionPolicies,
      channelSpecs,
    ),
  };
  const compiled = compileReleaseManifest(draft, input.readiness);
  const proposalResults = preview.validationResults.filter((result) => result.code.startsWith("proposal:"));
  const validationResults = [...proposalResults, ...compiled.validationResults];
  const projection = buildShadowRuntimeProjection(compiled);
  return immutableCopy({
    proposal: input.proposal,
    activeSpec: preview.activeSpec,
    proposedSpec: compiled.channelSpecs.find((spec) => spec.id === input.proposal.proposedSpecVersionId) ?? null,
    diffs: preview.diffs,
    compiled,
    projection,
    validationResults,
    validationReady: validationResults.every((result) => result.state === "pass")
      && projection.state === "comparable",
    activationAuthorized: false,
  });
}

export type CountObservation =
  | { state: "observed"; count: number; evidenceRef: string }
  | { state: "failed"; error: string };

export interface SafeBoundaryInput {
  observedAt: string;
  accountInventoryEvidenceRef: string;
  configuredAccounts: Array<{ accountId: string; mode: "paper" | "live" }>;
  brokerAccounts: Array<{
    accountId: string;
    openPositions: CountObservation;
    openOrders: CountObservation;
  }>;
  deskOpenPositions: CountObservation;
}

export interface SafeBoundaryEvaluation {
  state: "pass" | "block";
  blockers: string[];
  proof: JsonObject | null;
}

export function evaluateSafeBoundary(input: {
  boundary: SafeBoundaryInput | null;
  evaluatedAt: string;
  maxAgeMs?: number;
}): Readonly<SafeBoundaryEvaluation> {
  const boundary = input.boundary;
  if (!boundary) return immutableCopy({
    state: "block",
    blockers: ["safe_boundary:missing"],
    proof: null,
  });
  const blockers: string[] = [];
  const time = timeIssue(boundary.observedAt, input.evaluatedAt, input.maxAgeMs ?? 30_000, "safe_boundary");
  if (time) blockers.push(time);
  if (!boundary.accountInventoryEvidenceRef.trim()) blockers.push("safe_boundary:account_inventory_evidence_missing");
  const configuredIds = boundary.configuredAccounts.map((account) => account.accountId);
  if (!configuredIds.length) blockers.push("safe_boundary:no_configured_accounts");
  if (new Set(configuredIds).size !== configuredIds.length) blockers.push("safe_boundary:duplicate_configured_account");
  for (const account of boundary.configuredAccounts) {
    if (account.mode !== "paper") blockers.push(`safe_boundary:non_paper_account:${account.accountId}`);
  }
  const brokerIds = boundary.brokerAccounts.map((account) => account.accountId);
  if (new Set(brokerIds).size !== brokerIds.length) blockers.push("safe_boundary:duplicate_broker_account");
  for (const accountId of configuredIds) {
    if (!brokerIds.includes(accountId)) blockers.push(`safe_boundary:account_not_queried:${accountId}`);
  }
  for (const accountId of brokerIds) {
    if (!configuredIds.includes(accountId)) blockers.push(`safe_boundary:unconfigured_account:${accountId}`);
  }
  const inspectCount = (label: string, observation: CountObservation): void => {
    if (observation.state === "failed") {
      blockers.push(`${label}:query_failed`);
      return;
    }
    if (!Number.isInteger(observation.count) || observation.count < 0) {
      blockers.push(`${label}:invalid_count`);
    } else if (observation.count !== 0) {
      blockers.push(`${label}:not_flat:${observation.count}`);
    }
    if (!observation.evidenceRef.trim()) blockers.push(`${label}:missing_evidence`);
  };
  for (const account of boundary.brokerAccounts) {
    inspectCount(`safe_boundary:${account.accountId}:positions`, account.openPositions);
    inspectCount(`safe_boundary:${account.accountId}:orders`, account.openOrders);
  }
  inspectCount("safe_boundary:desk_positions", boundary.deskOpenPositions);
  return immutableCopy({
    state: blockers.length ? "block" : "pass",
    blockers,
    proof: blockers.length ? null : {
      protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
      observedAt: boundary.observedAt,
      accountInventoryEvidenceRef: boundary.accountInventoryEvidenceRef,
      configuredPaperAccountIds: [...configuredIds].sort(),
      brokerAccounts: [...boundary.brokerAccounts]
        .sort((left, right) => left.accountId.localeCompare(right.accountId))
        .map((account) => ({
          accountId: account.accountId,
          openPositions: account.openPositions,
          openOrders: account.openOrders,
        })),
      deskOpenPositions: boundary.deskOpenPositions,
      globalFlat: true,
    },
  });
}

export interface OperatorActivationApproval {
  proposalId: string;
  approvedBy: string;
  approvedAt: string;
  evidenceRef: string;
}

export interface WorkerCompatibilityProof {
  workerCompatibilityVersion: string;
  workerReleaseId: string;
  bootId: string;
  paperMode: boolean;
  observedAt: string;
  evidenceRef: string;
}

export interface WorkerActivationAcknowledgement {
  protocolVersion: typeof CHANNEL_ACTIVATION_PROTOCOL_VERSION;
  proposalId: string;
  manifestId: string;
  manifestContentHash: string;
  configurationEpochId: string;
  workerCompatibilityVersion: string;
  workerReleaseId: string;
  bootId: string;
  accountMode: "paper";
  posture: "staged-no-order-authority";
  acknowledgedAt: string;
  evidenceRef: string;
}

export function buildWorkerActivationAcknowledgement(input: {
  candidate: Readonly<ShadowActivationCandidate>;
  workerReleaseId: string;
  bootId: string;
  acknowledgedAt: string;
  evidenceRef: string;
}): Readonly<WorkerActivationAcknowledgement> {
  if (!input.candidate.projection) throw new Error("worker acknowledgement requires a compiled candidate");
  return immutableCopy({
    protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    proposalId: input.candidate.proposal.id,
    manifestId: input.candidate.projection.manifestId,
    manifestContentHash: input.candidate.projection.manifestContentHash,
    configurationEpochId: input.candidate.projection.configurationEpochId,
    workerCompatibilityVersion: input.candidate.projection.workerCompatibilityVersion,
    workerReleaseId: input.workerReleaseId,
    bootId: input.bootId,
    accountMode: "paper",
    posture: "staged-no-order-authority",
    acknowledgedAt: input.acknowledgedAt,
    evidenceRef: input.evidenceRef,
  });
}

export type ActivationReviewState =
  | "blocked"
  | "awaiting-validation"
  | "awaiting-operator-approval"
  | "awaiting-safe-boundary"
  | "awaiting-worker-ack"
  | "receipt-ready";

export interface ActivationReview {
  state: ActivationReviewState;
  candidate: Readonly<ShadowActivationCandidate>;
  approval: OperatorActivationApproval | null;
  boundary: SafeBoundaryInput | null;
  safeBoundaryProof: JsonObject | null;
  compatibility: WorkerCompatibilityProof | null;
  workerAcknowledgement: WorkerActivationAcknowledgement | null;
  blockers: string[];
  activationAuthorized: false;
}

export function reviewActivation(input: {
  candidate: Readonly<ShadowActivationCandidate>;
  approval: OperatorActivationApproval | null;
  boundary: SafeBoundaryInput | null;
  compatibility: WorkerCompatibilityProof | null;
  workerAcknowledgement: WorkerActivationAcknowledgement | null;
  evaluatedAt: string;
  maxEvidenceAgeMs?: number;
}): Readonly<ActivationReview> {
  const projection = input.candidate.projection;
  const structural: string[] = [];
  if (!input.candidate.compiled || !projection) structural.push("candidate:not_compiled");
  else if (projection.state !== "comparable") structural.push(...projection.blockers);
  if (!input.candidate.activeSpec || !input.candidate.proposedSpec) structural.push("candidate:spec_pair_missing");
  if (input.candidate.proposal.approvalState !== "approved") structural.push("proposal:not_approved");

  const validation = input.candidate.validationResults
    .filter((result) => result.state !== "pass")
    .map((result) => `validation:${result.gate}:${result.code}`);
  if (!input.compatibility) {
    validation.push("compatibility:missing");
  } else if (projection) {
    if (input.compatibility.workerCompatibilityVersion !== projection.workerCompatibilityVersion) {
      validation.push("compatibility:version_mismatch");
    }
    if (!input.compatibility.paperMode) validation.push("compatibility:not_paper");
    if (!input.compatibility.workerReleaseId.trim()) validation.push("compatibility:release_missing");
    if (!input.compatibility.bootId.trim()) validation.push("compatibility:boot_missing");
    if (!input.compatibility.evidenceRef.trim()) validation.push("compatibility:evidence_missing");
    const issue = timeIssue(
      input.compatibility.observedAt,
      input.evaluatedAt,
      input.maxEvidenceAgeMs ?? 60_000,
      "compatibility",
    );
    if (issue) validation.push(issue);
  }

  const approval: string[] = [];
  if (!input.approval) approval.push("approval:missing");
  else {
    if (input.approval.proposalId !== input.candidate.proposal.id) approval.push("approval:proposal_mismatch");
    if (!input.approval.approvedBy.trim()) approval.push("approval:operator_missing");
    if (!input.approval.evidenceRef.trim()) approval.push("approval:evidence_missing");
    if (!Number.isFinite(Date.parse(input.approval.approvedAt))) approval.push("approval:invalid_timestamp");
  }

  const boundary = evaluateSafeBoundary({
    boundary: input.boundary,
    evaluatedAt: input.evaluatedAt,
    maxAgeMs: input.maxEvidenceAgeMs,
  });

  const acknowledgement: string[] = [];
  if (!input.workerAcknowledgement) acknowledgement.push("worker_ack:missing");
  else if (projection) {
    const ack = input.workerAcknowledgement;
    if (ack.protocolVersion !== CHANNEL_ACTIVATION_PROTOCOL_VERSION) {
      acknowledgement.push("worker_ack:protocol_mismatch");
    }
    if (ack.proposalId !== input.candidate.proposal.id) acknowledgement.push("worker_ack:proposal_mismatch");
    if (ack.manifestId !== projection.manifestId) acknowledgement.push("worker_ack:manifest_mismatch");
    if (ack.manifestContentHash !== projection.manifestContentHash) {
      acknowledgement.push("worker_ack:manifest_hash_mismatch");
    }
    if (ack.configurationEpochId !== projection.configurationEpochId) {
      acknowledgement.push("worker_ack:configuration_epoch_mismatch");
    }
    if (ack.workerCompatibilityVersion !== projection.workerCompatibilityVersion) {
      acknowledgement.push("worker_ack:compatibility_mismatch");
    }
    if (ack.accountMode !== "paper") acknowledgement.push("worker_ack:not_paper");
    if (ack.posture !== "staged-no-order-authority") acknowledgement.push("worker_ack:unsafe_posture");
    if (!ack.workerReleaseId.trim()) acknowledgement.push("worker_ack:release_missing");
    if (!ack.bootId.trim()) acknowledgement.push("worker_ack:boot_missing");
    if (!ack.evidenceRef.trim()) acknowledgement.push("worker_ack:evidence_missing");
    if (input.compatibility
        && (ack.workerReleaseId !== input.compatibility.workerReleaseId
          || ack.bootId !== input.compatibility.bootId)) {
      acknowledgement.push("worker_ack:worker_identity_mismatch");
    }
    const issue = timeIssue(
      ack.acknowledgedAt,
      input.evaluatedAt,
      input.maxEvidenceAgeMs ?? 60_000,
      "worker_ack",
    );
    if (issue) acknowledgement.push(issue);
  }

  let state: ActivationReviewState = "receipt-ready";
  let blockers: string[] = [];
  if (structural.length) {
    state = "blocked";
    blockers = structural;
  } else if (validation.length) {
    state = "awaiting-validation";
    blockers = validation;
  } else if (approval.length) {
    state = "awaiting-operator-approval";
    blockers = approval;
  } else if (boundary.state !== "pass") {
    state = "awaiting-safe-boundary";
    blockers = boundary.blockers;
  } else if (acknowledgement.length) {
    state = "awaiting-worker-ack";
    blockers = acknowledgement;
  }
  return immutableCopy({
    state,
    candidate: input.candidate,
    approval: input.approval,
    boundary: input.boundary,
    safeBoundaryProof: boundary.proof,
    compatibility: input.compatibility,
    workerAcknowledgement: input.workerAcknowledgement,
    blockers,
    activationAuthorized: false,
  });
}

export function buildImmutableActivationReceipt(input: {
  review: Readonly<ActivationReview>;
  scheduledFor: string;
  activatedAt: string;
}): Readonly<ActivationReceipt> {
  const { review } = input;
  if (review.state !== "receipt-ready"
      || !review.candidate.compiled
      || !review.candidate.projection
      || !review.candidate.activeSpec
      || !review.candidate.proposedSpec
      || !review.approval
      || !review.safeBoundaryProof
      || !review.workerAcknowledgement) {
    throw new Error("activation receipt requires a receipt-ready review");
  }
  if (Date.parse(input.activatedAt) < Date.parse(input.scheduledFor)) {
    throw new Error("activation cannot precede its schedule");
  }
  const receiptPayload = {
    protocolVersion: CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    proposalId: review.candidate.proposal.id,
    configurationEpochId: review.candidate.projection.configurationEpochId,
    manifestContentHash: review.candidate.projection.manifestContentHash,
    activatedAt: input.activatedAt,
  };
  const receipt: ActivationReceipt = {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: deterministicUuid(receiptPayload),
    configurationEpochId: review.candidate.projection.configurationEpochId,
    proposalId: review.candidate.proposal.id,
    oldSpecVersionId: review.candidate.activeSpec.id,
    newSpecVersionId: review.candidate.proposedSpec.id,
    releaseManifestId: review.candidate.compiled.manifest.id,
    exactDiff: { fields: review.candidate.diffs },
    validationResults: review.candidate.validationResults,
    validatorVersions: [
      CHANNEL_CONTROL_PLANE_COMPILER_VERSION,
      CHANNEL_ACTIVATION_PROTOCOL_VERSION,
    ],
    approvedBy: review.approval.approvedBy,
    scheduledFor: input.scheduledFor,
    activatedAt: input.activatedAt,
    safeBoundaryProof: review.safeBoundaryProof,
    workerAcknowledgement: review.workerAcknowledgement as unknown as JsonObject,
    rollbackTargetManifestId: review.candidate.compiled.manifest.rollbackTargetManifestId,
    oldContentHash: review.candidate.activeSpec.contentHash,
    newContentHash: review.candidate.proposedSpec.contentHash,
    manifestContentHash: review.candidate.projection.manifestContentHash,
  };
  return immutableCopy(receipt);
}

export interface EntryPolicyStamp {
  stampVersion: 1;
  positionId: string;
  enteredAt: string;
  channelSlug: string;
  accountId: string;
  releaseManifestId: string;
  releaseManifestContentHash: string;
  channelSpecVersionId: string;
  channelSpecContentHash: string;
  configurationEpochId: string;
  managerProfileId: string;
  managerVersion: string;
  quantity: number;
  entryParameters: JsonObject;
  exitParameters: JsonObject;
  takeProfit: JsonObject;
  stopLoss: JsonObject;
  ratchetParameters: JsonObject;
}

export function stampEntryPolicy(input: {
  positionId: string;
  enteredAt: string;
  compiled: CompiledReleaseManifest;
  projection: Readonly<ShadowRuntimeProjection>;
  channelSlug: string;
}): Readonly<EntryPolicyStamp> {
  if (input.projection.manifestContentHash !== input.compiled.manifest.contentHash) {
    throw new Error("entry policy stamp requires an exact manifest projection");
  }
  const spec = input.compiled.channelSpecs.find((candidate) => candidate.slug === input.channelSlug);
  if (!spec) throw new Error(`entry policy stamp missing channel ${input.channelSlug}`);
  return immutableCopy({
    stampVersion: 1,
    positionId: input.positionId,
    enteredAt: input.enteredAt,
    channelSlug: spec.slug,
    accountId: spec.accountId,
    releaseManifestId: input.compiled.manifest.id,
    releaseManifestContentHash: input.compiled.manifest.contentHash,
    channelSpecVersionId: spec.id,
    channelSpecContentHash: spec.contentHash,
    configurationEpochId: input.projection.configurationEpochId,
    managerProfileId: spec.managerProfileId,
    managerVersion: spec.managerVersion,
    quantity: spec.quantity,
    entryParameters: spec.entryParameters,
    exitParameters: spec.exitParameters,
    takeProfit: spec.takeProfit as unknown as JsonObject,
    stopLoss: spec.stopLoss as unknown as JsonObject,
    ratchetParameters: spec.ratchetParameters as unknown as JsonObject,
  });
}

/**
 * Open-position management resolves only from its immutable entry stamp.
 * There is intentionally no current channel/account/manifest fallback input.
 */
export function resolveOpenPositionPolicy(
  entryStamp: Readonly<EntryPolicyStamp>,
): Readonly<EntryPolicyStamp> {
  if (!SHA256.test(entryStamp.releaseManifestContentHash)
      || !SHA256.test(entryStamp.channelSpecContentHash)
      || !SHA256.test(entryStamp.configurationEpochId)) {
    throw new Error("open position is missing an immutable entry policy identity");
  }
  return immutableCopy(entryStamp);
}

export interface RollbackPlan {
  state: "ready-for-review" | "blocked";
  blockers: string[];
  fromManifestId: string;
  fromManifestContentHash: string;
  targetManifestId: string;
  targetManifestContentHash: string;
  targetConfigurationEpochId: string;
  boundary: "next-safe-entry";
  preservedOpenPositions: Array<{
    positionId: string;
    channelSpecVersionId: string;
    configurationEpochId: string;
  }>;
  historicalEvidenceMutation: "forbidden";
  activationAuthorized: false;
}

export function buildRollbackPlan(input: {
  current: Readonly<ShadowRuntimeProjection>;
  target: Readonly<ShadowRuntimeProjection>;
  openPositions: Array<Readonly<EntryPolicyStamp>>;
}): Readonly<RollbackPlan> {
  const blockers: string[] = [];
  if (input.current.state !== "comparable") blockers.push("rollback:current_projection_blocked");
  if (input.target.state !== "comparable") blockers.push("rollback:target_projection_blocked");
  if (input.current.rollbackTargetManifestId !== input.target.manifestId) {
    blockers.push("rollback:target_manifest_mismatch");
  }
  if (input.current.parentManifestId !== input.target.manifestId) {
    blockers.push("rollback:lineage_mismatch");
  }
  if (input.current.manifestContentHash === input.target.manifestContentHash) {
    blockers.push("rollback:no_manifest_change");
  }
  const seen = new Set<string>();
  for (const stamp of input.openPositions) {
    if (seen.has(stamp.positionId)) blockers.push(`rollback:duplicate_position:${stamp.positionId}`);
    seen.add(stamp.positionId);
    if (!SHA256.test(stamp.channelSpecContentHash) || !SHA256.test(stamp.configurationEpochId)) {
      blockers.push(`rollback:position_identity_missing:${stamp.positionId}`);
    }
  }
  return immutableCopy({
    state: blockers.length ? "blocked" : "ready-for-review",
    blockers,
    fromManifestId: input.current.manifestId,
    fromManifestContentHash: input.current.manifestContentHash,
    targetManifestId: input.target.manifestId,
    targetManifestContentHash: input.target.manifestContentHash,
    targetConfigurationEpochId: input.target.configurationEpochId,
    boundary: "next-safe-entry",
    preservedOpenPositions: input.openPositions.map((stamp) => ({
      positionId: stamp.positionId,
      channelSpecVersionId: stamp.channelSpecVersionId,
      configurationEpochId: stamp.configurationEpochId,
    })),
    historicalEvidenceMutation: "forbidden",
    activationAuthorized: false,
  });
}
