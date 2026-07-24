import { createHash } from "node:crypto";
import {
  DAY1_CONFIG_HASH,
  DAY1_RELEASE_ID,
  DAY1_ROOTS,
  type Day1RootPolicy,
} from "../channels/day1Release.js";

export const PROSPECT_LANE_CONTRACT_VERSION = "prospect-lane-contract-v1" as const;
export const ROOT_PROSPECTIVE_COHORT_START_ET = "2026-07-20" as const;

export type ProspectLifecycle =
  | "dark"
  | "exact-qualified"
  | "paper-prospect"
  | "root-candidate";

export interface ProspectEvidenceFloor {
  minimumExactSessions: number;
  minimumIndependentManagerPaths: number;
  maximumCensorRate: number;
}

export interface ProspectCandidateEvidence {
  channelSlug: string;
  familyId: string;
  underlying: "SPY" | "QQQ" | "IWM";
  channelVersion: string;
  configurationEpochId: string;
  exactSessions: number;
  independentManagerPaths: number;
  censoredManagerPaths: number;
  exactEvidenceSha256: string;
}

export interface RootContinuityReceipt {
  releaseId: typeof DAY1_RELEASE_ID;
  releaseConfigurationSha256: typeof DAY1_CONFIG_HASH;
  rootProspectiveCohortStartEt: typeof ROOT_PROSPECTIVE_COHORT_START_ET;
  rootIdentitySha256: string;
  roots: Array<{
    slug: string;
    channelVersion: string;
    configurationEpochId: string;
    managerVersion: string;
    policyEpochId: string;
  }>;
  rootEraReset: false;
  rootConfigurationChangeAuthorized: false;
}

export interface ProspectLaneReviewCandidate extends ProspectCandidateEvidence {
  lifecycle: "exact-qualified";
  censorRate: number;
  fillsAuthorized: false;
  orderPathAuthorized: false;
  automaticPromotionAuthorized: false;
}

export interface ProspectLanePlan {
  schemaVersion: 1;
  contractVersion: typeof PROSPECT_LANE_CONTRACT_VERSION;
  rootContinuity: RootContinuityReceipt;
  prospectCohortStartEt: null;
  evidenceFloor: ProspectEvidenceFloor;
  maxReviewCandidates: number;
  reviewCandidates: ProspectLaneReviewCandidate[];
  censors: Array<{
    channelSlug: string;
    code:
      | "invalid_identity"
      | "existing_root"
      | "evidence_floor_not_met"
      | "duplicate_family"
      | "review_capacity";
    fact: string;
  }>;
  paperOnly: true;
  rootConfigurationChangeAuthorized: false;
  prospectActivationAuthorized: false;
  productionChangeAuthorized: false;
}

const SHA = /^(?:sha256:)?[0-9a-f]{64}$/;

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function deriveRootContinuityReceipt(
  roots: Readonly<Record<string, Day1RootPolicy>> = DAY1_ROOTS,
): RootContinuityReceipt {
  const identities = Object.values(roots)
    .map((root) => ({
      slug: root.slug,
      channelVersion: root.channelVersion,
      configurationEpochId: root.configurationEpochId,
      managerVersion: root.managerVersion,
      policyEpochId: root.policyEpochId,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
  return {
    releaseId: DAY1_RELEASE_ID,
    releaseConfigurationSha256: DAY1_CONFIG_HASH,
    rootProspectiveCohortStartEt: ROOT_PROSPECTIVE_COHORT_START_ET,
    rootIdentitySha256: sha256(identities),
    roots: identities,
    rootEraReset: false,
    rootConfigurationChangeAuthorized: false,
  };
}

function validFloor(floor: ProspectEvidenceFloor): boolean {
  return Number.isInteger(floor.minimumExactSessions)
    && floor.minimumExactSessions > 0
    && Number.isInteger(floor.minimumIndependentManagerPaths)
    && floor.minimumIndependentManagerPaths > 0
    && Number.isFinite(floor.maximumCensorRate)
    && floor.maximumCensorRate >= 0
    && floor.maximumCensorRate <= 1;
}

export function deriveProspectLanePlan(input: {
  candidates: readonly ProspectCandidateEvidence[];
  evidenceFloor: ProspectEvidenceFloor;
  maxReviewCandidates: number;
}): ProspectLanePlan {
  if (!validFloor(input.evidenceFloor)) throw new Error("invalid prospect evidence floor");
  if (!Number.isInteger(input.maxReviewCandidates) || input.maxReviewCandidates <= 0) {
    throw new Error("maxReviewCandidates must be a positive integer");
  }

  const censors: ProspectLanePlan["censors"] = [];
  const eligible: ProspectLaneReviewCandidate[] = [];
  const rootSlugs = new Set(Object.values(DAY1_ROOTS).map((root) => root.slug));
  for (const candidate of [...input.candidates].sort((a, b) =>
    b.exactSessions - a.exactSessions
      || b.independentManagerPaths - a.independentManagerPaths
      || a.channelSlug.localeCompare(b.channelSlug))) {
    const totalPaths = candidate.independentManagerPaths + candidate.censoredManagerPaths;
    const censorRate = totalPaths > 0 ? candidate.censoredManagerPaths / totalPaths : 1;
    if (!candidate.channelSlug || !candidate.familyId || !SHA.test(candidate.channelVersion)
        || !SHA.test(candidate.configurationEpochId) || !SHA.test(candidate.exactEvidenceSha256)
        || !Number.isInteger(candidate.exactSessions) || candidate.exactSessions < 0
        || !Number.isInteger(candidate.independentManagerPaths) || candidate.independentManagerPaths < 0
        || !Number.isInteger(candidate.censoredManagerPaths) || candidate.censoredManagerPaths < 0) {
      censors.push({ channelSlug: candidate.channelSlug, code: "invalid_identity", fact: "versioned exact identity missing" });
      continue;
    }
    if (rootSlugs.has(candidate.channelSlug)) {
      censors.push({ channelSlug: candidate.channelSlug, code: "existing_root", fact: "existing root stays in its original cohort" });
      continue;
    }
    if (candidate.exactSessions < input.evidenceFloor.minimumExactSessions
        || candidate.independentManagerPaths < input.evidenceFloor.minimumIndependentManagerPaths
        || censorRate > input.evidenceFloor.maximumCensorRate) {
      censors.push({
        channelSlug: candidate.channelSlug,
        code: "evidence_floor_not_met",
        fact: `${candidate.exactSessions} sessions · ${candidate.independentManagerPaths} independent paths · ${(censorRate * 100).toFixed(1)}% censored`,
      });
      continue;
    }
    if (eligible.some((row) => row.familyId === candidate.familyId)) {
      censors.push({ channelSlug: candidate.channelSlug, code: "duplicate_family", fact: candidate.familyId });
      continue;
    }
    if (eligible.length >= input.maxReviewCandidates) {
      censors.push({ channelSlug: candidate.channelSlug, code: "review_capacity", fact: String(input.maxReviewCandidates) });
      continue;
    }
    eligible.push({
      ...candidate,
      lifecycle: "exact-qualified",
      censorRate,
      fillsAuthorized: false,
      orderPathAuthorized: false,
      automaticPromotionAuthorized: false,
    });
  }

  return {
    schemaVersion: 1,
    contractVersion: PROSPECT_LANE_CONTRACT_VERSION,
    rootContinuity: deriveRootContinuityReceipt(),
    prospectCohortStartEt: null,
    evidenceFloor: input.evidenceFloor,
    maxReviewCandidates: input.maxReviewCandidates,
    reviewCandidates: eligible,
    censors,
    paperOnly: true,
    rootConfigurationChangeAuthorized: false,
    prospectActivationAuthorized: false,
    productionChangeAuthorized: false,
  };
}
