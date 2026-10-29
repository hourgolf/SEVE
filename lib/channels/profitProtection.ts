/** The first released overlay is deliberately one exact, versioned Momo policy.
 * It is additional to the bank/runner manager, not a replacement stop. */
export const MOMO_PROTECTED_MANAGER = "MOMO-B30-R50-K67-P15-F5" as const;
// Regression-checked against the complete manager payload and 15:25 cutoff.
export const MOMO_PROTECTED_MANAGER_VERSION = "sha256:5640524bed8cbb707efe8adca5312c56a04ef88d88751330d269f22c79869489" as const;
export const PROFIT_PROTECTION_COMPATIBILITY = "stream-profit-protection-v1" as const;
export interface ProfitProtectionPolicy {
  version: "profit-protection-v1";
  armReturnPct: 15;
  floorReturnPct: 5;
}
export function momoProfitProtection(): ProfitProtectionPolicy {
  return { version: "profit-protection-v1", armReturnPct: 15, floorReturnPct: 5 };
}
export function validProfitProtection(value: unknown): value is ProfitProtectionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Object.keys(p).length === 3 && p.version === "profit-protection-v1"
    && p.armReturnPct === 15 && p.floorReturnPct === 5;
}
export function profitProtectionScopeValid(spec: {
  slug: string; managerProfileId: string; quantity: number;
  takeProfit: { kind: string; targetPct: number | null; fraction: number };
  stopLoss: { catastrophePct: number; priceBasis: string };
  ratchetParameters: { kind: string; engageReturnPct: number | null;
    givebackPct: number | null; retainGainPct: number | null;
    fixedTargetPct: number | null; postBankFloor?: string; profitProtection?: unknown };
}): boolean {
  const r = spec.ratchetParameters;
  return spec.slug === "momo-shape-2" && spec.managerProfileId === MOMO_PROTECTED_MANAGER
    && spec.quantity === 2 && spec.takeProfit.kind === "bank"
    && spec.takeProfit.targetPct === 30 && spec.takeProfit.fraction === 0.5
    && spec.stopLoss.catastrophePct === 30 && spec.stopLoss.priceBasis === "executable-option-bid"
    && r.kind === "a13" && r.engageReturnPct === 50 && r.givebackPct === 33
    && r.retainGainPct === 67 && r.fixedTargetPct === null
    && r.postBankFloor === undefined && validProfitProtection(r.profitProtection);
}
