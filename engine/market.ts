// ============================================================================
//  Market math + synthetic data for the backtest.
//  - Black-Scholes pricing (to build synthetic 0DTE chains)
//  - seeded RNG (reproducible sessions)
//  - generateSession(): a full 9:30–16:00 ET day of 1-min SPY bars, in a
//    "trend" or "range" regime, so The Fade is tested on both favorable and
//    adverse tapes.
//  Synthetic data is for validating engine + strategy SHAPE, never for claiming
//  real edge (labeled data_source = 'synthetic').
// ============================================================================

import type { Bar, OptType, Quote } from "./types";

const YEAR_MIN = 365 * 24 * 60;

function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return s * y;
}
const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

// Black-Scholes price. T in years. Falls back to intrinsic at/after expiry.
export function bsPrice(
  type: OptType,
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): number {
  if (T <= 0 || sigma <= 0) {
    return type === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const vsqrt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / vsqrt;
  const d2 = d1 - vsqrt;
  const disc = Math.exp(-r * T);
  return type === "call"
    ? S * normCdf(d1) - K * disc * normCdf(d2)
    : K * disc * normCdf(-d2) - S * normCdf(-d1);
}

// --- seeded RNG (mulberry32) ------------------------------------------------
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    // standard normal via Box-Muller
    randn: () => {
      const u = Math.max(1e-9, next());
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

export interface Session {
  bars: Bar[];
  ivAnnual: number;
  regime: "trend" | "range";
  dayStartMs: number;
}

const SESSION_MIN = 390; // 9:30–16:00 ET

// Build one synthetic session. `dayStartMs` is the 9:30 ET open for bar stamps.
export function generateSession(seed: number, dayStartMs: number): Session {
  const rng = makeRng(seed);
  const S0 = 740 + rng.next() * 40; // ~740–780
  const ivAnnual = 0.1 + rng.next() * 0.22; // 10%–32%
  const regime: "trend" | "range" = rng.next() < 0.55 ? "range" : "trend";
  const sigPerMin = (ivAnnual / Math.sqrt(YEAR_MIN)) * S0;

  // range days oscillate around a center; trend days drift one way.
  const center = S0;
  const kappa = 0.04 + rng.next() * 0.05; // mean-reversion strength
  const trendPerMin = (rng.next() < 0.5 ? -1 : 1) * sigPerMin * (0.25 + rng.next() * 0.4);
  // range days get a wider per-min shock so stretches actually form
  const shockMult = regime === "range" ? 1.7 : 1.0;

  const bars: Bar[] = [];
  let price = S0;
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < SESSION_MIN; i++) {
    const open = price;
    const drift =
      regime === "range" ? -kappa * (price - center) : trendPerMin;
    price = price + drift + rng.randn() * sigPerMin * shockMult;
    const close = price;
    const wig = Math.abs(rng.randn()) * sigPerMin * 0.6;
    const high = Math.max(open, close) + wig;
    const low = Math.min(open, close) - wig;
    const volume = Math.round(40000 * (0.6 + rng.next()));
    const typical = (high + low + close) / 3;
    cumPV += typical * volume;
    cumV += volume;
    bars.push({
      ts: dayStartMs + i * 60_000,
      open,
      high,
      low,
      close,
      volume,
      vwap: cumPV / cumV,
    });
  }
  return { bars, ivAnnual, regime, dayStartMs };
}

// Price a synthetic 0DTE chain around spot at a given minute. Strikes at $1
// increments within ±window of spot. Expiry = 16:00 ET (session end).
export function priceChain(
  spot: number,
  minutesToClose: number,
  ivAnnual: number,
  window = 8,
  r = 0.045
): Quote[] {
  const T = Math.max(0, minutesToClose) / YEAR_MIN;
  const lo = Math.floor(spot - window);
  const hi = Math.ceil(spot + window);
  const quotes: Quote[] = [];
  for (let K = lo; K <= hi; K++) {
    for (const optType of ["call", "put"] as OptType[]) {
      const fair = bsPrice(optType, spot, K, T, r, ivAnnual);
      const mid = Math.max(0.01, fair);
      // spread widens for cheap/illiquid wings
      const spread = Math.max(0.02, mid * 0.04);
      quotes.push({
        strike: K,
        optType,
        bid: Math.max(0, mid - spread / 2),
        ask: mid + spread / 2,
        mid,
      });
    }
  }
  return quotes;
}
