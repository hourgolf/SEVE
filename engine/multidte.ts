// ============================================================================
//  Multi-DTE backtest driver (Brief: MULTI-LEG, Part 1) — runs a SEQUENCE of
//  sessions and HOLDS a >0DTE position across the EOD boundary, so the
//  straddle/vertical theses can be tested at their preferred 1–2DTE expiry
//  instead of being force-flattened every day at 0DTE.
//
//  "One engine, two drivers" is preserved: this reuses computeFeatures /
//  riskGovernor / fillWithCost / structureMaxLossUsd, and the SAME spec-compiled
//  Evaluate. It differs from simulateSession only in (a) carrying `pos` across
//  sessions, (b) resolving each leg to a CHOSEN expiry (entryDte sessions ahead),
//  (c) ignoring the strategy's intraday eod/time flatten while the contract is
//  pre-expiry (mirrors the live worker's overnight rule), and (d) force-flattening
//  on the contract's expiry day. The chain is DTE-aware (Quote.expiration).
//
//  Research-only (local Databento mdte cache); NOT mirrored in the worker.
// ============================================================================

import { computeFeatures, riskGovernor } from "./engine";
import { fillWithCost, type CostModel } from "./cost";
import { structureMaxLossUsd } from "./backtest";
import type { Evaluate, FundState, OptType, Position, Quote, StrategistConfig, Trade } from "./types";

export interface MdteSession { dateET: string; bars: { ts: number; open: number; high: number; low: number; close: number; volume: number; vwap: number }[]; pdh?: number; pdl?: number; }
export type MdteChainProvider = (tsMs: number) => Quote[]; // each Quote carries .expiration

const findLeg = (chain: Quote[], strike: number, optType: OptType, exp: string) =>
  chain.find((q) => q.strike === strike && q.optType === optType && q.expiration === exp);

// Per-unit net liquidation value of a held multi-leg position (long legs you'd
// sell → +mid, short legs you'd buy → −mid), using the per-unit ratio (leg.qty/qty).
function netCloseMid(pos: Position, chain: Quote[]): number | null {
  let v = 0;
  for (const leg of pos.legs ?? []) {
    const lq = findLeg(chain, leg.strike, leg.optType, pos.expiration!);
    if (!lq) return null;
    v += (leg.side === "long" ? lq.mid : -lq.mid) * (leg.qty / pos.qty);
  }
  return v;
}

export function simulateMultiDay(
  sessions: MdteSession[],
  cfg: StrategistConfig,
  fund: FundState,
  evalForSession: (bars: MdteSession["bars"], levels: { pdh?: number; pdl?: number }) => Evaluate,
  chainForSession: (s: MdteSession) => MdteChainProvider,
  costModel: CostModel,
  premiumExit: { profitPct?: number; stopPct?: number } | undefined,
  entryDte: number
): Trade[] {
  const trades: Trade[] = [];
  let pos: Position | null = null;
  let posOpenedSi = -1;
  const comm = costModel.commissionPerContract;

  for (let si = 0; si < sessions.length; si++) {
    const s = sessions[si];
    const bars = s.bars;
    const evaluate = evalForSession(bars, { pdh: s.pdh, pdl: s.pdl });
    const chainAt = chainForSession(s);
    // A position carried in from a prior session is, for THIS session's clock,
    // "opened at the open" (mirrors the worker reconstructing entryMinute=0).
    if (pos && posOpenedSi !== si) pos.entryMinute = 0;
    let dayPnl = 0;

    for (let i = 0; i < bars.length; i++) {
      const f = computeFeatures(bars as Parameters<typeof computeFeatures>[0], i);
      const chain = chainAt(bars[i].ts);

      if (pos) {
        if (!pos.legs) pos.peakFavorable = pos.optType === "call" ? Math.max(pos.peakFavorable, f.close) : Math.min(pos.peakFavorable, f.close);
        let intent = evaluate(f, pos);

        // ---- premium / net-structure exits (same convention as simulateSession) ----
        if (premiumExit && (!intent || intent.kind !== "exit")) {
          if (pos.legs) {
            const netClose = netCloseMid(pos, chain);
            if (netClose != null) {
              const entryNet = pos.entryPrice; // signed per-unit ( >0 debit · <0 credit )
              if (entryNet >= 0) {
                if (premiumExit.profitPct != null && netClose >= entryNet * (1 + premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
                else if (premiumExit.stopPct != null && netClose <= entryNet * (1 - premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
              } else {
                const credit = -entryNet, costToClose = -netClose;
                if (premiumExit.profitPct != null && costToClose <= credit * (1 - premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
                else if (premiumExit.stopPct != null && costToClose >= credit * (1 + premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
              }
            }
          } else {
            const q = findLeg(chain, pos.strike, pos.optType, pos.expiration!);
            if (q) {
              if (premiumExit.profitPct != null && q.mid >= pos.entryPrice * (1 + premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
              else if (premiumExit.stopPct != null && q.mid <= pos.entryPrice * (1 - premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
            }
          }
        }

        // ---- DTE-aware flatten rules ----
        // pre-expiry: ignore the strategy's intraday eod/3pm flatten (carry overnight).
        if (intent?.kind === "exit" && (intent.reason === "eod_flatten" || intent.reason === "time_exit") && pos.expiration! > s.dateET) intent = null;
        // expiry day: force-close into the last bar if nothing else exited.
        if ((!intent || intent.kind !== "exit") && pos.expiration! <= s.dateET && f.minutesToClose <= 1) intent = { kind: "exit", reason: "expiry_flatten" };

        if (intent?.kind === "exit") {
          let exitPrice: number, pnl: number, tradeCost: number;
          if (pos.legs) {
            let net = 0, exitNet = 0, exitEdge = 0;
            for (const leg of pos.legs) {
              const lq = findLeg(chain, leg.strike, leg.optType, pos.expiration!);
              const ex = lq ? fillWithCost(leg.side === "long" ? "sell" : "buy", lq, costModel) : { fill: 0, edgeUsd: 0 };
              net += (leg.side === "long" ? ex.fill - leg.entryPrice : leg.entryPrice - ex.fill) * leg.qty * 100 - comm * leg.qty * 2;
              exitNet += (leg.side === "long" ? ex.fill : -ex.fill) * leg.qty;
              exitEdge += ex.edgeUsd * leg.qty + comm * leg.qty * 2;
            }
            pnl = net; exitPrice = pos.qty ? exitNet / pos.qty : 0; tradeCost = (pos.entryEdgeUsd ?? 0) + exitEdge;
          } else {
            const q = findLeg(chain, pos.strike, pos.optType, pos.expiration!);
            const ex = q ? fillWithCost("sell", q, costModel) : { fill: 0, edgeUsd: 0 };
            exitPrice = ex.fill;
            const commTotal = comm * pos.qty * 2;
            pnl = (exitPrice - pos.entryPrice) * pos.qty * 100 - commTotal;
            tradeCost = (pos.entryEdgeUsd ?? 0) + ex.edgeUsd * pos.qty + commTotal;
          }
          dayPnl += pnl;
          trades.push({
            slug: cfg.slug, strike: pos.strike, optType: pos.optType, qty: pos.qty,
            entryPrice: pos.entryPrice, exitPrice, entryTs: pos.entryTs ?? bars[Math.min(pos.entryMinute, bars.length - 1)].ts, exitTs: bars[i].ts,
            pnl, exitReason: intent.reason, cost: tradeCost,
            riskUsd: pos.legs ? (pos.maxLossUsd ?? 0) * pos.qty : 0.5 * pos.entryPrice * pos.qty * 100,
          });
          pos = null; posOpenedSi = -1;
        }
      } else if (!pos) {
        const intent = evaluate(f, null);
        if (intent && intent.kind === "enter") {
          const targetExp = sessions[si + entryDte]?.dateET; // expiry N sessions ahead
          if (targetExp) {
            const atm = Math.round(f.close);
            if (intent.legs?.length) {
              const resolved: { strike: number; optType: OptType; side: "long" | "short"; ratio: number; px: number; edgeUsd: number }[] = [];
              let net = 0, ok = true;
              for (const ls of intent.legs) {
                const ratio = ls.ratio ?? 1;
                const lq = findLeg(chain, atm + ls.strikeOffset, ls.optType, targetExp);
                if (!lq) { ok = false; break; }
                const fc = fillWithCost(ls.side === "long" ? "buy" : "sell", lq, costModel);
                resolved.push({ strike: atm + ls.strikeOffset, optType: ls.optType, side: ls.side, ratio, px: fc.fill, edgeUsd: fc.edgeUsd });
                net += (ls.side === "long" ? fc.fill : -fc.fill) * ratio;
              }
              const maxLossUsd = ok ? structureMaxLossUsd(resolved, net) : 0;
              const r = ok && maxLossUsd > 0 ? riskGovernor(cfg, fund, dayPnl, dayPnl, maxLossUsd / 100, false) : { ok: false as const, reason: "no_risk" };
              if (r.ok) {
                pos = {
                  slug: cfg.slug, strike: atm, optType: "call", qty: r.qty, entryPrice: net,
                  entryMinute: i, entryTs: bars[i].ts, entryUnderlying: f.close, peakFavorable: f.close,
                  entryEdgeUsd: resolved.reduce((a, l) => a + l.edgeUsd * l.ratio * r.qty, 0),
                  legs: resolved.map((l) => ({ strike: l.strike, optType: l.optType, side: l.side, qty: l.ratio * r.qty, entryPrice: l.px })),
                  structure: intent.structure && intent.structure !== "single-leg" ? intent.structure : "straddle",
                  maxLossUsd, expiration: targetExp,
                };
                posOpenedSi = si;
              }
            } else if (intent.direction) {
              const q = findLeg(chain, atm, intent.direction, targetExp);
              if (q) {
                const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false);
                if (r.ok) {
                  const en = fillWithCost("buy", q, costModel);
                  pos = { slug: cfg.slug, strike: atm, optType: intent.direction, qty: r.qty, entryPrice: en.fill, entryMinute: i, entryTs: bars[i].ts, entryUnderlying: f.close, peakFavorable: f.close, entryEdgeUsd: en.edgeUsd * r.qty, structure: "single-leg", expiration: targetExp };
                  posOpenedSi = si;
                }
              }
            }
          }
        }
      }
    }
  }
  return trades;
}
