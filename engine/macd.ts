// MACD (12/26/9) — the standard trend-momentum oscillator, for the per-trade forensics dataset.
//
// Captured at ENTRY (worker stamp + the historical backfill use this SAME helper, so the column
// is consistent across all trades). NOT an input to any live entry gate — it's context for the
// "teach the edge / whiplash-avoidance" pattern analysis, read-only on the trade path.
//
//   macd  = EMA12(close) − EMA26(close)      (the convergence/divergence line)
//   signal = EMA9(macd)                      (the trigger)
//   hist  = macd − signal                    (momentum: rising = strengthening)
//
// Streaming-standard seeding (EMA starts at series[0], not an SMA warmup) — matches how an
// always-on indicator reads intraday, and avoids a NaN warmup window on short sessions.

export function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  let prev = values.length ? values[0] : 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// The MACD histogram for EVERY bar (O(n), one pass) — for streaming gates that read the series
// per bar, e.g. the re-entry-aware lever backtest. Index i = hist at bar i. <2 bars → all zeros.
export function macdHistSeries(closes: number[]): number[] {
  if (closes.length < 2) return closes.map(() => 0);
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const line = closes.map((_, i) => e12[i] - e26[i]);
  const sig = emaSeries(line, 9);
  return line.map((m, i) => m - sig[i]);
}

export interface Macd { macd: number; signal: number; hist: number; }

// MACD at the LAST element of `closes` (i.e. the entry bar — pass closes[0..entryIdx]).
// null on <2 bars (no momentum to read yet).
export function macdAt(closes: number[]): Macd | null {
  if (closes.length < 2) return null;
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => e12[i] - e26[i]);
  const signal = emaSeries(macdLine, 9);
  const i = closes.length - 1;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { macd: r3(macdLine[i]), signal: r3(signal[i]), hist: r3(macdLine[i] - signal[i]) };
}
