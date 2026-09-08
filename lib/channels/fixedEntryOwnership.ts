/** Presence, not successful parsing, decides which execution protocol owns a
 * position. Malformed fixed metadata must never fall back to legacy execution. */
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const has = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export function fixedEntryPolicyPresent(value: unknown): boolean {
  const policy = object(value);
  return !!policy && (policy.policyVersion === "receipt-bound-entry-policy-v3" || has(policy, "fixedContractAdmission"));
}
export function fixedEntryOwnershipPresent(row: { entry_features?: unknown }): boolean {
  const features = object(row.entry_features);
  return !!features && (has(features, "fixed_entry_coverage") || fixedEntryPolicyPresent(features.receipt_bound_entry_policy));
}
/** JSON (single-arrow) IS NULL excludes both valid and malformed present
 * markers, including JSON null. The policy version uses text comparison.
 * Apply these server predicates to each legacy economic UPDATE; a preliminary
 * SELECT alone cannot fence a concurrent fixed-protocol row change. */
export const LEGACY_POSITION_FIXED_ABSENT_FILTERS = [
  "entry_features->fixed_entry_coverage",
  "entry_features->receipt_bound_entry_policy->fixedContractAdmission",
] as const;
export const LEGACY_POSITION_POLICY_FILTER = "entry_features->receipt_bound_entry_policy->>policyVersion.is.null,entry_features->receipt_bound_entry_policy->>policyVersion.neq.receipt-bound-entry-policy-v3";
