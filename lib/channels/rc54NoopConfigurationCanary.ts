import {
  CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
  canonicalJson,
  compileReleaseManifest,
  contentHash,
  type ChannelChangeProposal,
  type DynamicReadinessEvidence,
} from "./channelControlPlane";
import {
  buildShadowRuntimeProjection,
  buildShadowActivationCandidate,
  resolveOpenPositionPolicy,
  stampEntryPolicy,
  type OperatorActivationApproval,
  type SafeBoundaryInput,
  type WorkerCompatibilityProof,
} from "./channelActivation";
import {
  simulateConfigurationWorkflow,
  type CapturePathObservation,
} from "./channelConfigurationWorkflow";
import {
  buildConfigurationEpochIdentity,
  stampConfigurationEvidence,
  validateConfigurationEvidenceChain,
  type ConfigurationEvidenceKind,
} from "./channelEpochEvidence";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";
import {
  stageChannelActivationShadow,
} from "../../worker/src/channelActivationShadowAdapter";
import {
  RC54_RELEASE_CONFIGURATION_SHA256,
  RC54_RELEASE_ID,
  RC54_ROOTS,
} from "../../worker/src/rc54ReleasePolicy";
import {
  RC54_WORKER_VERSION,
  WORKER_RUNTIME_VERSION,
} from "../../worker/src/version";

export const RC54_NOOP_CANARY_VERSION = "rc54-noop-configuration-canary-v1" as const;

const EVALUATED_AT = "2026-07-28T23:00:20.000Z";
const OBSERVED_AT = "2026-07-28T23:00:10.000Z";
const ACKNOWLEDGED_AT = "2026-07-28T23:00:15.000Z";
const SCHEDULED_FOR = "2026-07-28T23:00:16.000Z";
const ACTIVATED_AT = "2026-07-28T23:00:17.000Z";
const EXTRA_CONFIGURED_PAPER_ACCOUNT = "11111111-1111-4111-8111-111111111111";

export function buildRc54NoopConfigurationCanary() {
  const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
  const activeProjection = buildShadowRuntimeProjection(active);
  const base = active.channelSpecs.find((spec) => spec.slug === "orb-ustop-ctl");
  if (!base) throw new Error("RC5.4 no-op canary requires orb-ustop-ctl");
  const proposal: ChannelChangeProposal = {
    schemaVersion: CHANNEL_CONTROL_PLANE_SCHEMA_VERSION,
    id: "proposal:local-noop:rc54",
    baseSpecVersionId: base.id,
    baseSpecContentHash: base.contentHash,
    proposedSpecVersionId: "spec:local-noop:rc54:orb-ustop-ctl",
    proposedPatch: { quantity: base.quantity },
    reason: "Local protocol canary with economics identical to sealed RC5.4.",
    evidenceRefs: ["local-canary:rc54:no-op"],
    authorKind: "system",
    authorId: "local-noop-canary",
    changeClass: "bounded-parameter",
    validationResults: [],
    replaySummary: {
      state: "sufficient",
      exactSamples: 1,
      censoredSamples: 0,
      limitations: ["Protocol proof only; no strategic inference is permitted."],
      evidenceRefs: ["local-canary:replay-identity"],
    },
    approvalState: "approved",
    requestedActivationBoundary: "next-safe-entry",
    createdAt: "2026-07-28T22:59:00.000Z",
    activationAuthorized: false,
  };
  const readiness: DynamicReadinessEvidence = {
    replaySufficiency: {
      ok: true,
      fact: "The no-op projection is economically identical to sealed RC5.4.",
      evidenceRefs: ["local-canary:replay-identity"],
    },
    evidenceReadiness: {
      ok: true,
      fact: "All capture continuity fixture paths are present.",
      evidenceRefs: ["local-canary:capture-continuity"],
    },
    safeBoundary: {
      ok: true,
      fact: "The local fixture is globally flat and order-free.",
      evidenceRefs: ["local-canary:safe-boundary"],
    },
  };
  const configuredAccountIds = [
    ...new Set([
      ...active.channelSpecs.map((spec) => spec.accountId),
      EXTRA_CONFIGURED_PAPER_ACCOUNT,
    ]),
  ].sort();
  const boundary: SafeBoundaryInput = {
    observedAt: OBSERVED_AT,
    accountInventoryEvidenceRef: "local-canary:configured-paper-account-inventory",
    configuredAccounts: configuredAccountIds.map((accountId) => ({ accountId, mode: "paper" })),
    brokerAccounts: configuredAccountIds.map((accountId) => ({
      accountId,
      openPositions: {
        state: "observed",
        count: 0,
        evidenceRef: `local-canary:broker:${accountId}:positions`,
      },
      openOrders: {
        state: "observed",
        count: 0,
        evidenceRef: `local-canary:broker:${accountId}:orders`,
      },
    })),
    deskOpenPositions: {
      state: "observed",
      count: 0,
      evidenceRef: "local-canary:desk:positions",
    },
  };
  const approval: OperatorActivationApproval = {
    proposalId: proposal.id,
    approvedBy: "operator:local-canary",
    approvedAt: "2026-07-28T23:00:00.000Z",
    evidenceRef: "local-canary:operator-approval",
  };
  const compatibility: WorkerCompatibilityProof = {
    workerCompatibilityVersion: active.manifest.workerCompatibilityVersion,
    workerReleaseId: active.manifest.releaseId,
    bootId: "boot:local-canary:rc54",
    paperMode: true,
    observedAt: OBSERVED_AT,
    evidenceRef: "local-canary:worker-compatibility",
  };
  const stagedCandidate = buildShadowActivationCandidate({
    active,
    proposal,
    readiness,
  });
  const startupReceipt: Record<string, unknown> = {
    schemaVersion: 1,
    workerVersion: RC54_WORKER_VERSION,
    releaseId: RC54_RELEASE_ID,
    releaseConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
    expectedConfigurationSha256: RC54_RELEASE_CONFIGURATION_SHA256,
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
      flatEraBoundaryProven: true,
    },
  };
  const workerStage = stageChannelActivationShadow({
    candidate: stagedCandidate,
    currentReleaseId: RC54_RELEASE_ID,
    currentWorkerVersion: RC54_WORKER_VERSION,
    currentWorkerRuntimeVersion: WORKER_RUNTIME_VERSION,
    bootId: compatibility.bootId,
    paperMode: true,
    heldCaptureReady: true,
    startupReceipt,
    observedAt: ACKNOWLEDGED_AT,
    evidenceRef: "local-canary:worker-ack",
  });
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
    evidenceRef: `local-canary:capture:${path}`,
  }));
  const existingPosition = stampEntryPolicy({
    positionId: "position:open-before-local-canary",
    enteredAt: "2026-07-28T20:00:00.000Z",
    compiled: active,
    projection: activeProjection,
    channelSlug: base.slug,
  });
  const preservedPositionPolicy = resolveOpenPositionPolicy(existingPosition);
  const simulation = simulateConfigurationWorkflow({
    active,
    proposal,
    readiness,
    approval,
    boundary,
    compatibility,
    captureObservations,
    evaluatedAt: EVALUATED_AT,
    scheduledFor: SCHEDULED_FOR,
    activatedAt: ACTIVATED_AT,
    acknowledgementEvidenceRef: "local-canary:worker-ack",
    acknowledgementAt: ACKNOWLEDGED_AT,
    workerAcknowledgement: workerStage.acknowledgement,
    openPositions: [preservedPositionPolicy],
  });
  if (!simulation.candidate.compiled || !simulation.candidate.projection) {
    throw new Error("RC5.4 no-op canary candidate did not compile");
  }
  const configuration = buildConfigurationEpochIdentity({
    compiled: simulation.candidate.compiled,
    projection: simulation.candidate.projection,
    channelSlug: base.slug,
    activationReceipt: simulation.receipt,
  });
  const positionId = "position:next-safe-entry:local-canary";
  const traceId = "trace:next-safe-entry:local-canary";
  const kinds: ConfigurationEvidenceKind[] = [
    "candidate",
    "order",
    "fill",
    "position",
    "close",
    "held-path",
    "manager-observation",
  ];
  const evidence = kinds.map((evidenceKind, index) => stampConfigurationEvidence({
    evidenceKind,
    evidenceId: `local-canary:${evidenceKind}`,
    traceId,
    positionId: ["candidate", "order", "fill"].includes(evidenceKind) ? null : positionId,
    observedAt: new Date(Date.parse(ACTIVATED_AT) + index * 1_000).toISOString(),
    configuration,
  }));
  const evidenceChain = validateConfigurationEvidenceChain({
    stamps: evidence,
    requiredKinds: kinds,
  });
  const evidencePayload = {
    canaryVersion: RC54_NOOP_CANARY_VERSION,
    simulation,
    workerStage,
    preservedPositionPolicy,
    evidence,
    evidenceChain,
  };
  return {
    ...evidencePayload,
    deterministicEvidenceHash: contentHash(evidencePayload),
    economicProjectionCanonicalJson: canonicalJson(simulation.economicProjectionBefore),
    liveMutationPerformed: false as const,
    liveProposalCreated: false as const,
    activationAuthorized: false as const,
    orderAuthority: false as const,
  };
}
