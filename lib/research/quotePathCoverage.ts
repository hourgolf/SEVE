export type QuoteRow = { captured_at: string; bid: unknown; ask: unknown; provider_quote_at?: string | null; option_feed?: string | null };
/** Preserve original files. Only identical repeated IDs may be collapsed in
 * the derived audit; conflicting observations invalidate the input. */
export function deduplicateArchivedQuotes<T extends {id:string}>(rows: readonly T[]): {rows:T[]; duplicates:number} {
  const stable = (v:unknown):string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object" ? `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(",")}}` : JSON.stringify(v);
  const seen = new Map<string,T>(); let duplicates=0;
  for (const row of rows) {
    if (!row.id) throw Error("Missing archive row identity");
    const previous=seen.get(row.id);
    if (previous) { if(stable(previous)!==stable(row))throw Error("Conflicting duplicate archive row"); duplicates++; }
    else seen.set(row.id,row);
  }
  return {rows:[...seen.values()],duplicates};
}
export function quotePathCoverage(quotes: readonly QuoteRow[], start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const prices = quotes.filter(q => typeof q.bid === "number" && Number.isFinite(q.bid) && q.bid > 0
    && typeof q.ask === "number" && Number.isFinite(q.ask) && q.ask >= q.bid);
  const fresh = prices.filter(q => {
    const age = Date.parse(q.captured_at) - Date.parse(q.provider_quote_at ?? "");
    return q.option_feed === "opra" && Number.isFinite(age) && age >= 0 && age <= 15_000;
  });
  const inWindow = (q: QuoteRow) => Date.parse(q.captured_at) >= start && Date.parse(q.captured_at) <= end;
  const gap = (rows: readonly QuoteRow[]) => {
    const times = rows.map(q => Date.parse(q.captured_at)).filter(t => t >= start && t <= end).sort((a,b)=>a-b);
    if (!times.length) return null;
    let prev = start, max = 0;
    for (const t of times) { max = Math.max(max, t-prev); prev = t; }
    return Math.max(max, end-prev) / 1000;
  };
  const causal = (maxAge: number) => fresh.some(q => {
    const at = Date.parse(q.captured_at), provider = Date.parse(q.provider_quote_at ?? "");
    return at <= start && start-at <= maxAge && start-provider <= maxAge;
  });
  return {
    quoteRows: quotes.filter(inWindow).length,
    validPriceRows: prices.filter(inWindow).length,
    freshOpraRows: fresh.filter(inWindow).length,
    invalidPriceRows: quotes.filter(inWindow).length-prices.filter(inWindow).length,
    causalEntry15s: causal(15_000), causalEntry120s: causal(120_000),
    maxSampleGapSeconds: gap(prices), maxFreshGapSeconds: gap(fresh),
    // A boundary quote is required as well as bounded gaps. This remains
    // sampled coverage, never a claim of tick-complete executable replay.
    sampledCoverage120s: causal(120_000) && gap(fresh) != null && gap(fresh)! <= 120,
    sampledCoverage15s: causal(15_000) && gap(fresh) != null && gap(fresh)! <= 15,
  };
}
