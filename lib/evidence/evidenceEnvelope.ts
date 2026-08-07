export type EvidenceLayer =
  | "account_nav"
  | "current_executed"
  | "historical_executed"
  | "historical_virtual"
  | "session_virtual"
  | "manager_counterfactual"
  | "capacity_replay"
  | "proposal_simulation";

export type EvidenceUnit = "account" | "position_row" | "logical_trade" | "logical_opportunity" | "opportunity" | "contract" | "session";
export type EvidenceCompleteness = "complete" | "partial" | "stale" | "unavailable";
export type EvidenceReconciliation = "reconciled" | "difference_explained" | "unverified" | "blocked";

export interface EvidenceScope {
  kind: "account" | "channel" | "portfolio";
  accountIds: string[];
  channelSlugs: string[];
}

/** Canonical provenance carried with every decision-bearing aggregate. */
export interface EvidenceEnvelope {
  layer: EvidenceLayer;
  unit: EvidenceUnit;
  fromSession: string | null;
  throughSession: string | null;
  configurationEpochId: string | null;
  managerVersion: string | null;
  scope: EvidenceScope;
  completeness: EvidenceCompleteness;
  reconciliation: EvidenceReconciliation;
  source: string;
  receiptHash: string | null;
  limitations: string[];
  asOf: string | null;
}

export const evidenceEnvelope = (value: EvidenceEnvelope): EvidenceEnvelope => {
  if (!value.source.trim()) throw new Error("evidence source is required");
  if (value.asOf != null && !Number.isFinite(Date.parse(value.asOf))) throw new Error("evidence as-of must be ISO-8601");
  if (value.fromSession && value.throughSession && value.fromSession > value.throughSession) {
    throw new Error("evidence session range is reversed");
  }
  if (value.receiptHash != null && !/^[a-f0-9]{64}$/i.test(value.receiptHash)) {
    throw new Error("evidence receipt hash must be SHA-256");
  }
  if (value.scope.kind === "account" && value.scope.accountIds.length > 1) {
    throw new Error("account evidence scope permits at most one account id");
  }
  if (value.scope.kind === "account" && value.completeness !== "unavailable" && value.scope.accountIds.length !== 1) {
    throw new Error("available account evidence scope requires exactly one account id");
  }
  return Object.freeze({
    ...value,
    scope: Object.freeze({
      ...value.scope,
      accountIds: Object.freeze([...new Set(value.scope.accountIds)].sort()) as unknown as string[],
      channelSlugs: Object.freeze([...new Set(value.scope.channelSlugs)].sort()) as unknown as string[],
    }),
    limitations: Object.freeze([...value.limitations]) as unknown as string[],
  });
};
