// ============================================================================
//  Backtest driver — replays sessions through the SAME engine core + The Fade
//  the live worker will use, and prints an expectancy report.
//
//    npm run backtest                 # synthetic sessions (default, 60 days)
//    npm run backtest -- --days 120 --seed 3
//    npm run backtest -- --source real   # REAL backfilled SPY sessions
//    npm run backtest -- --source real --strat breakout-qqq   # QQQ (suffix infers
//                                         # ticker); or --strat breakout --underlying QQQ
//
//  DATA HONESTY:
//   • synthetic → validates engine + strategy SHAPE end-to-end; NOT a real edge.
//   • real      → real SPY price paths (real opens/trends/ranges) with option
//                 chains priced synthetically on top (we have no historical
//                 option chains). "real bars + modeled options" — directionally
//                 meaningful for the underlying logic, but the option fills are
//                 modeled, so still not a final go/no-go number.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { computeFeatures, riskGovernor } from "./engine";
import { DEFAULT_COST_MODEL, fillWithCost, type CostModel } from "./cost";
import { openManaged, stepManaged, costGatePass, type ManagedState } from "./manage";
import type { Management } from "../lib/desk/strategySpec";

// Zero-cost model for `--gross` runs (mid fills, no spread/slippage/fees).
const GROSS_COST: CostModel = { spreadSource: "modeled", modeledSpreadPct: 0, modeledSpreadFloorUsd: 0, slippageTicksPerSide: 0, commissionPerContract: 0, crossSpread: false };

// ET minute-of-day for a bar timestamp (theta-tighten / cost-gate use it).
const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
function etMinuteOfDay(ms: number): number {
  let h = 0, m = 0;
  for (const p of ET_HM.formatToParts(new Date(ms))) {
    if (p.type === "hour") h = Number(p.value);
    else if (p.type === "minute") m = Number(p.value);
  }
  return (h === 24 ? 0 : h) * 60 + m;
}
import { generateSession, priceChain } from "./market";
import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { DEFAULT_FADE_PARAMS, fadeEvaluate } from "./strategies/fade";
import { DEFAULT_FADE_V2_PARAMS, fadeV2Evaluate } from "./strategies/fade-v2";
import { DEFAULT_BREAKOUT_PARAMS, breakoutEvaluate } from "./strategies/breakout";
import { DEFAULT_POWER_PARAMS, DEFAULT_POWER_FINAL30, DEFAULT_POWER_FINAL35, DEFAULT_POWER_MOM30, DEFAULT_POWER_MOM35, DEFAULT_POWER_MOM60, powerEvaluate } from "./strategies/power";
import { DEFAULT_GRIND_PARAMS, grindEvaluate } from "./strategies/grind";
import { DEFAULT_GRIND_V2_PARAMS, DEFAULT_GRIND_V3_PARAMS, grindV2Evaluate } from "./strategies/grind-v2";
import { DEFAULT_STRADDLE_PARAMS, straddleEvaluate } from "./strategies/straddle";
import { makeCrossover } from "./strategies/crossover";
import { specToStrategyDef, specPremiumExit, type CompiledStrategy } from "./specEvaluate";
import type { StrategySpec } from "../lib/desk/strategySpec";
import { specTrail } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, OptType, Position, Quote, StrategistConfig, Trade } from "./types";

const BASE_MS = 1_780_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const FADE: StrategistConfig = {
  slug: "fade",
  capital_pct: 30,
  aggression: 40,
  max_contracts: 6,
  daily_stop_usd: 90,
  muted: false,
  soloed: false,
};
const FUND: FundState = {
  total_capital_usd: 10000,
  master_daily_stop_usd: 300,
  is_halted: false,
};

const findQuote = (chain: Quote[], strike: number, optType: "call" | "put") =>
  chain.find((q) => q.strike === strike && q.optType === optType);

// Defined max loss of a multi-leg structure, per ONE unit ($). Option expiry
// payoff is piecewise-linear with kinks only at strikes, so the worst case sits
// at a strike or an unbounded end — evaluate P&L at {0, each strike, far OTM} and
// take the worst. netPerUnit is the SIGNED net premium per unit (>0 debit paid,
// <0 credit received), per share. A truly undefined-risk structure (uncovered
// short) returns a huge loss → riskGovernor sizes it to 0 (defended; capability
// check's validateLegs already blocks naked shorts upstream).
export function structureMaxLossUsd(
  legs: { strike: number; optType: OptType; side: "long" | "short"; ratio: number }[],
  netPerUnit: number
): number {
  const strikes = legs.map((l) => l.strike);
  const probes = [0, ...strikes, Math.max(...strikes) * 2 + 10];
  let minPnl = Infinity;
  for (const S of probes) {
    let payoff = 0;
    for (const l of legs) {
      const intrinsic = l.optType === "call" ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      payoff += (l.side === "long" ? 1 : -1) * intrinsic * l.ratio;
    }
    minPnl = Math.min(minPnl, payoff - netPerUnit); // structure worth at expiry minus what you paid
  }
  return -minPnl * 100; // $ per unit (a loss is positive)
}

// One session through the engine. Pure: bars + day IV in, trades out. Shared by
// the synthetic and real paths — the ONLY thing that differs is the bar source.
export function simulateSession(
  bars: Bar[],
  cfg: StrategistConfig,
  fund: FundState,
  evaluate: Evaluate,
  chainAt: ChainProvider, // prices the chain at (spot, minutesToClose, tsMs)
  gross = false, // gross=true → fill at mid, no fees (signal-only P&L)
  // Premium-based exits (option mark vs entry fill) — used by spec-compiled
  // channels whose profit/stop are stated in % of premium, not underlying ATRs.
  // Undefined → built-in strategies behave exactly as before.
  premiumExit?: { profitPct?: number; stopPct?: number },
  // Transaction-cost model (Brief P2). Applied per fill; `gross` overrides to
  // mid fills with zero cost (signal-only). Default ≈ the engine's old implicit cost.
  costModel: CostModel = DEFAULT_COST_MODEL,
  // Smart-layer management block (Brief P4). When present, the position is run by
  // the tranched state machine (manage.ts) instead of the simple single-leg exit.
  management?: Management,
  // Standalone armable TRAIL (the armable subset of management), from entry — no
  // scale-out ladder. atrChandelierK: exit when the underlying retraces k·ATR from the
  // peak favorable price (ignores premium noise — the right trail for 0DTE momentum,
  // what breakout's code does). premiumGivebackPct: give back X% of peak premium gain.
  // Mirrors the live worker so backtest == live.
  trailExit?: { atrChandelierK?: number; premiumGivebackPct?: number; untilMin?: number },
  // BREAKEVEN-once-in-profit stop. Once the option has EVER traded up ≥ engagePct
  // above entry, the stop ratchets to entry (× 1+lockPct). It exits a position that
  // went green then gave it all back at ~breakeven instead of a full stop-out — but
  // does NOT cap a runner that never retraces (so the convex tail is untouched, the
  // way a profit-target / trail is NOT). Premium-mark based, single-leg only.
  breakevenExit?: { engagePct: number; lockPct?: number },
  // LATE-LEANS GATE (entry discipline, not exit). In the final `cutoffMin` minutes,
  // allow at most `maxEntries` NEW entries per session — a one-and-done (maxEntries 1)
  // / tighter re-entry cap that stops power over-trading the whipsawy close (the
  // 06-08 leak: after the peak it kept opening wrong-way leans). Counts only entries
  // OPENED inside the window; an entry opened earlier and still held is untouched.
  lateGate?: { cutoffMin: number; maxEntries: number }
): Trade[] {
  const trades: Trade[] = [];
  let pos: Position | null = null;
  let ms: ManagedState | null = null; // managed (smart) position
  let dayPnl = 0;
  let lateEntries = 0; // entries opened inside the late-leans gate window (this session)
  const cm = gross ? GROSS_COST : costModel;
  const etMin = management ? bars.map((b) => etMinuteOfDay(b.ts)) : [];

  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(bars, i);
    const chain = chainAt(f.close, f.minutesToClose, bars[i].ts);

    // ---- SMART managed path (Brief P4): the state machine owns exits ----
    if (management) {
      if (ms) {
        const q = findQuote(chain, ms.strike, ms.optType);
        if (q) {
          const r = stepManaged(ms, q, f.close, f.atr, etMin[i], f.minutesToClose, cm);
          for (const p of r.partials) {
            dayPnl += p.pnl;
            trades.push({
              slug: cfg.slug, strike: ms.strike, optType: ms.optType, qty: p.qty,
              entryPrice: ms.entryPremium, exitPrice: p.exitPremium,
              entryTs: bars[ms.entryMinute].ts, exitTs: bars[i].ts,
              pnl: p.pnl, exitReason: p.reason, cost: p.costUsd, riskUsd: p.riskUsd,
            });
          }
          if (r.closed) ms = null;
        }
      } else {
        const intent = evaluate(f, null);
        if (intent && intent.kind === "enter" && intent.direction) {
          const strike = Math.round(f.close);
          const q = findQuote(chain, strike, intent.direction);
          const gateOk = !management.costGate || gross || costGatePass(q!, f.atr, management.costGate.minMoveToCostRatio, costModel);
          if (q && gateOk) {
            const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false);
            if (r.ok) {
              const en = gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("buy", q, costModel);
              ms = openManaged(management, intent.direction, strike, r.qty, en.fill, f.close, i, f.atr, en.edgeUsd);
            }
          }
        }
      }
      continue;
    }

    // update trailing peak (best favorable underlying) before the strategy reads it
    // (single-leg only — a multi-leg structure is non-directional, no trail)
    if (pos && !pos.legs) {
      pos.peakFavorable =
        pos.optType === "call"
          ? Math.max(pos.peakFavorable, f.close)
          : Math.min(pos.peakFavorable, f.close);
    }
    let intent = evaluate(f, pos);

    // Premium profit/stop takes priority over the strategy's own exit when held.
    // (single-leg only — multi-leg exits are handled by the strategy itself.)
    if (pos && !pos.legs && (premiumExit || trailExit || breakevenExit) && (!intent || intent.kind !== "exit")) {
      const q = findQuote(chain, pos.strike, pos.optType);
      if (q) {
        // ratchet the peak option mid (the trail's / breakeven's high-water mark)
        pos.peakPremium = Math.max(pos.peakPremium ?? pos.entryPrice, q.mid);
        if (premiumExit?.profitPct != null && q.mid >= pos.entryPrice * (1 + premiumExit.profitPct / 100))
          intent = { kind: "exit", reason: "target_premium" };
        else if (premiumExit?.stopPct != null && q.mid <= pos.entryPrice * (1 - premiumExit.stopPct / 100))
          intent = { kind: "exit", reason: "stop_premium" };
        // TRAIL: once the position has been in profit, exit when the mid retraces
        // > givebackPct of the PEAK GAIN (giveback-of-gain, like manage.ts) — locks
        // in a fraction of profit at ANY size, not only on huge winners.
        // TRAIL (armable). Underlying ATR-chandelier FIRST (ignores premium noise —
        // the right trail for 0DTE momentum): once in profit, exit when price retraces
        // k·ATR from the peak favorable underlying. Else premium-giveback of peak gain.
        else if (trailExit?.atrChandelierK != null && f.atr > 0 && (trailExit.untilMin == null || f.minutesToClose > trailExit.untilMin)) {
          const inProfit = pos.optType === "call" ? f.close > pos.entryUnderlying : f.close < pos.entryUnderlying;
          const retraced = pos.optType === "call"
            ? f.close <= pos.peakFavorable - trailExit.atrChandelierK * f.atr
            : f.close >= pos.peakFavorable + trailExit.atrChandelierK * f.atr;
          if (inProfit && retraced) intent = { kind: "exit", reason: "trail_chandelier" };
        } else if (trailExit?.premiumGivebackPct != null && pos.peakPremium != null && pos.peakPremium > pos.entryPrice) {
          const givebackLevel = pos.entryPrice + (pos.peakPremium - pos.entryPrice) * (1 - trailExit.premiumGivebackPct / 100);
          if (q.mid <= givebackLevel) intent = { kind: "exit", reason: "trail_giveback" };
        }
        // BREAKEVEN-once-in-profit (checked AFTER the premium stop so a violent
        // gap-through still fills at the real worse mark, not a fictitious entry).
        // Arms once peakPremium reached entry×(1+engagePct); then exits at the first
        // bar the mark falls back to entry×(1+lockPct). Independent of premiumExit —
        // works on a built-in strat whose only other exits are its own ATR/EOD rules.
        if ((!intent || intent.kind !== "exit") && breakevenExit && pos.peakPremium != null
            && pos.peakPremium >= pos.entryPrice * (1 + breakevenExit.engagePct / 100)
            && q.mid <= pos.entryPrice * (1 + (breakevenExit.lockPct ?? 0) / 100)) {
          intent = { kind: "exit", reason: "breakeven_stop" };
        }
      }
    }

    // MULTI-LEG net-structure premium exit (mirror of the single-leg block, on the
    // net per-unit value). DEBIT (entryPrice ≥ 0): profit/stop vs entry like a long.
    // CREDIT (entryPrice < 0): profit = buy back for ≤ credit×(1−profit%); stop =
    // cost to close ≥ credit×(1+stop%) (e.g. profit 50 / stop 100 = "+50% of credit
    // / −2× credit"). Trigger off mid; the exit branch below fills with real cost.
    if (pos && pos.legs && premiumExit && (!intent || intent.kind !== "exit")) {
      let netClose = 0;
      let priced = true;
      for (const leg of pos.legs) {
        const lq = findQuote(chain, leg.strike, leg.optType);
        if (!lq) { priced = false; break; }
        netClose += (leg.side === "long" ? lq.mid : -lq.mid) * (leg.qty / pos.qty); // per-unit liquidation value
      }
      if (priced) {
        const entryNet = pos.entryPrice; // signed per-unit ( >0 debit · <0 credit )
        if (entryNet >= 0) {
          if (premiumExit.profitPct != null && netClose >= entryNet * (1 + premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
          else if (premiumExit.stopPct != null && netClose <= entryNet * (1 - premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
        } else {
          const credit = -entryNet; // premium received per unit
          const costToClose = -netClose; // what you'd pay to buy the structure back
          if (premiumExit.profitPct != null && costToClose <= credit * (1 - premiumExit.profitPct / 100)) intent = { kind: "exit", reason: "target_premium" };
          else if (premiumExit.stopPct != null && costToClose >= credit * (1 + premiumExit.stopPct / 100)) intent = { kind: "exit", reason: "stop_premium" };
        }
      }
    }

    // Late-leans gate: once maxEntries NEW entries have opened inside the final
    // cutoffMin this session, block further entries (the over-trading fix). wasFlat
    // lets us increment the counter only when a position is actually opened this bar.
    const wasFlat = !pos;
    const lateBlocked = !!lateGate && f.minutesToClose <= lateGate.cutoffMin && lateEntries >= lateGate.maxEntries;
    if (pos && intent && intent.kind === "exit") {
      let exitPrice: number, pnl: number, tradeCost: number;
      const comm = gross ? 0 : costModel.commissionPerContract;
      if (pos.legs) {
        // multi-leg: P&L is the sum of each leg (long = +(exit−entry), short =
        // +(entry−exit)); cost per leg, both sides. exitPrice = net unit credit.
        let net = 0, exitNet = 0, exitEdge = 0;
        for (const leg of pos.legs) {
          const lq = findQuote(chain, leg.strike, leg.optType);
          const ex = lq ? (gross ? { fill: lq.mid, edgeUsd: 0 } : fillWithCost(leg.side === "long" ? "sell" : "buy", lq, costModel)) : { fill: 0, edgeUsd: 0 };
          net += (leg.side === "long" ? ex.fill - leg.entryPrice : leg.entryPrice - ex.fill) * leg.qty * 100 - comm * leg.qty * 2;
          exitNet += (leg.side === "long" ? ex.fill : -ex.fill) * leg.qty;
          exitEdge += ex.edgeUsd * leg.qty + comm * leg.qty * 2;
        }
        pnl = net;
        exitPrice = pos.qty ? exitNet / pos.qty : 0;
        tradeCost = (pos.entryEdgeUsd ?? 0) + exitEdge;
      } else {
        const q = findQuote(chain, pos.strike, pos.optType);
        const ex = q ? (gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("sell", q, costModel)) : { fill: 0, edgeUsd: 0 };
        exitPrice = ex.fill;
        const commTotal = comm * pos.qty * 2;
        pnl = (exitPrice - pos.entryPrice) * pos.qty * 100 - commTotal;
        tradeCost = (pos.entryEdgeUsd ?? 0) + ex.edgeUsd * pos.qty + commTotal;
      }
      dayPnl += pnl;
      trades.push({
        slug: pos.slug,
        strike: pos.strike,
        optType: pos.optType,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        exitPrice,
        entryTs: bars[pos.entryMinute].ts,
        exitTs: bars[i].ts,
        pnl,
        exitReason: intent.reason,
        cost: tradeCost,
        // R: multi-leg = the structure's DEFINED max loss; single-leg = 50% of premium.
        riskUsd: pos.legs ? (pos.maxLossUsd ?? 0) * pos.qty : 0.5 * pos.entryPrice * pos.qty * 100,
      });
      pos = null;
    } else if (!pos && intent && intent.kind === "enter" && !lateBlocked) {
      if (intent.legs?.length) {
        // MULTI-LEG: resolve each leg's strike off ATM, price it (long→ask, short→bid),
        // and size off the structure's DEFINED MAX LOSS (so credit spreads — net
        // credit, not a debit — size correctly). Skip if any leg is unquotable or
        // the structure has no bounded risk. `net` is the signed per-unit premium
        // ( >0 debit paid · <0 credit received ).
        const atm = Math.round(f.close);
        const resolved: { strike: number; optType: OptType; side: "long" | "short"; ratio: number; px: number; edgeUsd: number }[] = [];
        let net = 0, ok = true;
        for (const ls of intent.legs) {
          const ratio = ls.ratio ?? 1;
          const lq = findQuote(chain, atm + ls.strikeOffset, ls.optType);
          if (!lq) { ok = false; break; }
          const fc = gross ? { fill: lq.mid, edgeUsd: 0 } : fillWithCost(ls.side === "long" ? "buy" : "sell", lq, costModel);
          resolved.push({ strike: atm + ls.strikeOffset, optType: ls.optType, side: ls.side, ratio, px: fc.fill, edgeUsd: fc.edgeUsd });
          net += (ls.side === "long" ? fc.fill : -fc.fill) * ratio;
        }
        const maxLossUsd = ok ? structureMaxLossUsd(resolved, net) : 0;
        // size off max loss (per-unit $) → riskGovernor's entryAsk proxy = maxLoss/100.
        const r = ok && maxLossUsd > 0 ? riskGovernor(cfg, fund, dayPnl, dayPnl, maxLossUsd / 100, false) : { ok: false as const, reason: "no_risk" };
        if (r.ok) {
          pos = {
            slug: cfg.slug, strike: atm, optType: "call", qty: r.qty,
            entryPrice: net, entryMinute: i, entryUnderlying: f.close, peakFavorable: f.close,
            entryEdgeUsd: resolved.reduce((s, l) => s + l.edgeUsd * l.ratio * r.qty, 0),
            legs: resolved.map((l) => ({ strike: l.strike, optType: l.optType, side: l.side, qty: l.ratio * r.qty, entryPrice: l.px })),
            structure: intent.structure && intent.structure !== "single-leg" ? intent.structure : "straddle",
            maxLossUsd,
          };
        }
      } else if (intent.direction) {
        const strike = Math.round(f.close);
        const q = findQuote(chain, strike, intent.direction);
        if (q) {
          const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false);
          if (r.ok) {
            const en = gross ? { fill: q.mid, edgeUsd: 0 } : fillWithCost("buy", q, costModel);
            pos = {
              slug: cfg.slug,
              strike,
              optType: intent.direction,
              qty: r.qty,
              entryPrice: en.fill,
              entryMinute: i,
              entryUnderlying: f.close,
              peakFavorable: f.close,
              peakPremium: en.fill, // seed the premium-giveback trail at the entry fill
              entryEdgeUsd: en.edgeUsd * r.qty,
            };
          }
        }
      }
    }
    if (wasFlat && pos && lateGate && f.minutesToClose <= lateGate.cutoffMin) lateEntries++;
  }
  return trades;
}

export interface Metrics {
  nTrades: number;
  nDays: number;
  totalPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdown: number;
  byReason: Record<string, number>;
  totalCost: number; // total transaction cost ($) across trades
  costDrag: number | null; // totalCost / gross P&L (P&L before cost); null if gross≈0
}

export function metrics(trades: Trade[], nDays: number): Metrics {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  const byReason: Record<string, number> = {};
  for (const t of trades) byReason[t.exitReason] = (byReason[t.exitReason] ?? 0) + 1;
  const totalCost = trades.reduce((a, t) => a + (t.cost ?? 0), 0);
  const grossPnl = total + totalCost; // P&L before cost
  return {
    nTrades: n,
    nDays,
    totalPnl: total,
    winRate: n ? wins.length / n : 0,
    avgWin: wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0,
    expectancy: n ? total / n : 0,
    maxDrawdown: maxDD,
    byReason,
    totalCost,
    costDrag: Math.abs(grossPnl) > 1e-6 ? totalCost / grossPnl : null,
  };
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);

function report(trades: Trade[], nDays: number, stratLabel: string, label: string, span?: string) {
  const m = metrics(trades, nDays);
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  SEVE backtest · ${stratLabel}`);
  console.log(`  ${label}`);
  if (span) console.log(`  ${span}`);
  console.log("══════════════════════════════════════════════════");
  console.log(`  Sessions          ${m.nDays}`);
  console.log(`  Trades            ${m.nTrades}  (${m.nDays ? (m.nTrades / m.nDays).toFixed(1) : "0"}/day)`);
  console.log(`  Win rate          ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Avg win           ${usd(m.avgWin)}`);
  console.log(`  Avg loss          ${usd(m.avgLoss)}`);
  console.log(`  Expectancy/trade  ${usd(m.expectancy)}`);
  console.log(`  Total P&L         ${usd(m.totalPnl)}  (net of cost)`);
  const grossPnl = m.totalPnl + m.totalCost;
  const dragNote = grossPnl > 1e-6
    ? `  ·  cost drag ${(m.costDrag! * 100).toFixed(1)}% of gross`
    : `  ·  gross P&L ${usd(grossPnl)} (≤0 before cost — no edge to drag)`;
  console.log(`  Total cost        ${usd(m.totalCost)}${dragNote}`);
  console.log(`  Max drawdown      ${usd(m.maxDrawdown)}`);
  console.log(`  Exit reasons      ${JSON.stringify(m.byReason)}`);
  console.log("══════════════════════════════════════════════════\n");
}

function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}
function argStr(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const source = argStr("source", "synthetic");
  const stratRaw = argStr("strat", "fade");
  // Multi-instrument (QQQ rollout): --strat may carry a ticker suffix mirroring the
  // live channels (breakout-qqq → ORB on QQQ). Strip it for the strategy lookup and,
  // when --underlying isn't given explicitly, infer the ticker from the suffix. So
  // `--strat breakout-qqq` alone backtests ORB on QQQ; --underlying overrides.
  const stratSuffix = /-(qqq|spy)$/i.exec(stratRaw)?.[1]?.toUpperCase();
  const strat = stratRaw.replace(/-(qqq|spy)$/i, "");
  const underlying = argStr("underlying", stratSuffix ?? "SPY").toUpperCase();
  // --spec <path>: load a compiled StrategySpec (the .md → JSON form) and run it
  // through specToEvaluate — the SAME interpreter the live worker uses. This is
  // the real-fills confirmation the Add-Channel gate surfaces before Arm.
  const specPath = argStr("spec", "");
  let specDef: CompiledStrategy | null = null;
  let premiumExit: { profitPct?: number; stopPct?: number } | undefined;
  let management: Management | undefined;
  let trailExit: { atrChandelierK?: number; premiumGivebackPct?: number; untilMin?: number } | undefined;
  if (specPath) {
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as StrategySpec;
    specDef = specToStrategyDef(spec);
    premiumExit = specPremiumExit(spec);
    // ARMABLE trail (the live unlock): route it through the SIMPLE exit path (the same
    // code the worker runs), NOT manage.ts's tranched state machine. The trail governs
    // the upside, so drop the fixed profit cap and keep the stop.
    const t = specTrail(spec.management);
    if (t) {
      trailExit = t;
      premiumExit = { stopPct: premiumExit.stopPct };
      management = undefined;
    } else {
      management = spec.management; // smart (tranched) spec → manage.ts owns exits
    }
  }
  // EMA Cross precomputes indicators over the session's closes, so its
  // evaluator is built per session; fade/breakout ignore the closes arg.
  const makeEval = (closes: number[]): Evaluate =>
    strat === "cross"
      ? makeCrossover(closes)
      : strat === "breakout"
        ? (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS)
        : strat === "power"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_PARAMS)
          : strat === "power-final35"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_FINAL35)
          : strat === "power-final30"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_FINAL30)
          : strat === "power-mom60"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM60)
          : strat === "power-mom35"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM35)
          : strat === "power-mom30"
          ? (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_MOM30)
          : strat === "grind"
            ? (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS)
            : strat === "grind-v2"
            ? (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V2_PARAMS)
            : strat === "grind-v3"
            ? (f, pos) => grindV2Evaluate(f, pos, DEFAULT_GRIND_V3_PARAMS)
            : strat === "fade-v2"
            ? (f, pos) => fadeV2Evaluate(f, pos, DEFAULT_FADE_V2_PARAMS)
            : strat === "straddle"
              ? (f, pos) => straddleEvaluate(f, pos, DEFAULT_STRADDLE_PARAMS)
              : (f, pos) => fadeEvaluate(f, pos, DEFAULT_FADE_PARAMS);
  // Per-session evaluator: a spec needs the bars (ET clock + precomputed series),
  // built-ins need only the closes. One seam so both paths below stay identical.
  const evalFor = (bars: Bar[], levels?: { pdh?: number; pdl?: number }): Evaluate =>
    specDef ? specDef.build(bars, specDef.timeframeMin, levels) : makeEval(bars.map((b) => b.close));
  // --trail <k>: layer an underlying ATR-chandelier trail (exit when price retraces
  // k·ATR from the peak favorable underlying, ONLY once in profit) onto ANY strat —
  // e.g. test a trailing exit on built-in `power` vs its ride-to-close default. The
  // strategy's own exits still take precedence; the trail only fires on a "hold" bar.
  const trailK = argNum("trail", 0);
  // --trail-until <min>: only apply the trail while minutesToClose > this — i.e. PROTECT
  // gains through the quiet early phase, then hand off to ride-to-close for the final
  // volume surge (a CLOCK-phased exit; the phase is deterministic, no regime detection).
  const trailUntil = argNum("trail-until", 0);
  if (trailK > 0) trailExit = { atrChandelierK: trailK, ...(trailUntil > 0 ? { untilMin: trailUntil } : {}) };
  // --breakeven <pct>: once the option is up ≥ pct% over entry, ratchet the stop to
  // entry — convert a green→red round-trip into ~breakeven WITHOUT capping the tail
  // (differs from --trail / a profit target, which cap the convex upside). Layers
  // onto ANY strat. --breakeven-lock <pct> locks at entry×(1+pct) instead of flat
  // entry (default 0 = true breakeven). Off when --breakeven is absent / ≤ 0.
  const breakevenPct = argNum("breakeven", 0);
  const breakevenLock = argNum("breakeven-lock", 0);
  const breakevenExit = breakevenPct > 0 ? { engagePct: breakevenPct, lockPct: breakevenLock } : undefined;
  // --late-cutoff <min> + --late-max <n>: LATE-LEANS GATE. In the final <min> minutes,
  // cap NEW entries at <n> per session (one-and-done = --late-max 1). Off when
  // --late-cutoff is absent / ≤ 0. Default max = 1 (the one-and-done the thesis names).
  const lateCutoff = argNum("late-cutoff", 0);
  const lateMax = argNum("late-max", 1);
  const lateGate = lateCutoff > 0 ? { cutoffMin: lateCutoff, maxEntries: Math.max(0, lateMax) } : undefined;
  const gross = process.argv.includes("--gross");
  const costTag = gross ? " · GROSS (mid fills, no fees — signal only)" : "";
  const stratName = specDef
    ? `${specDef.name} (compiled spec)`
    : strat === "cross" ? "EMA Cross (9/21 + MACD + vol)"
    : strat === "breakout" ? "The Breakout"
    : strat === "power" ? "Power Hour"
    : strat === "power-final35" ? "Power Hour (final 35m)"
    : strat === "power-final30" ? "Power Hour (final 30m)"
    : strat === "power-mom60" ? "Power Hour (momentum-only, 60m)"
    : strat === "power-mom35" ? "Power Hour (momentum-only, 35m)"
    : strat === "power-mom30" ? "Power Hour (momentum-only, 30m)"
    : strat === "grind" ? "The Grinder"
    : strat === "grind-v2" ? "The Grinder v2"
    : strat === "grind-v3" ? "The Grinder v3 (disciplined scalp)"
    : strat === "fade-v2" ? "The Fade v2 (VWAP reversion)"
    : strat === "straddle" ? "Catalyst Straddle (multi-leg)"
    : "The Fade";
  const stratLabel = stratName + costTag;

  if (source === "real") {
    // --days N scopes to the last N calendar days (e.g. the Databento-cached
    // window) so a real-options run isn't diluted by modeled-chain fallback days.
    const sinceDaysAgo = argNum("days", 0);
    let sessions = await loadRealSessions({ symbol: underlying, ...(sinceDaysAgo > 0 ? { sinceDaysAgo } : {}) });
    // --from / --to: pin a FIXED ET-date window (reproducible — unlike --days, which
    // anchors to Date.now() and so can clip the boundary session between runs). Use a
    // wide --days (≥ the window) to bound the fetch, then --from/--to for exact edges.
    const fromD = argStr("from", ""), toD = argStr("to", "");
    if (fromD) sessions = sessions.filter((s) => s.dateET >= fromD);
    if (toD) sessions = sessions.filter((s) => s.dateET <= toD);
    if (!sessions.length) {
      console.log(`\nNo real ${underlying} sessions found — backfill underlying_bars for ${underlying} first.\n`);
      return;
    }
    // --options databento → REAL NBBO from the local Databento cache (real bid/ask,
    // real spread crossed). --options real → option_bars trade prices + modeled 3%
    // spread. else → Black-Scholes modeled chains off the day's realized IV.
    const optMode = argStr("options", "synthetic");
    const useDatabento = optMode === "databento";
    const useRealOptions = optMode === "real";
    // Databento gives REAL bid/ask → cross the ACTUAL spread, not the 3% model.
    // --fill-cross <0..1>: fraction of the half-spread paid per side (1 = market order
    // crossing the full spread [default], 0 = passive limit at mid). Bounds how much a
    // channel's edge is execution-quality (a scalper working limits) vs strategy.
    const fillCross = process.argv.includes("--fill-cross") ? argNum("fill-cross", 1) : undefined;
    const cost: CostModel = {
      ...(useDatabento ? { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" } : DEFAULT_COST_MODEL),
      ...(fillCross != null ? { spreadCrossFrac: fillCross } : {}),
    };
    let byDay = new Map();
    if (useDatabento) byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), underlying);
    else if (useRealOptions) {
      try {
        byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET), underlying);
      } catch (e) {
        console.log(`  (option_bars unavailable — ${(e as Error).message}; falling back to modeled chains)`);
      }
    }
    let realDays = 0;

    const all: Trade[] = [];
    // Per-session P&L log (one row per trading day, incl. flat no-trade days) — the
    // input the Monte Carlo resampler bootstraps. Built here so the backtest stays the
    // single source of truth for trade generation (montecarlo.ts never re-simulates).
    const perDay: { date: string; pnl: number; trades: number }[] = [];
    for (const s of sessions) {
      const contracts = byDay.get(s.dateET);
      let chainAt: ChainProvider;
      if (useDatabento && contracts && contracts.length) {
        chainAt = makeDatabentoChain(contracts as Parameters<typeof makeDatabentoChain>[0]);
        realDays++;
      } else if (useRealOptions && contracts && contracts.length) {
        chainAt = makeRealChain(contracts);
        realDays++;
      } else {
        chainAt = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      }
      const dayTrades = simulateSession(s.bars, FADE, FUND, evalFor(s.bars, { pdh: s.pdh, pdl: s.pdl }), chainAt, gross, premiumExit, cost, management, trailExit, breakevenExit, lateGate);
      all.push(...dayTrades);
      perDay.push({ date: s.dateET, pnl: Math.round(dayTrades.reduce((a, t) => a + t.pnl, 0) * 100) / 100, trades: dayTrades.length });
    }
    const optLabel = useDatabento
      ? `REAL NBBO · Databento cbbo-1m (${realDays}/${sessions.length} days) + real spread`
      : useRealOptions
      ? `REAL BARS + REAL option prices (modeled spread) · ${realDays}/${sessions.length} days had option data`
      : "REAL BARS + modeled (Black-Scholes) option chains";
    const span = `${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · real ${underlying} 1-min`;
    report(all, sessions.length, stratLabel, optLabel, span);
    const emitPath = argStr("emit-trades", "");
    if (emitPath) {
      writeFileSync(emitPath, JSON.stringify({ strat: stratRaw, underlying, source, options: optMode, span, perDay }));
      console.log(`  ↳ emitted ${perDay.length}-session P&L log → ${emitPath}`);
    }
  } else {
    const days = argNum("days", 60);
    const seed = argNum("seed", 1);
    const all: Trade[] = [];
    for (let d = 0; d < days; d++) {
      const s = generateSession(seed + d, BASE_MS + d * DAY_MS);
      const chainAt: ChainProvider = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      all.push(...simulateSession(s.bars, FADE, FUND, evalFor(s.bars), chainAt, gross, premiumExit, DEFAULT_COST_MODEL, management, trailExit, breakevenExit, lateGate));
    }
    report(all, days, stratLabel, "SYNTHETIC data (shape-test — not a real-edge claim)");
  }
}

// Only run when invoked directly (not when sweep/regime modules import
// simulateSession from here — otherwise this main() fires as a side effect).
if (process.argv[1]?.endsWith("backtest.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
