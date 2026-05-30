// ============================================================================
//  Engine core primitives (pure): features, paper-fill model, risk governor.
//  Shared by the backtest driver today and the live worker later.
// ============================================================================

import type { Bar, Features, FundState, Quote, StrategistConfig } from "./types";

const SESSION_MIN = 390;
const ATR_N = 14;
const OPEN_RANGE_MIN = 30;
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
  return {
    minute: i,
    minutesToClose: SESSION_MIN - 1 - i,
    close: b.close,
    vwap: b.vwap,
    openRangeHi: orHi,
    openRangeLo: orLo,
    atr,
    mom,
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
  anySolo: boolean
): RiskResult {
  if (fund.is_halted) return { ok: false, reason: "fund_halted" };
  if (cfg.muted) return { ok: false, reason: "muted" };
  if (anySolo && !cfg.soloed) return { ok: false, reason: "not_soloed" };
  if (dayPnlFund <= -fund.master_daily_stop_usd)
    return { ok: false, reason: "master_daily_stop" };
  if (dayPnlStrategist <= -cfg.daily_stop_usd)
    return { ok: false, reason: "daily_stop" };

  const effectiveCapital = fund.total_capital_usd * (cfg.capital_pct / 100);
  const riskBudget = effectiveCapital * (cfg.aggression / 100);
  const costPerContract = entryAsk * 100;
  if (costPerContract <= 0) return { ok: false, reason: "no_quote" };
  let qty = Math.floor(riskBudget / costPerContract);
  qty = Math.max(0, Math.min(qty, cfg.max_contracts));
  if (qty === 0) return { ok: false, reason: "insufficient_capital" };
  return { ok: true, qty };
}
