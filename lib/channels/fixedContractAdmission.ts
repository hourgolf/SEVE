/** Versioned admission intent. Legacy numeric budgets remain historical storage
 * fields; this policy explicitly makes them non-authoritative for new entries. */
export const FIXED_CONTRACT_ADMISSION_MODE = "fixed-contracts-broker-affordability-v1" as const;
export const LEGACY_RC54_WORKER_COMPATIBILITY = "stream-2026-07-27a" as const;
export const FIXED_CONTRACT_WORKER_COMPATIBILITY = "stream-fixed-contract-affordability-v1" as const;
export interface FixedContractAdmissionPolicy {
  mode: typeof FIXED_CONTRACT_ADMISSION_MODE;
  quantity: 4;
  premiumCap: null;
  aggregateDebitCap: null;
  nominalRiskBudgetUsd: null;
  affordability: "fresh-broker-options-buying-power";
}
export function fixedContractAdmissionPolicy(): FixedContractAdmissionPolicy {
  return { mode: FIXED_CONTRACT_ADMISSION_MODE, quantity: 4, premiumCap: null,
    aggregateDebitCap: null, nominalRiskBudgetUsd: null,
    affordability: "fresh-broker-options-buying-power" };
}
export function isFixedContractAdmissionPolicy(value: unknown): value is FixedContractAdmissionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.mode === FIXED_CONTRACT_ADMISSION_MODE && row.quantity === 4
    && row.premiumCap === null && row.aggregateDebitCap === null
    && row.nominalRiskBudgetUsd === null
    && row.affordability === "fresh-broker-options-buying-power"
    && Object.keys(row).length === 6;
}
export function fixedContractScopeValid(spec: {
  slug: string; quantity: number; symbolScope: string[]; managerProfileId: string;
  accountId: string; accountRole: string; cohort: string; priority: number; collisionDomain: string;
  riskLimits: { maxContracts: number };
  ratchetParameters: { kind: string }; exitParameters: Record<string, unknown>;
  entryParameters: Record<string, unknown>; reentryPolicy: string;
  scalePolicy: { adds: number; pyramiding: string };
  takeProfit: { kind: string; targetPct: number | null; fraction: number };
  stopLoss: { catastrophePct: number; priceBasis: string };
}): boolean {
  return spec.slug === "vb-macd-state" && spec.quantity === 4
    && spec.accountId === "56daa293-e6bc-447d-83ac-2bfafb4d0ac1"
    && spec.accountRole === "LAB" && spec.cohort === "lab" && spec.priority === 1
    && spec.collisionDomain === "rc54-lab" && spec.riskLimits.maxContracts === 4
    && spec.ratchetParameters.kind === "none" && spec.exitParameters.eodEt === "15:25"
    && Number(spec.exitParameters.underlyingStopPct ?? 0) === 0
    && Number(spec.exitParameters.stallMinutes ?? 0) === 0
    && Number(spec.exitParameters.stallMaxFavorablePct ?? 0) === 0
    && spec.symbolScope.length === 1 && spec.symbolScope[0] === "SPY"
    && spec.managerProfileId === "VB-MACD-WIDE20-50"
    && spec.entryParameters.entryDte === 0 && spec.entryParameters.strikeOffset === 0
    && (spec.entryParameters.eventPolicy ?? "standdown") === "standdown"
    && (spec.entryParameters.maxEntriesPerSession ?? 1) === 1
    && Number(spec.entryParameters.dailyStopUsd ?? 0) === 0
    && Number(spec.entryParameters.dailyTargetUsd ?? 0) === 0
    && Number(spec.entryParameters.gapMinPct ?? 0) === 0
    && Number(spec.entryParameters.pyramidAdds ?? 0) === 0
    && spec.reentryPolicy === "disabled" && spec.scalePolicy.adds === 0
    && spec.scalePolicy.pyramiding === "disabled"
    && spec.takeProfit.kind === "bank" && spec.takeProfit.targetPct === 20
    && spec.takeProfit.fraction === 0 && spec.stopLoss.catastrophePct === 50
    && spec.stopLoss.priceBasis === "executable-option-bid";
}

/** v1 executable-shadow storage requires finite channel budgets. Do not silently
 * score a newer capless policy under those retired budgets or invent infinity. */
export function assertLegacyExecutableShadowBudget(spec: { slug?: string; entryParameters?: Record<string, unknown> }, context: string): void {
  if (spec.entryParameters?.admissionSizingMode !== undefined) {
    throw new Error(`${context}: ${spec.slug ?? "channel"} uses a versioned fixed-contract policy. Executable-shadow v1 cannot represent its absent channel dollar limits or prove historical broker capacity; use a frozen legacy configuration for v1 comparisons.`);
  }
}
