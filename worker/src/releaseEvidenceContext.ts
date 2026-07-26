// Release/cohort attribution shared by executable policy epochs and their
// downstream position evidence. Pure: no environment, broker, database, or
// order access.

export const RELEASE_EVIDENCE_CONTEXT_SCHEMA_VERSION = 1 as const;

export type EvidenceEra =
  | "rc5-control"
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
