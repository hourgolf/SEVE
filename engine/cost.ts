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
}

// Calibrated to ≈ the engine's previous implicit cost (3% spread, ~quarter-spread
// slippage, $0.65 fee) so existing backtests don't lurch — but now explicit.
export const DEFAULT_COST_MODEL: CostModel = {
  spreadSource: "modeled",
  modeledSpreadPct: 0.03,
  modeledSpreadFloorUsd: 0.03,
  slippageTicksPerSide: 1,
  commissionPerContract: 0.65,
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
  const half = m.crossSpread ? spread / 2 : 0;
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
