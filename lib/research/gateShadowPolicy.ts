// Pure policy for which blocked entry decisions are safe to reconstruct after
// the session. These are research-only counterfactuals: none can authorize an
// order, configuration change, or promotion.

export const GATE_SHADOW_ALL_BLOCKS = [
  "cost_gate",
  "stale_chain",
  "not_armed",
  "halted",
  "day1_dark_lifecycle",
  "day1_premium_debit_cap",
  "day1_spy_same_clock_collision",
  "day1_family_open",
  "day1_reentry_disabled",
  "day1_same_occ_open",
  "day1_underlying_concurrency",
  "day1_global_concurrency",
] as const;

export type GateShadowBlockReason = typeof GATE_SHADOW_ALL_BLOCKS[number];

// These reasons can repeat every minute while the hypothetical position would
// still be open. Walk them sequentially so repeated signals do not masquerade
// as independent trades.
export const GATE_SHADOW_SEQUENTIAL_BLOCKS = new Set<GateShadowBlockReason>([
  "not_armed",
  "halted",
  "day1_dark_lifecycle",
  "day1_spy_same_clock_collision",
  "day1_family_open",
  "day1_reentry_disabled",
  "day1_same_occ_open",
  "day1_underlying_concurrency",
  "day1_global_concurrency",
]);

export function isGateShadowBlockReason(value: string): value is GateShadowBlockReason {
  return (GATE_SHADOW_ALL_BLOCKS as readonly string[]).includes(value);
}
