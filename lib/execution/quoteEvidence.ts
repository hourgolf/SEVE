/** Evidence normalization only. Never authorizes a price trigger or an order. */
export function quoteEvidence(bid: unknown, ask: unknown, requirePositive = false) {
  const validNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const reason = bid == null || ask == null ? "missing_quote_side"
    : !validNumber(bid) || !validNumber(ask) ? "nonfinite_or_nonnumeric_quote"
    : bid < 0 || ask < 0 ? "negative_quote"
    : ask < bid ? "crossed_quote"
    : requirePositive && (bid === 0 || ask === 0) ? "zero_executable_quote" : null;
  // Preserve nonfinite values as labelled strings: JSON must not silently turn
  // NaN/Infinity into apparently missing source observations.
  const raw = (v: unknown): number | string | null => v == null ? null
    : typeof v === "number" ? Number.isFinite(v) ? v : String(v)
    : typeof v === "string" ? v : `invalid-type:${typeof v}`;
  return { valid: reason === null, reason, rawBid: raw(bid), rawAsk: raw(ask),
    bid: reason === null ? bid as number : null, ask: reason === null ? ask as number : null };
}
