/** Pure executable-price validation; shared with the configured age ceiling. */
export const QUOTE_TRIGGER_MAX_AGE_MS = 120_000;
export function freshExecutableBid(bid: number | null | undefined, ageMs: number, maxAgeMs: number = QUOTE_TRIGGER_MAX_AGE_MS): number | null {
  if (!Number.isFinite(ageMs) || ageMs < 0 || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 || ageMs > maxAgeMs) return null;
  return typeof bid === "number" && Number.isFinite(bid) && bid > 0 ? bid : null;
}
