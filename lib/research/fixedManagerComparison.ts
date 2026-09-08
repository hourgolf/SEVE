import { fixedEntryOwnershipPresent } from "../channels/fixedEntryOwnership";
/** Browser-safe comparison contract. Raw manager terminals remain immutable;
 * eligibility is applied to derived values before any pairing or aggregation.
 * Only a complete server-side original-ledger verifier may populate this index.
 */
export interface FixedManagerComparisonEvidence {
  intentId: string;
  positionId: string;
  rootPositionId: string;
  generationIds: string[];
  accountId: string;
  strategistId: string;
  configurationEpochId: string;
  entryAt: string;
  entryPrice: number;
  quantity: number;
  eligible: boolean;
  censorCode: string | null;
  evidenceAt: string;
  receiptHashes: string[];
  settlementId: string | null;
  finalPnlUsd: number | null;
  finalDebitUsd: number | null;
  bookedToDateUsd: number;
  currentQuantity: number;
  currentBasis: number;
  currentStatus: string;
  currentRealizedPnl: number | null;
  currentClosedAt: string | null;
  firstExitRequestedAt: string | null;
}
export type FixedManagerComparisonIndex = Record<string, FixedManagerComparisonEvidence>;
export interface FixedManagerRunLike {
  position_id: string;
  status: string;
  account_id?: string | null;
  strategist_id?: string | null;
  configuration_epoch_id?: string | null;
  entry_at?: string;
  entry_price?: number | string;
  original_qty?: number | string;
  admitted_at?: string | null;
  admission_source?: string | null;
  evidence_state?: string | null;
  first_quote_at?: string | null;
  terminal_at?: string | null;
  terminal_return_pct?: number | string | null;
  terminal_pnl?: number | string | null;
  actual_realized_pnl?: number | string | null;
  peak_return_pct?: number | string | null;
  censor_code?: string | null;
  censored_at?: string | null;
}
const time = (v: unknown) => typeof v === "string" ? Date.parse(v) : NaN;
const numeric = (v: unknown) => typeof v === "number" || typeof v === "string" && v.trim() ? Number(v) : NaN;
/** A later independent ledger read cannot bless an earlier/missing physical
 * snapshot. Keep identity separately so failed congruence never becomes legacy.
 */
export function constrainFixedManagerEvidence(positions:readonly {id:string;entry_features?:unknown;qty?:unknown;
  avg_entry_price?:unknown;status?:unknown;realized_pnl?:unknown;closed_at?:unknown}[], evidence:FixedManagerComparisonIndex = {}) {
  const fixedPositionIds = new Set([...positions.filter(fixedEntryOwnershipPresent).map(r=>r.id),...Object.keys(evidence)]);
  const byId = new Map(positions.map(r=>[r.id,r]));
  const congruent:FixedManagerComparisonIndex = {};
  for (const [id,proof] of Object.entries(evidence)) {
    if (!proof.generationIds.length || !proof.generationIds.includes(id)) continue;
    const complete = proof.generationIds.every(generation=>{
      const row = byId.get(generation),p = evidence[generation];
      return row && fixedEntryOwnershipPresent(row) && p && p.intentId===proof.intentId
        && numeric(row.qty)===p.currentQuantity && numeric(row.avg_entry_price)===p.currentBasis
        && row.status===p.currentStatus
        && (row.realized_pnl==null && p.currentRealizedPnl===null || numeric(row.realized_pnl)===p.currentRealizedPnl)
        && (row.closed_at==null && p.currentClosedAt===null || time(row.closed_at)===time(p.currentClosedAt));
    });
    if (complete) congruent[id]=proof;
  }
  return {fixedPositionIds,evidence:congruent};
}
/** Derived logical-book rows only. Never persist this projection: physical
 * generation rows and their individually booked cash flows stay immutable. */
export function projectFixedLogicalPositionRows<T extends {id:string;entry_features?:unknown;qty?:unknown;
  avg_entry_price?:unknown;status?:unknown;realized_pnl?:unknown;closed_at?:unknown;runner_of?:string|null}>(
  positions:readonly T[],evidence:FixedManagerComparisonIndex):T[]{
  const constrained=constrainFixedManagerEvidence(positions,evidence);
  return positions.map(row=>{
    if(!constrained.fixedPositionIds.has(row.id))return row;
    const proof=constrained.evidence[row.id];
    if(!proof)throw new Error("fixed_logical_projection:complete_original_evidence_required");
    return {...row,runner_of:row.id===proof.rootPositionId?null:proof.rootPositionId,
      status:proof.settlementId?row.status:"open",
      closed_at:proof.settlementId?row.closed_at:null,
      realized_pnl:proof.settlementId?row.realized_pnl:null};
  });
}
export function fixedManagerComparisonCode(run: FixedManagerRunLike, proof: FixedManagerComparisonEvidence | undefined): string | null {
  if (!proof) return "fixed_comparison_evidence_unavailable";
  if (!proof.eligible) return proof.censorCode ?? "fixed_comparison_ineligible";
  if (run.account_id !== proof.accountId || run.strategist_id !== proof.strategistId
      || run.configuration_epoch_id !== proof.configurationEpochId
      || time(run.entry_at) !== time(proof.entryAt) || numeric(run.entry_price) !== proof.entryPrice
      || numeric(run.original_qty) !== proof.quantity) return "fixed_manager_original_cohort_mismatch";
  const delay = time(run.admitted_at) - time(proof.entryAt);
  if (!Number.isFinite(delay) || delay < 0 || delay > 30_000 || run.admission_source !== "recovery_open") {
    return "fixed_manager_admission_history_unavailable";
  }
  const quoteAt = time(run.first_quote_at);
  if (run.evidence_state !== "observing" || !Number.isFinite(quoteAt) || quoteAt < time(proof.entryAt)
      || quoteAt > time(run.admitted_at)+15_000
      || proof.firstExitRequestedAt !== null && quoteAt > time(proof.firstExitRequestedAt)) {
    return "fixed_manager_no_verified_preexit_quote_history";
  }
  return null;
}
export function applyFixedManagerComparison<T extends FixedManagerRunLike>(run: T, input: {
  fixedPositionIds: ReadonlySet<string>;
  evidence?: FixedManagerComparisonIndex;
}): T & { fixed_comparison?: FixedManagerComparisonEvidence | null; raw_fixed_manager_evidence?: T } {
  const proof = input.evidence?.[run.position_id];
  if (!proof && !input.fixedPositionIds.has(run.position_id)) return run;
  const code = fixedManagerComparisonCode(run, proof);
  return { ...run,
    fixed_comparison: proof ?? null, raw_fixed_manager_evidence: structuredClone(run),
    // Numeric pairs are consumed by some legacy metrics regardless of status.
    // Null both sides when ineligible; a status label alone does not exclude it.
    ...(code ? { status: "censored", terminal_at: null, terminal_return_pct: null, terminal_pnl: null,
      peak_return_pct: null, censor_code: code, censored_at: proof?.evidenceAt ?? null } : {}),
    actual_realized_pnl: code ? null : proof?.settlementId ? proof.finalPnlUsd : null,
  };
}
