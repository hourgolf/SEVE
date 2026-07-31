// Release/cohort attribution shared by executable policy epochs and their
// downstream position evidence. Pure: no environment, broker, database, or
// order access.

export const RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION = 1 as const;

export type EvidenceEra =
  | "rc5-control"
  | "rc54-control"
  | "virtual-bench-development"
  | "t1-exact-replay"
  | "lab-executable";

export interface ReleaseEvidenceContext {
  schemaVersion: typeof RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION;
  releaseId: string;
  configurationSha256: string;
  admissionDomain: string;
  cohortId: string;
  cohortFrom: string;
  evidenceEra: EvidenceEra;
  sourceQuantity: number;
  shadowBookVersion: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]*$/i;
const EVIDENCE_ERAS = new Set<EvidenceEra>([
  "rc5-control",
  "rc54-control",
  "virtual-bench-development",
  "t1-exact-replay",
  "lab-executable",
]);

export function validateReleaseEvidenceContext(
  context: ReleaseEvidenceContext,
): string[] {
  const errors: string[] = [];
  if (context.schemaVersion !== RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION) {
    errors.push("schema_version");
  }
  if (!IDENTIFIER.test(context.releaseId)) errors.push("release_id");
  if (!SHA256.test(context.configurationSha256)) errors.push("configuration_sha256");
  if (!IDENTIFIER.test(context.admissionDomain)) errors.push("admission_domain");
  if (!IDENTIFIER.test(context.cohortId)) errors.push("cohort_id");
  if (!DATE.test(context.cohortFrom)) errors.push("cohort_from");
  if (!EVIDENCE_ERAS.has(context.evidenceEra)) errors.push("evidence_era");
  if (!Number.isInteger(context.sourceQuantity) || context.sourceQuantity < 1) {
    errors.push("source_quantity");
  }
  if (!IDENTIFIER.test(context.shadowBookVersion)) errors.push("shadow_book_version");
  return errors;
}

/** Return a detached JSON-safe stamp only when every attribution field is
 * complete. Callers fail closed by treating null as unavailable evidence. */
export function releaseEvidenceStamp(
  context: ReleaseEvidenceContext | null | undefined,
): Record<string, unknown> | null {
  if (!context || validateReleaseEvidenceContext(context).length) return null;
  return {
    schemaVersion: context.schemaVersion,
    releaseId: context.releaseId,
    configurationSha256: context.configurationSha256.toLowerCase(),
    admissionDomain: context.admissionDomain,
    cohortId: context.cohortId,
    cohortFrom: context.cohortFrom,
    evidenceEra: context.evidenceEra,
    sourceQuantity: context.sourceQuantity,
    shadowBookVersion: context.shadowBookVersion,
  };
}

/**
 * Recover the immutable release attribution carried by an existing position.
 * Exit paths must use this row-owned stamp rather than the currently active
 * manifest, because a pause, rollback, or successor epoch cannot reinterpret
 * a lot that was admitted earlier.
 */
export function releaseEvidenceContextFromStamp(
  value: unknown,
): ReleaseEvidenceContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as ReleaseEvidenceContext;
  return validateReleaseEvidenceContext(candidate).length ? null : {
    schemaVersion: candidate.schemaVersion,
    releaseId: candidate.releaseId,
    configurationSha256: candidate.configurationSha256.toLowerCase(),
    admissionDomain: candidate.admissionDomain,
    cohortId: candidate.cohortId,
    cohortFrom: candidate.cohortFrom,
    evidenceEra: candidate.evidenceEra,
    sourceQuantity: candidate.sourceQuantity,
    shadowBookVersion: candidate.shadowBookVersion,
  };
}
