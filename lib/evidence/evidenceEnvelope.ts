export type EvidenceLayer =
  | "account_nav"
  | "current_executed"
  | "historical_executed"
  | "historical_virtual"
  | "manager_counterfactual";

export type EvidenceUnit = "account" | "logical_trade" | "opportunity" | "contract" | "session";
export type EvidenceCompleteness = "complete" | "partial" | "stale" | "unavailable";

/** Canonical provenance carried with every decision-bearing aggregate. */
export interface EvidenceEnvelope {
  layer: EvidenceLayer;
  unit: EvidenceUnit;
  fromSession: string | null;
  throughSession: string | null;
  configurationEpochId: string | null;
  completeness: EvidenceCompleteness;
  source: string;
  asOf: string | null;
}

export const evidenceEnvelope = (value: EvidenceEnvelope): EvidenceEnvelope => {
  if (!value.source.trim()) throw new Error("evidence source is required");
  if (value.asOf != null && !Number.isFinite(Date.parse(value.asOf))) throw new Error("evidence as-of must be ISO-8601");
  if (value.fromSession && value.throughSession && value.fromSession > value.throughSession) {
    throw new Error("evidence session range is reversed");
  }
  return Object.freeze({ ...value });
};
