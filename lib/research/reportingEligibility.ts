/** Shared gate for research recommendations. Publishing a bundle does not prove policy. */
export function policyEvidenceEligible(input: { opportunities: number; configurationEra: string } | undefined): boolean {
  return !!input && input.opportunities > 0 && !!input.configurationEra && !/unstamped|legacy|unverified|virtual-reference-policy/i.test(input.configurationEra);
}

/** A current publication date cannot make an old channel cohort fresh. */
export function decisionEvidenceFresh(observedThrough: string | null | undefined, reportThrough: string | null | undefined): boolean {
  if (!observedThrough || !reportThrough) return false;
  const age = Date.parse(reportThrough + 'T12:00:00Z') - Date.parse(observedThrough + 'T12:00:00Z');
  return Number.isFinite(age) && age >= 0 && age <= 14 * 86400_000;
}
