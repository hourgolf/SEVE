import { contentHash } from "./channelControlPlane";
import {
  channelDecisionReview,
  type ChannelDecisionReview,
  type DecisionEvidenceLayer,
} from "./channelDecisionEvidence";

export const VERSIONED_CHANNEL_DECISION_PACKET_VERSION =
  "versioned-channel-decision-packet-v1" as const;

export interface ExactCurrentChannelCohort {
  slug: string;
  channelSpecVersionId: string;
  configurationEpochId: string;
  observations: number;
  sessions: number;
  totalUsd: number;
  evidenceRef: string;
}

export interface VersionedChannelDecisionPacket {
  version: typeof VERSIONED_CHANNEL_DECISION_PACKET_VERSION;
  contentHash: string;
  sessionDateEt: string;
  generatedAt: string;
  releaseId: string;
  manifestContentHash: string;
  configurationEpochId: string;
  predecessorContentHash: string | null;
  reviewBasisVersion: string;
  reviews: Record<string, ChannelDecisionReview>;
  sourceEvidenceRefs: string[];
  authority: {
    configurationChangeAuthorized: false;
    promotionAuthorized: false;
    mutationAuthorized: false;
    orderActionAuthorized: false;
  };
}

type PacketWithoutHash = Omit<VersionedChannelDecisionPacket, "contentHash">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function exactLayer(
  cohort: ExactCurrentChannelCohort,
): DecisionEvidenceLayer {
  return {
    kind: "current-config-executed",
    label: "CURRENT CONFIG · REFRESHED",
    observations: cohort.observations,
    sessions: cohort.sessions,
    totalUsd: cohort.totalUsd,
    expectancyUsd: cohort.observations
      ? cohort.totalUsd / cohort.observations
      : null,
    expectancyUnit: "logical-trade",
    interval95: null,
    comparability: "exact-current",
    receipt: cohort.evidenceRef,
    fact:
      `Immutable executed cohort for ${cohort.channelSpecVersionId} at ${cohort.configurationEpochId}; historical rows were not relabeled.`,
  };
}

function insufficient(slug: string): ChannelDecisionReview {
  return {
    slug,
    disposition: "insufficient-evidence",
    label: "INSUFFICIENT EVIDENCE",
    tone: "blocked",
    confidence: "insufficient",
    summary:
      "No operator-reviewed disposition exists for this channel. Keep collecting without changing execution posture.",
    secondary: [],
    layers: [],
    mutationAuthorized: false,
  };
}

export function buildVersionedChannelDecisionPacket(input: {
  sessionDateEt: string;
  generatedAt: string;
  releaseId: string;
  manifestContentHash: string;
  configurationEpochId: string;
  predecessorContentHash?: string | null;
  slugs: string[];
  exactCurrentCohorts: ExactCurrentChannelCohort[];
  reviewBasisVersion: string;
  sourceEvidenceRefs?: string[];
}): VersionedChannelDecisionPacket {
  if (!DATE.test(input.sessionDateEt)
      || !Number.isFinite(Date.parse(input.generatedAt))) {
    throw new Error("channel decision packet date identity is invalid");
  }
  if (!input.releaseId.trim()
      || !SHA256.test(input.manifestContentHash)
      || !SHA256.test(input.configurationEpochId)
      || (input.predecessorContentHash != null
        && !SHA256.test(input.predecessorContentHash))) {
    throw new Error("channel decision packet release identity is invalid");
  }
  const cohorts = new Map(
    input.exactCurrentCohorts.map((cohort) => [cohort.slug, cohort]),
  );
  const reviews = Object.fromEntries(
    [...new Set(input.slugs)].sort().map((slug) => {
      const basis = channelDecisionReview(slug) ?? insufficient(slug);
      const cohort = cohorts.get(slug);
      const layers = cohort
        ? [
          exactLayer(cohort),
          ...basis.layers.filter(
            (layer) => layer.kind !== "current-config-executed",
          ),
        ]
        : basis.layers;
      return [slug, {
        ...basis,
        layers,
        mutationAuthorized: false as const,
      }];
    }),
  );
  const sourceEvidenceRefs = [...new Set([
    ...input.exactCurrentCohorts.map((cohort) => cohort.evidenceRef),
    ...(input.sourceEvidenceRefs ?? []),
  ])].sort();
  const payload: PacketWithoutHash = {
    version: VERSIONED_CHANNEL_DECISION_PACKET_VERSION,
    sessionDateEt: input.sessionDateEt,
    generatedAt: input.generatedAt,
    releaseId: input.releaseId,
    manifestContentHash: input.manifestContentHash,
    configurationEpochId: input.configurationEpochId,
    predecessorContentHash: input.predecessorContentHash ?? null,
    reviewBasisVersion: input.reviewBasisVersion,
    reviews,
    sourceEvidenceRefs,
    authority: {
      configurationChangeAuthorized: false,
      promotionAuthorized: false,
      mutationAuthorized: false,
      orderActionAuthorized: false,
    },
  };
  return { ...payload, contentHash: contentHash(payload) };
}

export function readVersionedChannelDecisionPacket(
  value: unknown,
): VersionedChannelDecisionPacket | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<VersionedChannelDecisionPacket>;
  if (row.version !== VERSIONED_CHANNEL_DECISION_PACKET_VERSION
      || typeof row.contentHash !== "string"
      || !DATE.test(String(row.sessionDateEt ?? ""))
      || !Number.isFinite(Date.parse(String(row.generatedAt ?? "")))
      || typeof row.releaseId !== "string"
      || !SHA256.test(String(row.manifestContentHash ?? ""))
      || !SHA256.test(String(row.configurationEpochId ?? ""))
      || (row.predecessorContentHash != null
        && !SHA256.test(row.predecessorContentHash))
      || !row.reviews
      || Object.entries(row.reviews).some(([slug, review]) =>
        review.slug !== slug || review.mutationAuthorized !== false)
      || !row.authority
      || row.authority.configurationChangeAuthorized !== false
      || row.authority.promotionAuthorized !== false
      || row.authority.mutationAuthorized !== false
      || row.authority.orderActionAuthorized !== false) return null;
  const { contentHash: observedHash, ...payload } =
    row as VersionedChannelDecisionPacket;
  return contentHash(payload) === observedHash
    ? row as VersionedChannelDecisionPacket
    : null;
}
