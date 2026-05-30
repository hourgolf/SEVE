// ============================================================================
//  Technical indicators — pure functions on number[] (portable, no React/DOM).
//  Shared by the dashboard chart AND the engine strategies, so the line you see
//  and the signal the bot trades come from the exact same math.
// ============================================================================

// Exponential moving average. Seeded with the first value; returns a series the
// same length as the input.
export function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values.length ? values[0] : 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// Simple moving average (trailing). out[i] = mean of the last `period` values.
export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(sum / Math.min(i + 1, period));
  }
  return out;
}

export interface Macd {
  macd: number[]; // fast EMA − slow EMA
  signal: number[]; // EMA of the macd line
  hist: number[]; // macd − signal
}

// MACD(fast, slow, signal). Classic 12/26/9 defaults.
export function macd(values: number[], fast = 12, slow = 26, signalP = 9): Macd {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const macdLine = values.map((_, i) => ef[i] - es[i]);
  const signal = ema(macdLine, signalP);
  const hist = macdLine.map((m, i) => m - signal[i]);
  return { macd: macdLine, signal, hist };
}

// +1 when a crosses above b at index i, −1 when it crosses below, else 0.
export function crossDir(a: number[], b: number[], i: number): -1 | 0 | 1 {
  if (i < 1) return 0;
  const prev = a[i - 1] - b[i - 1];
  const now = a[i] - b[i];
  if (prev <= 0 && now > 0) return 1;
  if (prev >= 0 && now < 0) return -1;
  return 0;
}
