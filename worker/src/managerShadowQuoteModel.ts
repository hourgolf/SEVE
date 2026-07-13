// Pure provider-boundary model for Phase 1G-B targeted option snapshots.
// It intentionally owns no credentials, fetch, timer, database, or execution import.

export const TARGETED_OPTION_BATCH_SIZE = 100;
export const TARGETED_OPTION_HARD_CAP = 500;

export interface TargetedOptionQuote {
  occSymbol: string;
  bid: number;
  ask: number;
  quoteAtMs: number;
  feed: "opra" | "indicative";
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function targetedOptionBatches(
  symbols: readonly string[],
  batchSize = TARGETED_OPTION_BATCH_SIZE,
  hardCap = TARGETED_OPTION_HARD_CAP,
): string[][] | null {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > TARGETED_OPTION_BATCH_SIZE
      || !Number.isInteger(hardCap) || hardCap < 1) return null;
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  if (unique.length > hardCap) return null;
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += batchSize) out.push(unique.slice(i, i + batchSize));
  return out;
}

/** Normalize Alpaca's multi-contract snapshot body. The provider response time
 *  is deliberately ignored: latestQuote.t is the evidence timestamp. Invalid,
 *  zero, crossed, or timestamp-less quotes are omitted rather than repaired. */
export function normalizeTargetedOptionSnapshots(
  body: unknown,
  feed: "opra" | "indicative",
): Map<string, TargetedOptionQuote> {
  const out = new Map<string, TargetedOptionQuote>();
  if (!record(body) || !record(body.snapshots)) return out;
  for (const [rawSymbol, rawSnapshot] of Object.entries(body.snapshots)) {
    if (!record(rawSnapshot) || !record(rawSnapshot.latestQuote)) continue;
    const symbol = rawSymbol.trim().toUpperCase();
    const bid = Number(rawSnapshot.latestQuote.bp);
    const ask = Number(rawSnapshot.latestQuote.ap);
    const quoteAtMs = typeof rawSnapshot.latestQuote.t === "string"
      ? Date.parse(rawSnapshot.latestQuote.t)
      : NaN;
    if (!symbol || !(bid > 0) || !(ask >= bid) || !Number.isFinite(quoteAtMs)) continue;
    out.set(symbol, { occSymbol: symbol, bid, ask, quoteAtMs, feed });
  }
  return out;
}
