// ============================================================================
//  Engine core primitives (pure): features, paper-fill model, risk governor.
//  Shared by the backtest driver today and the live worker later.
// ============================================================================

import type { Bar, Features, FundState, Quote, StrategistConfig } from "./types";

const ATR_N = 14;
const OPEN_RANGE_MIN = 30;
const ER_N = 30; // efficiency-ratio window (minutes)
const VOL_N = 20; // relative-volume trailing window
const FEE_PER_CONTRACT = 0.65;
const SLIPPAGE = 0.25; // fraction of the spread paid on entry/exit

// Compute features from bars[0..i] (i = current bar index, 0 = session open).
export function computeFeatures(bars: Bar[], i: number): Features {
  const b = bars[i];
  let orHi: number | null = null;
  let orLo: number | null = null;
  if (i >= OPEN_RANGE_MIN - 1) {
    orHi = -Infinity;
    orLo = Infinity;
    for (let j = 0; j < OPEN_RANGE_MIN; j++) {
      orHi = Math.max(orHi, bars[j].high);
      orLo = Math.min(orLo, bars[j].low);
    }
  }
  let atrSum = 0;
  let atrCount = 0;
  for (let j = Math.max(0, i - ATR_N + 1); j <= i; j++) {
    atrSum += bars[j].high - bars[j].low;
    atrCount++;
  }
  const atr = atrCount ? atrSum / atrCount : 0;
  const mom = i >= 3 ? b.close - bars[i - 3].close : 0;

  // Kaufman efficiency ratio over the last ER_N bars: |net move| / path length.
  // ~1 = clean directional trend, ~0 = choppy/range-bound.
  let er = 0;
  const n = Math.min(ER_N, i);
  if (n > 0) {
    let path = 0;
    for (let j = i - n + 1; j <= i; j++) path += Math.abs(bars[j].close - bars[j - 1].close);
    er = path > 0 ? Math.abs(b.close - bars[i - n].close) / path : 0;
  }

  // relative volume: this bar vs the trailing-average bar (expansion > 1)
  let relVol = 1;
  if (i >= 1) {
    let vSum = 0;
    let vCount = 0;
    for (let j = Math.max(0, i - VOL_N); j < i; j++) {
      vSum += bars[j].volume;
      vCount++;
    }
    const avg = vCount ? vSum / vCount : 0;
    relVol = avg > 0 ? b.volume / avg : 1;
  }

  return {
    minute: i,
    // real minutes to the session's last bar (timestamp-based, so it's correct
    // across timeframes and tolerant of gaps; equals bars.length-1-i at 1m).
    minutesToClose: Math.max(0, Math.round((bars[bars.length - 1].ts - b.ts) / 60000)),
    close: b.close,
    vwap: b.vwap,
    openRangeHi: orHi,
    openRangeLo: orLo,
    atr,
    mom,
    er,
    relVol,
  };
}

// Paper fill: buying crosses to the ask, selling to the bid, each paying a
// fraction of the spread as slippage. Returns per-contract fill price.
export function fillPrice(side: "buy" | "sell", q: Quote): number {
  const spread = Math.max(0, q.ask - q.bid);
  return side === "buy"
    ? q.ask + SLIPPAGE * spread
    : Math.max(0, q.bid - SLIPPAGE * spread);
}

export const feePerContract = FEE_PER_CONTRACT;

export type RiskResult =
  | { ok: true; qty: number }
  | { ok: false; reason: string };

// Translate the mixer + fund limits into a position size, or a veto.
export function riskGovernor(
  cfg: StrategistConfig,
  fund: FundState,
  dayPnlStrategist: number,
  dayPnlFund: number,
  entryAsk: number,
  anySolo: boolean,
  // CONVICTION scalar (engine/sizing.ts): multiplies the risk budget so setup quality sizes the
  // position. Default 1.0 = flat RISK (byte-identical to before). Already clamped upstream
  // (scalarFor); guarded here so a non-finite/≤0 value can never zero or invert size.
  convictionScalar = 1,
): RiskResult {
  if (fund.is_halted) return { ok: false, reason: "fund_halted" };
  if (cfg.muted) return { ok: false, reason: "muted" };
  if (anySolo && !cfg.soloed) return { ok: false, reason: "not_soloed" };
  if (dayPnlFund <= -fund.master_daily_stop_usd)
    return { ok: false, reason: "master_daily_stop" };
  if (dayPnlStrategist <= -cfg.daily_stop_usd)
    return { ok: false, reason: "daily_stop" };

  const scalar = Number.isFinite(convictionScalar) && convictionScalar > 0 ? convictionScalar : 1;
  const effectiveCapital = fund.total_capital_usd * (cfg.capital_pct / 100);
  const riskBudget = effectiveCapital * (cfg.aggression / 100) * scalar;
  const costPerContract = entryAsk * 100;
  if (costPerContract <= 0) return { ok: false, reason: "no_quote" };
  let qty = Math.floor(riskBudget / costPerContract);
  qty = Math.max(0, Math.min(qty, cfg.max_contracts));
  if (qty === 0) return { ok: false, reason: "insufficient_capital" };
  return { ok: true, qty };
}
