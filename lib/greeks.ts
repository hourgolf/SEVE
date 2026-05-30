// ============================================================================
//  Black-Scholes greeks — the 0DTE fallback Alpaca can't provide.
//
//  Alpaca supplies real, broker-computed greeks for 1DTE and beyond, and those
//  ALWAYS take precedence (see useMarketData). But Alpaca suppresses greeks for
//  same-day (0DTE) expiries — its model divides by time-to-expiry, which → 0 at
//  the bell (confirmed on Alpaca's forum). Since 0DTE is the heart of this desk,
//  we model those deltas here from each contract's mid price, clearly labelled
//  as modeled in the UI. SPY options are American-style, but with negligible
//  dividend effect over 0–1 days the European BS delta is an excellent proxy.
// ============================================================================

const RISK_FREE_RATE = 0.045; // ~4.5%; effect is tiny at 0DTE
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MIN_T = 1 / (365 * 24 * 60); // 1-minute floor (years) to avoid div-by-zero
// Within ~6 min of expiry, time value vanishes and implied vol backed out of the
// mid explodes (and is meaningless). Suppress the IV reading there (deltas still
// compute fine). This also hides inflated IV from post-expiry/stale 0DTE quotes.
const IV_RELIABLE_MIN_T = 6 / (365 * 24 * 60);

export type OptType = "call" | "put";

export interface ModeledGreeks {
  delta: number;
  iv: number | null;
  gamma: number | null;
  theta: number | null; // per calendar day
  vega: number | null; // per 1 vol point (1%)
}

// --- normal distribution helpers -------------------------------------------
// erf via Abramowitz & Stegun 7.1.26 (max error ~1.5e-7).
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}
const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

function d1d2(S: number, K: number, T: number, r: number, sigma: number) {
  const vsqrt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / vsqrt;
  return [d1, d1 - vsqrt] as const;
}

function bsPrice(
  type: OptType,
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): number {
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const disc = Math.exp(-r * T);
  return type === "call"
    ? S * normCdf(d1) - K * disc * normCdf(d2)
    : K * disc * normCdf(-d2) - S * normCdf(-d1);
}

// Implied vol via bisection. Returns null when the price carries no time value
// (mid ≤ intrinsic — deep ITM/OTM or crossed quotes), where IV is indeterminate.
function impliedVol(
  type: OptType,
  price: number,
  S: number,
  K: number,
  T: number,
  r: number
): number | null {
  const disc = Math.exp(-r * T);
  const intrinsic =
    type === "call" ? Math.max(0, S - K * disc) : Math.max(0, K * disc - S);
  if (price <= intrinsic + 1e-6) return null;
  let lo = 1e-4;
  let hi = 5; // 500% vol — ample headroom for short-dated SPY
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice(type, S, K, T, r, mid);
    if (p > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}

// Full greeks from a known volatility.
function greeksFromSigma(
  type: OptType,
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number
): ModeledGreeks {
  const [d1, d2] = d1d2(S, K, T, r, sigma);
  const disc = Math.exp(-r * T);
  const nd1 = normPdf(d1);
  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = nd1 / (S * sigma * Math.sqrt(T));
  const vega = (S * nd1 * Math.sqrt(T)) / 100;
  const theta =
    (type === "call"
      ? -(S * nd1 * sigma) / (2 * Math.sqrt(T)) - r * K * disc * normCdf(d2)
      : -(S * nd1 * sigma) / (2 * Math.sqrt(T)) + r * K * disc * normCdf(-d2)) /
    365;
  return { delta, iv: sigma, gamma, theta, vega };
}

// Last-resort delta when no IV can be backed out at a strike: the value the
// option's delta collapses to at expiry (1/0 for calls, -1/0 for puts).
function moneynessGreeks(type: OptType, S: number, K: number): ModeledGreeks {
  const itm = type === "call" ? S >= K : S <= K;
  const delta = type === "call" ? (itm ? 1 : 0) : itm ? -1 : 0;
  return { delta, iv: null, gamma: null, theta: null, vega: null };
}

function yearsToExpiry(expiration: string, capturedAt: string): number {
  const T = (easternCloseMs(expiration) - Date.parse(capturedAt)) / YEAR_MS;
  return T > MIN_T ? T : MIN_T;
}

export interface ChainContract {
  key: string; // caller's row id, echoed back in the result map
  type: OptType;
  strike: number;
  mid: number | null;
}

/**
 * Model greeks for a whole expiration's chain. Per strike, implied vol is
 * solved from the OTM leg (pure time value → always solvable) and then applied
 * to BOTH legs, so calls and puts share one IV and their deltas differ by
 * exactly 1 — a smooth, arbitrage-consistent curve with no ITM snapping.
 *
 * Returns a map keyed by each contract's `key`. Real Alpaca greeks should be
 * preferred upstream; this only fills the 0DTE gap.
 */
export function modelChainGreeks(
  contracts: ChainContract[],
  spot: number,
  expiration: string,
  capturedAt: string
): Map<string, ModeledGreeks> {
  const out = new Map<string, ModeledGreeks>();
  if (!(spot > 0) || contracts.length === 0) return out;

  const T = yearsToExpiry(expiration, capturedAt);
  const r = RISK_FREE_RATE;

  const byStrike = new Map<number, { call?: ChainContract; put?: ChainContract }>();
  for (const c of contracts) {
    const legs = byStrike.get(c.strike) ?? {};
    if (c.type === "call") legs.call = c;
    else legs.put = c;
    byStrike.set(c.strike, legs);
  }

  for (const [strike, legs] of byStrike) {
    // The OTM leg carries pure time value, so IV backs out cleanly from it.
    const refType: OptType = strike >= spot ? "call" : "put";
    const ref = refType === "call" ? legs.call : legs.put;
    const alt = refType === "call" ? legs.put : legs.call;

    let sigma: number | null = null;
    if (ref?.mid && ref.mid > 0) {
      sigma = impliedVol(refType, ref.mid, spot, strike, T, r);
    }
    if (sigma == null && alt?.mid && alt.mid > 0) {
      const altType: OptType = refType === "call" ? "put" : "call";
      sigma = impliedVol(altType, alt.mid, spot, strike, T, r);
    }

    for (const leg of [legs.call, legs.put]) {
      if (!leg) continue;
      const g =
        sigma != null
          ? greeksFromSigma(leg.type, spot, strike, T, r, sigma)
          : moneynessGreeks(leg.type, spot, strike);
      // Drop the IV reading near/after expiry — it's not meaningful there.
      if (T <= IV_RELIABLE_MIN_T) g.iv = null;
      out.set(leg.key, g);
    }
  }

  return out;
}

// --- expiry instant ---------------------------------------------------------
// SPY options expire 16:00 America/New_York. Compute that instant in UTC,
// accounting for US Eastern DST (2nd Sunday March → 1st Sunday November).
function easternCloseMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const offset = easternOffsetHours(y, m, d); // 4 (EDT) or 5 (EST)
  return Date.UTC(y, m - 1, d, 16 + offset, 0, 0);
}

function easternOffsetHours(y: number, m: number, d: number): number {
  const dst = Date.UTC(y, m - 1, d);
  return dst >= nthSundayUTC(y, 3, 2) && dst < nthSundayUTC(y, 11, 1) ? 4 : 5;
}

// UTC midnight of the nth Sunday of the given month (month is 1-12).
function nthSundayUTC(y: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  const day = 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
  return Date.UTC(y, month - 1, day);
}
