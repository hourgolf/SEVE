import {
  canonicalJson,
  type ActivationReceipt,
  type ChannelChangeProposal,
  type CompiledReleaseManifest,
  type DynamicReadinessEvidence,
  type JsonObject,
} from "./channelControlPlane";
import {
  buildImmutableActivationReceipt,
  buildRollbackPlan,
  buildShadowActivationCandidate,
  buildShadowRuntimeProjection,
  buildWorkerActivationAcknowledgement,
  reviewActivation,
  type ActivationReview,
  type EntryPolicyStamp,
  type OperatorActivationApproval,
  type RollbackPlan,
  type SafeBoundaryInput,
  type ShadowActivationCandidate,
  type WorkerActivationAcknowledgement,
  type WorkerCompatibilityProof,
} from "./channelActivation";

export const CHANNEL_CONFIGURATION_WORKFLOW_VERSION = "channel-configuration-workflow-v1" as const;

export type CapturePath =
  | "quote-capture"
  | "held-capture"
  | "manager-observer"
  | "broker-reconciliation"
  | "sentinel-evidence";

export interface CapturePathObservation {
  path: CapturePath;
  state: "observed" | "failed";
  observedAt: string;
  evidenceRef: string;
  error?: string;
}

export interface CaptureContinuityEvaluation {
  state: "pass" | "block";
  blockers: string[];
  evidenceRefs: string[];
}

export interface ConfigurationWorkflowSimulation {
  workflowVersion: typeof CHANNEL_CONFIGURATION_WORKFLOW_VERSION;
  mode: "local-simulation";
  state: "receipt-ready" | "blocked";
  proposalId: string;
  activeManifestId: string;
  candidate: Readonly<ShadowActivationCandidate>;
  review: Readonly<ActivationReview>;
  receipt: Readonly<ActivationReceipt> | null;
  rollback: Readonly<RollbackPlan> | null;
  captureContinuity: Readonly<CaptureContinuityEvaluation>;
  economicsEquivalent: boolean;
  economicProjectionBefore: JsonObject;
  economicProjectionAfter: JsonObject | null;
  blockers: string[];
  runtimeMutationAuthorized: false;
  orderAuthority: false;
}

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

export function evaluateCaptureContinuity(input: {
  observations: CapturePathObservation[];
  evaluatedAt: string;
  maxAgeMs?: number;
}): Readonly<CaptureContinuityEvaluation> {
  const blockers: string[] = [];
  const expected: CapturePath[] = [
    "quote-capture",
    "held-capture",
    "manager-observer",
    "broker-reconciliation",
    "sentinel-evidence",
  ];
  const byPath = new Map<CapturePath, CapturePathObservation>();
  for (const observation of input.observations) {
    if (byPath.has(observation.path)) blockers.push(`capture:duplicate:${observation.path}`);
    byPath.set(observation.path, observation);
  }
  const evaluatedAt = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) blockers.push("capture:evaluated_at_invalid");
  for (const path of expected) {
    const observation = byPath.get(path);
    if (!observation) {
      blockers.push(`capture:missing:${path}`);
      continue;
    }
    if (observation.state !== "observed") blockers.push(`capture:failed:${path}`);
    if (!observation.evidenceRef.trim()) blockers.push(`capture:evidence_missing:${path}`);
    const observedAt = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedAt)) blockers.push(`capture:timestamp_invalid:${path}`);
    else if (Number.isFinite(evaluatedAt)) {
      const age = evaluatedAt - observedAt;
      if (age < -5_000) blockers.push(`capture:future:${path}`);
      if (age > (input.maxAgeMs ?? 60_000)) blockers.push(`capture:stale:${path}`);
    }
  }
  return immutableCopy({
    state: blockers.length ? "block" : "pass",
    blockers,
    evidenceRefs: expected
      .map((path) => byPath.get(path)?.evidenceRef ?? "")
      .filter(Boolean)
      .sort(),
  });
}

/**
 * Identity-free economics used only to prove that a no-op canary does not
 * change worker or dashboard behavior.
 */
export function projectEconomicConfiguration(
  compiled: CompiledReleaseManifest,
): JsonObject {
  const roots = compiled.channelSpecs.map((spec) => ({
    slug: spec.slug,
    strategyIdentity: spec.strategyIdentity,
    strategyVersion: spec.strategyVersion,
    signalVersion: spec.signalVersion,
    managerProfileId: spec.managerProfileId,
    managerVersion: spec.managerVersion,
    accountId: spec.accountId,
    accountMode: spec.accountMode,
    symbolScope: spec.symbolScope,
    familyId: spec.familyId,
    cohort: spec.cohort,
    priority: spec.priority,
    quantity: spec.quantity,
    maxDebitUsd: spec.maxDebitUsd,
    entryParameters: spec.entryParameters,
    exitParameters: spec.exitParameters,
    takeProfit: spec.takeProfit,
    stopLoss: spec.stopLoss,
    ratchetParameters: spec.ratchetParameters,
    reentryPolicy: spec.reentryPolicy,
    scalePolicy: spec.scalePolicy,
    collisionDomain: spec.collisionDomain,
    riskLimits: spec.riskLimits,
  })).sort((left, right) => left.slug.localeCompare(right.slug));
  return immutableCopy({
    paperLiveAuthority: compiled.manifest.paperLiveAuthority,
    workerCompatibilityVersion: compiled.manifest.workerCompatibilityVersion,
    admissionPolicyVersion: compiled.manifest.admissionPolicyVersion,
    collisionPolicyVersion: compiled.manifest.collisionPolicyVersion,
    activationBoundary: compiled.manifest.activationBoundary,
    admissionPolicies: compiled.manifest.admissionPolicies,
    roots,
  }) as unknown as JsonObject;
}

/**
 * Runs the entire protocol as an inert local simulation. It never persists,
 * changes runtime authority, restarts a worker, or places an order.
 */
export function simulateConfigurationWorkflow(input: {
  active: CompiledReleaseManifest;
  proposal: ChannelChangeProposal;
  readiness: DynamicReadinessEvidence;
  approval: OperatorActivationApproval | null;
  boundary: SafeBoundaryInput | null;
  compatibility: WorkerCompatibilityProof | null;
  captureObservations: CapturePathObservation[];
  evaluatedAt: string;
  scheduledFor: string;
  activatedAt: string;
  acknowledgementEvidenceRef: string;
  acknowledgementAt: string;
  workerAcknowledgement?: Readonly<WorkerActivationAcknowledgement> | null;
  openPositions?: Array<Readonly<EntryPolicyStamp>>;
  maxEvidenceAgeMs?: number;
}): Readonly<ConfigurationWorkflowSimulation> {
  const candidate = buildShadowActivationCandidate({
    active: input.active,
    proposal: input.proposal,
    readiness: input.readiness,
  });
  const acknowledgement = input.workerAcknowledgement ?? (candidate.projection && input.compatibility
    ? buildWorkerActivationAcknowledgement({
      candidate,
      workerReleaseId: input.compatibility.workerReleaseId,
      bootId: input.compatibility.bootId,
      acknowledgedAt: input.acknowledgementAt,
      evidenceRef: input.acknowledgementEvidenceRef,
    })
    : null);
  const review = reviewActivation({
    candidate,
    approval: input.approval,
    boundary: input.boundary,
    compatibility: input.compatibility,
    workerAcknowledgement: acknowledgement,
    evaluatedAt: input.evaluatedAt,
    maxEvidenceAgeMs: input.maxEvidenceAgeMs,
  });
  const captureContinuity = evaluateCaptureContinuity({
    observations: input.captureObservations,
    evaluatedAt: input.evaluatedAt,
    maxAgeMs: input.maxEvidenceAgeMs,
  });
  const before = projectEconomicConfiguration(input.active);
  const after = candidate.compiled ? projectEconomicConfiguration(candidate.compiled) : null;
  const economicsEquivalent = after !== null && canonicalJson(before) === canonicalJson(after);
  const blockers = [
    ...review.blockers,
    ...captureContinuity.blockers,
  ];
  let receipt: Readonly<ActivationReceipt> | null = null;
  let rollback: Readonly<RollbackPlan> | null = null;
  if (!blockers.length && review.state === "receipt-ready") {
    receipt = buildImmutableActivationReceipt({
      review,
      scheduledFor: input.scheduledFor,
      activatedAt: input.activatedAt,
    });
    if (candidate.projection) {
      rollback = buildRollbackPlan({
        current: candidate.projection,
        target: buildShadowRuntimeProjection(input.active),
        openPositions: input.openPositions ?? [],
      });
      if (rollback.state !== "ready-for-review") blockers.push(...rollback.blockers);
    }
  }
  return immutableCopy({
    workflowVersion: CHANNEL_CONFIGURATION_WORKFLOW_VERSION,
    mode: "local-simulation",
    state: blockers.length || !receipt ? "blocked" : "receipt-ready",
    proposalId: input.proposal.id,
    activeManifestId: input.active.manifest.id,
    candidate,
    review,
    receipt: blockers.length ? null : receipt,
    rollback,
    captureContinuity,
    economicsEquivalent,
    economicProjectionBefore: before,
    economicProjectionAfter: after,
    blockers,
    runtimeMutationAuthorized: false,
    orderAuthority: false,
  });
}
