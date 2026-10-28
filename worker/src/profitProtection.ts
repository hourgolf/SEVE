import type { ReceiptBoundEntryPolicy } from "./receiptBoundEntryPolicy.js";

export interface ProfitProtectionState {
  profit_protection_armed_at?: string | null;
  profit_protection_exit_required_at?: string | null;
}
export type ProtectionTransition = "arm" | "exit" | null;

/** Only original, fresh, two-sided provider quotes with enough displayed bid
 * depth may create state. A peak statistic or broker mark cannot arm it. */
export function profitProtectionTransition(input: {
  policy: Readonly<ReceiptBoundEntryPolicy> | null;
  state: ProfitProtectionState; entry: number; remainingQty: number;
  bid: number; ask: number; bidSize: number; ageMs: number;
  providerClock: boolean; nativeExitReason?: string | null;
}): ProtectionTransition {
  if (!input.policy?.ratchetParameters.profitProtection
      || input.state.profit_protection_exit_required_at) return null;
  if (![input.entry, input.bid, input.ask, input.bidSize, input.ageMs].every(Number.isFinite)
      || input.entry <= 0 || input.bid <= 0 || input.ask < input.bid
      || !Number.isInteger(input.remainingQty) || input.remainingQty < 1
      || input.bidSize < input.remainingQty || input.ageMs < 0 || input.ageMs > 15_000
      || !input.providerClock) return null;
  if (input.nativeExitReason && input.nativeExitReason !== "target_premium") return null;
  const p = input.policy.ratchetParameters.profitProtection;
  if (!input.state.profit_protection_armed_at)
    return input.bid >= input.entry * (1 + p.armReturnPct / 100) ? "arm" : null;
  if (input.nativeExitReason) return null;
  return input.bid <= input.entry * (1 + p.floorReturnPct / 100) ? "exit" : null;
}

export function profitProtectionExitRequired(
  policy: Readonly<ReceiptBoundEntryPolicy> | null,
  state: ProfitProtectionState,
): boolean {
  return !!policy?.ratchetParameters.profitProtection
    && !!state.profit_protection_armed_at && !!state.profit_protection_exit_required_at;
}

/** Persistence must settle before acting. Updating the caller's row carries
 * the durable state through a same-sweep bank or partial-fill remainder. */
export async function observeProfitProtection(
  input: Parameters<typeof profitProtectionTransition>[0],
  persist: (transition: Exclude<ProtectionTransition, null>) => Promise<ProfitProtectionState | null>,
): Promise<ProtectionTransition> {
  const transition = profitProtectionTransition(input);
  if (!transition) return null;
  const saved = await persist(transition);
  if (!saved) return null;
  Object.assign(input.state, saved);
  return transition;
}
