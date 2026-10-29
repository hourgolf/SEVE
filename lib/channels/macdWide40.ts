/** Exact approved target-only MACD policy; legacy +20/-50 remains readable. */
import { PROFIT_PROTECTION_COMPATIBILITY } from "./profitProtection";
export const MACD_WIDE40_MANAGER = "VB-MACD-WIDE40-50" as const;
export const MACD_WIDE40_MANAGER_VERSION = "sha256:458205da3c079e9690547d0de4ea1b9fe42d7d627fc51fa10075b3ac00fb1d1e" as const;
export const MACD_WIDE40_COMPATIBILITY = "stream-macd-wide40-v1" as const;
export function validFixedMacdManager(id: unknown, target: unknown, stop: unknown): boolean {
  return stop === 50 && ((id === "VB-MACD-WIDE20-50" && target === 20)
    || (id === MACD_WIDE40_MANAGER && target === 40));
}
export function managerManifestCompatibility(specs: readonly {
  managerProfileId: string; ratchetParameters: { profitProtection?: unknown };
}[], fallback: string): string {
  return specs.some(s => s.managerProfileId === MACD_WIDE40_MANAGER) ? MACD_WIDE40_COMPATIBILITY
    : specs.some(s => s.ratchetParameters.profitProtection) ? PROFIT_PROTECTION_COMPATIBILITY : fallback;
}
