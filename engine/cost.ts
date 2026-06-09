// ============================================================================
//  Cost model (Brief Part 2) — explicit, configurable transaction cost applied
//  on entry AND every (partial) exit. Replaces the engine's implicit
//  fillPrice()+fee with one model so the A/B is honest and `costDrag` is
//  measurable. Premium is per-share; ×100 = per-contract dollars.
//
//  Per side, a fill pays: half the spread (if crossing) + slippage, in premium;
//  plus a flat commission in $/contract. `edgeUsd` is the spread+slippage cost in
//  $/contract (the part baked into the fill price); commission is tracked
//  separately so we never double-count it.
// ============================================================================

import type { Quote } from "./types";

export const TICK = 0.01;

export interface CostModel {
  spreadSource: "option_bars" | "modeled"; // prefer real bid/ask when present
  modeledSpreadPct: number; // fallback spread = pct of premium (e.g. 0.03)
  modeledSpreadFloorUsd: number; // absolute premium floor (e.g. 0.03)
  slippageTicksPerSide: number; // ticks paid per side (e.g. 1)
  commissionPerContract: number; // $/contract per side (e.g. 0.65)
  crossSpread: boolean; // true = pay half-spread each side
  // Fraction of the half-spread actually paid per side (0..1). 1 = a marketable
  // order crossing the full spread (the pessimistic default — matches crossSpread:true);
  // 0 = a passive limit filled at mid (the optimistic, no-fill-risk bound); ~0.25–0.5
  // ≈ a scalper working the bid/ask for price improvement. Lets us bound how much a
  // channel's edge depends on EXECUTION quality vs the strategy itself. Defaults to
  // crossSpread (1 if true, 0 if false) when unset, so existing behaviour is unchanged.
  spreadCrossFrac?: number;
}

// Calibrated to ALPACA's real options economics (the desk's broker): $0
// commission + only small regulatory pass-throughs (OCC clearing ~$0.02, ORF
// ~$0.027, + SEC/TAF on sells) ≈ $0.03–0.05/contract per side — NOT a $0.65
// broker commission. The bid/ask SPREAD is the dominant cost; modeled at 3% here,
// real bid/ask when option_bars provides it. (Live, the worker uses the actual
// Alpaca fills, so spread+fees are real — this model only matters for backtests.)
export const DEFAULT_COST_MODEL: CostModel = {
  spreadSource: "modeled",
  modeledSpreadPct: 0.03,
  modeledSpreadFloorUsd: 0.03,
  slippageTicksPerSide: 1,
  commissionPerContract: 0.04, // Alpaca regulatory pass-through per side (not a commission)
  crossSpread: true,
};

// Effective spread (premium $) for a quote under the model. Real bid/ask when the
// model trusts the source and the quote has a usable spread; modeled otherwise.
export function effSpread(q: Quote, m: CostModel): number {
  if (m.spreadSource === "option_bars" && q.ask > q.bid && q.bid > 0) return q.ask - q.bid;
  const mid = q.mid > 0 ? q.mid : (q.ask + q.bid) / 2;
  return Math.max(m.modeledSpreadFloorUsd, mid * m.modeledSpreadPct);
}

// Fill price + the spread+slippage cost ($/contract) for one side. Commission is
// NOT included here (callers add it once per side) so P&L never double-counts it.
export function fillWithCost(
  side: "buy" | "sell",
  q: Quote,
  m: CostModel = DEFAULT_COST_MODEL
): { fill: number; edgeUsd: number } {
  const spread = effSpread(q, m);
  // Per-side spread cost = half-spread × the cross fraction. spreadCrossFrac wins
  // when set; else fall back to the binary crossSpread (1 if crossing, else 0).
  const frac = m.spreadCrossFrac ?? (m.crossSpread ? 1 : 0);
  const half = (spread / 2) * Math.max(0, Math.min(1, frac));
  const slip = m.slippageTicksPerSide * TICK;
  const edge = half + slip; // premium/share paid as cost this side
  const fill = side === "buy" ? q.mid + edge : Math.max(0, q.mid - edge);
  return { fill, edgeUsd: edge * 100 };
}

// Round-trip cost ($/contract): both sides' edge + both commissions. Used by the
// cost gate (Brief P7) and for reporting.
export function roundTripCostUsd(q: Quote, m: CostModel = DEFAULT_COST_MODEL): number {
  return (
    fillWithCost("buy", q, m).edgeUsd +
    fillWithCost("sell", q, m).edgeUsd +
    2 * m.commissionPerContract
  );
}
