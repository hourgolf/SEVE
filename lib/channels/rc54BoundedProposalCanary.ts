import {
  buildShadowActivationCandidate,
} from "./channelActivation";
import {
  canonicalJson,
  compileReleaseManifest,
  contentHash,
} from "./channelControlPlane";
import {
  buildOperatorProposal,
} from "./channelProposalWrite";
import { RC54_CONTROL_PLANE_FIXTURE } from "./rc54ControlPlaneFixture";

export const RC54_BOUNDED_PROPOSAL_CANARY_VERSION =
  "rc54-bounded-proposal-canary-v1" as const;

const CHANNEL_SLUG = "orb-ustop-ctl";
const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-07-29T02:00:00.000Z";

export function buildRc54BoundedProposalCanary() {
  const active = compileReleaseManifest(RC54_CONTROL_PLANE_FIXTURE);
  const base = active.channelSpecs.find((spec) =>
    spec.slug === CHANNEL_SLUG);
  if (!base) {
    throw new Error(`bounded proposal canary missing ${CHANNEL_SLUG}`);
  }
  const built = buildOperatorProposal(
    active,
    {
      baseSpecVersionId: base.id,
      baseSpecContentHash: base.contentHash,
      proposedPatch: {
        quantity: 3,
        maxDebitUsd: 600,
        riskLimits: {
          maxContracts: 3,
          maxDebitUsd: 600,
          maxRiskUsd: 180,
        },
      },
      reason:
        "Local plumbing specimen only: demonstrate one coherent bounded quantity proposal for separate strategic review; this is not a recommendation or activation request.",
      evidenceRefs: [
        "local-canary:bounded-proposal-generator",
        "operator-review-required:quantity-economics",
      ],
      changeClass: "bounded-parameter",
    },
    OPERATOR_ID,
    REQUEST_ID,
    CREATED_AT,
  );
  const candidate = buildShadowActivationCandidate({
    active,
    proposal: built.proposal,
  });
  if (!candidate.compiled || !candidate.projection) {
    throw new Error("bounded proposal canary did not compile a candidate");
  }
  const workerRoot = candidate.compiled.workerProjection.roots.find((root) =>
    root.slug === CHANNEL_SLUG);
  const dashboardRoot =
    candidate.compiled.dashboardProjection.roots.find((root) =>
      root.slug === CHANNEL_SLUG);
  if (!workerRoot || !dashboardRoot) {
    throw new Error("bounded proposal canary projection is incomplete");
  }
  const artifact = {
    canaryVersion: RC54_BOUNDED_PROPOSAL_CANARY_VERSION,
    state: "prepared-review-only" as const,
    generatedAt: CREATED_AT,
    channelSlug: CHANNEL_SLUG,
    selectedValueBasis: "plumbing-specimen-only" as const,
    strategicRecommendation: false,
    strategicApproval: false,
    persistenceAuthorized: false,
    runtimeAuthority: false,
    orderAuthority: false,
    activationAuthorized: false,
    proposal: built.proposal,
    diffs: built.preview.diffs,
    capacityCollisionImpact: built.capacityCollisionImpact,
    candidate: {
      manifestId: candidate.compiled.manifest.id,
      manifestContentHash: candidate.compiled.manifest.contentHash,
      configurationEpochId: candidate.projection.configurationEpochId,
      validationReady: candidate.validationReady,
      validationResults: candidate.validationResults,
      workerRoot,
      dashboardRoot,
    },
    reviewBoundary: {
      replayEvidenceAttached: false,
      capacityEvidenceAttached: false,
      safeBoundaryObserved: false,
      workerAcknowledgementObserved: false,
      activationReceiptObserved: false,
      operatorMustChooseEconomicsSeparately: true,
    },
  };
  return Object.freeze({
    ...artifact,
    deterministicEvidenceHash: contentHash({
      canaryVersion: artifact.canaryVersion,
      payload: canonicalJson(artifact),
    }),
  });
}
