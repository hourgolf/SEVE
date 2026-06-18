// Pure selector: the day's market summary for the collapsed DESK ticker.
// Derives % change (vs prior session close), session VWAP, day range, and a
// downsampled sparkline from the loaded 1-min bars — no chart internals.

export interface BarLite {
  ts: string;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

export interface MarketSummary {
  dayChangePct: number | null;
  vwap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  spark: number[];
}

export function marketSummary(bars: BarLite[], spot: number | null): MarketSummary {
  const empty: MarketSummary = { dayChangePct: null, vwap: null, dayHigh: null, dayLow: null, spark: [] };
  if (!bars.length) return empty;
  const today = bars[bars.length - 1].ts.slice(0, 10);
  let priorClose: number | null = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].ts.slice(0, 10) < today) { priorClose = bars[i].close; break; }
  }
  const todayBars = bars.filter((b) => b.ts.slice(0, 10) === today);
  if (!todayBars.length) return empty;
  let hi = -Infinity, lo = Infinity, pv = 0, vol = 0;
  for (const b of todayBars) {
    const c = b.close ?? 0;
    const h = b.high ?? c, l = b.low ?? c, v = b.volume ?? 0;
    if (h > hi) hi = h;
    if (l < lo) lo = l;
    pv += ((h + l + c) / 3) * v;
    vol += v;
  }
  const closes = todayBars.map((b) => b.close ?? 0);
  const step = Math.max(1, Math.floor(closes.length / 28));
  const spark = closes.filter((_, i) => i % step === 0);
  return {
    dayChangePct: priorClose != null && spot != null ? ((spot - priorClose) / priorClose) * 100 : null,
    vwap: vol > 0 ? pv / vol : null,
    dayHigh: hi === -Infinity ? null : hi,
    dayLow: lo === Infinity ? null : lo,
    spark,
  };
}
