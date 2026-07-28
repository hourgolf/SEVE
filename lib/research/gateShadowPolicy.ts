// Pure policy for which blocked entry decisions are safe to reconstruct after
// the session. Raw receipt strings remain immutable, but reconstruction is
// classified by stable semantics rather than a release prefix such as day1_ or
// rc54_. These are research-only counterfactuals: none can authorize an order,
// configuration change, or promotion.

export const GATE_SHADOW_BLOCK_SEMANTICS = [
  "cost_gate",
  "stale_chain",
  "not_armed",
  "halted",
  "dark_lifecycle",
  "premium_debit_cap",
  "same_clock_collision",
  "family_open",
  "reentry_disabled",
  "same_occ_open",
  "underlying_concurrency",
  "global_concurrency",
] as const;

export type GateShadowBlockSemantic = typeof GATE_SHADOW_BLOCK_SEMANTICS[number];
export type GateShadowTraversal = "every-opportunity" | "sequential";

const EVERY_OPPORTUNITY = new Set<GateShadowBlockSemantic>([
  "cost_gate",
  "stale_chain",
  "premium_debit_cap",
]);

const EXACT_UNPREFIXED = new Set<GateShadowBlockSemantic>([
  "cost_gate",
  "stale_chain",
  "not_armed",
  "halted",
]);

const LEGACY_DAY1_SEMANTICS = new Map<string, GateShadowBlockSemantic>([
  ["day1_dark_lifecycle", "dark_lifecycle"],
  ["day1_premium_debit_cap", "premium_debit_cap"],
  ["day1_spy_same_clock_collision", "same_clock_collision"],
  ["day1_family_open", "family_open"],
  ["day1_reentry_disabled", "reentry_disabled"],
  ["day1_same_occ_open", "same_occ_open"],
  ["day1_underlying_concurrency", "underlying_concurrency"],
  ["day1_global_concurrency", "global_concurrency"],
]);

const ADMISSION_DOMAIN_SEMANTICS = new Map<string, GateShadowBlockSemantic>([
  ["admission_domain_same_clock_collision", "same_clock_collision"],
  ["admission_domain_family_open", "family_open"],
  ["admission_domain_reentry_disabled", "reentry_disabled"],
  ["admission_domain_same_occ_open", "same_occ_open"],
  ["admission_domain_underlying_concurrency", "underlying_concurrency"],
  ["admission_domain_global_concurrency", "global_concurrency"],
]);

const RELEASE_SCOPED_SEMANTICS = new Set<GateShadowBlockSemantic>([
  "dark_lifecycle",
  "premium_debit_cap",
  "same_clock_collision",
  "family_open",
  "reentry_disabled",
  "same_occ_open",
  "underlying_concurrency",
  "global_concurrency",
]);

export function gateShadowBlockSemantic(value: string): GateShadowBlockSemantic | null {
  if (EXACT_UNPREFIXED.has(value as GateShadowBlockSemantic)) return value as GateShadowBlockSemantic;
  const legacy = LEGACY_DAY1_SEMANTICS.get(value);
  if (legacy) return legacy;
  const domain = ADMISSION_DOMAIN_SEMANTICS.get(value);
  if (domain) return domain;
  const releaseMatch = /^rc\d+_(.+)$/.exec(value);
  if (!releaseMatch) return null;
  const semantic = releaseMatch[1] as GateShadowBlockSemantic;
  return RELEASE_SCOPED_SEMANTICS.has(semantic) ? semantic : null;
}

export function gateShadowTraversal(value: string): GateShadowTraversal | null {
  const semantic = gateShadowBlockSemantic(value);
  if (!semantic) return null;
  return EVERY_OPPORTUNITY.has(semantic) ? "every-opportunity" : "sequential";
}

export function isGateShadowBlockReason(value: string): boolean {
  return gateShadowTraversal(value) != null;
}

export function isGateShadowSequentialBlockReason(value: string): boolean {
  return gateShadowTraversal(value) === "sequential";
}

// The exact candidate lane intentionally excludes premium-cap and broader
// occupancy suppressions. It freezes dark/re-entry/collision decisions only,
// while sharing the same release-agnostic raw-reason parser.
const DARK_CANDIDATE_SEMANTICS = new Set<GateShadowBlockSemantic>([
  "cost_gate",
  "stale_chain",
  "not_armed",
  "halted",
  "dark_lifecycle",
  "reentry_disabled",
  "same_clock_collision",
]);

export function isDarkCandidateResearchBlockReason(value: string): boolean {
  const semantic = gateShadowBlockSemantic(value);
  return semantic != null && DARK_CANDIDATE_SEMANTICS.has(semantic);
}
