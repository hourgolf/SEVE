// ============================================================================
//  Backtest driver — replays sessions through the SAME engine core + The Fade
//  the live worker will use, and prints an expectancy report.
//
//    npm run backtest                 # synthetic sessions (default, 60 days)
//    npm run backtest -- --days 120 --seed 3
//    npm run backtest -- --source real   # REAL backfilled SPY sessions
//
//  DATA HONESTY:
//   • synthetic → validates engine + strategy SHAPE end-to-end; NOT a real edge.
//   • real      → real SPY price paths (real opens/trends/ranges) with option
//                 chains priced synthetically on top (we have no historical
//                 option chains). "real bars + modeled options" — directionally
//                 meaningful for the underlying logic, but the option fills are
//                 modeled, so still not a final go/no-go number.
// ============================================================================

import { readFileSync } from "node:fs";
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
import { DEFAULT_FADE_PARAMS, fadeEvaluate } from "./strategies/fade";
import { DEFAULT_BREAKOUT_PARAMS, breakoutEvaluate } from "./strategies/breakout";
import { DEFAULT_POWER_PARAMS, powerEvaluate } from "./strategies/power";
import { DEFAULT_GRIND_PARAMS, grindEvaluate } from "./strategies/grind";
import { DEFAULT_STRADDLE_PARAMS, straddleEvaluate } from "./strategies/straddle";
import { makeCrossover } from "./strategies/crossover";
import { specToStrategyDef, specPremiumExit, type CompiledStrategy } from "./specEvaluate";
import type { StrategySpec } from "../lib/desk/strategySpec";
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
  management?: Management
): Trade[] {
  const trades: Trade[] = [];
  let pos: Position | null = null;
  let ms: ManagedState | null = null; // managed (smart) position
  let dayPnl = 0;
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
    if (pos && !pos.legs && premiumExit && (!intent || intent.kind !== "exit")) {
      const q = findQuote(chain, pos.strike, pos.optType);
      if (q) {
        if (premiumExit.profitPct != null && q.mid >= pos.entryPrice * (1 + premiumExit.profitPct / 100))
          intent = { kind: "exit", reason: "target_premium" };
        else if (premiumExit.stopPct != null && q.mid <= pos.entryPrice * (1 - premiumExit.stopPct / 100))
          intent = { kind: "exit", reason: "stop_premium" };
      }
    }

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
        riskUsd: 0.5 * pos.entryPrice * pos.qty * 100, // notional R = 50% of premium at risk
      });
      pos = null;
    } else if (!pos && intent && intent.kind === "enter") {
      if (intent.legs?.length) {
        // MULTI-LEG: resolve each leg's strike off ATM, price it (long→ask, short→bid),
        // size off the net debit. Skip if any leg is unquotable or the net isn't a debit.
        const atm = Math.round(f.close);
        const resolved: { strike: number; optType: OptType; side: "long" | "short"; ratio: number; px: number; edgeUsd: number }[] = [];
        let debit = 0, ok = true;
        for (const ls of intent.legs) {
          const lq = findQuote(chain, atm + ls.strikeOffset, ls.optType);
          if (!lq) { ok = false; break; }
          const fc = gross ? { fill: lq.mid, edgeUsd: 0 } : fillWithCost(ls.side === "long" ? "buy" : "sell", lq, costModel);
          resolved.push({ strike: atm + ls.strikeOffset, optType: ls.optType, side: ls.side, ratio: ls.ratio, px: fc.fill, edgeUsd: fc.edgeUsd });
          debit += (ls.side === "long" ? fc.fill : -fc.fill) * ls.ratio;
        }
        if (ok && debit > 0) {
          const r = riskGovernor(cfg, fund, dayPnl, dayPnl, debit, false); // size off net debit
          if (r.ok) {
            pos = {
              slug: cfg.slug, strike: atm, optType: "call", qty: r.qty,
              entryPrice: debit, entryMinute: i, entryUnderlying: f.close, peakFavorable: f.close,
              entryEdgeUsd: resolved.reduce((s, l) => s + l.edgeUsd * l.ratio * r.qty, 0),
              legs: resolved.map((l) => ({ strike: l.strike, optType: l.optType, side: l.side, qty: l.ratio * r.qty, entryPrice: l.px })),
            };
          }
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
              entryEdgeUsd: en.edgeUsd * r.qty,
            };
          }
        }
      }
    }
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
  const strat = argStr("strat", "fade");
  // --spec <path>: load a compiled StrategySpec (the .md → JSON form) and run it
  // through specToEvaluate — the SAME interpreter the live worker uses. This is
  // the real-fills confirmation the Add-Channel gate surfaces before Arm.
  const specPath = argStr("spec", "");
  let specDef: CompiledStrategy | null = null;
  let premiumExit: { profitPct?: number; stopPct?: number } | undefined;
  let management: Management | undefined;
  if (specPath) {
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as StrategySpec;
    specDef = specToStrategyDef(spec);
    premiumExit = specPremiumExit(spec);
    management = spec.management; // smart spec → the state machine owns exits
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
          : strat === "grind"
            ? (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS)
            : strat === "straddle"
              ? (f, pos) => straddleEvaluate(f, pos, DEFAULT_STRADDLE_PARAMS)
              : (f, pos) => fadeEvaluate(f, pos, DEFAULT_FADE_PARAMS);
  // Per-session evaluator: a spec needs the bars (ET clock + precomputed series),
  // built-ins need only the closes. One seam so both paths below stay identical.
  const evalFor = (bars: Bar[], levels?: { pdh?: number; pdl?: number }): Evaluate =>
    specDef ? specDef.build(bars, specDef.timeframeMin, levels) : makeEval(bars.map((b) => b.close));
  const gross = process.argv.includes("--gross");
  const costTag = gross ? " · GROSS (mid fills, no fees — signal only)" : "";
  const stratName = specDef
    ? `${specDef.name} (compiled spec)`
    : strat === "cross" ? "EMA Cross (9/21 + MACD + vol)"
    : strat === "breakout" ? "The Breakout"
    : strat === "power" ? "Power Hour"
    : strat === "grind" ? "The Grinder"
    : strat === "straddle" ? "Catalyst Straddle (multi-leg)"
    : "The Fade";
  const stratLabel = stratName + costTag;

  if (source === "real") {
    const sessions = await loadRealSessions();
    if (!sessions.length) {
      console.log("\nNo real sessions found — backfill underlying_bars first (07_backfill_bars.sql).\n");
      return;
    }
    // --options real → price from real option_bars (forward-filled, modeled spread);
    // otherwise model the chain with Black-Scholes off the day's realized IV.
    const useRealOptions = argStr("options", "synthetic") === "real";
    let byDay = new Map();
    if (useRealOptions) {
      try {
        byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET));
      } catch (e) {
        console.log(`  (option_bars unavailable — ${(e as Error).message}; falling back to modeled chains)`);
      }
    }
    let realDays = 0;

    const all: Trade[] = [];
    for (const s of sessions) {
      const contracts = byDay.get(s.dateET);
      let chainAt: ChainProvider;
      if (useRealOptions && contracts && contracts.length) {
        chainAt = makeRealChain(contracts);
        realDays++;
      } else {
        chainAt = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      }
      all.push(...simulateSession(s.bars, FADE, FUND, evalFor(s.bars, { pdh: s.pdh, pdl: s.pdl }), chainAt, gross, premiumExit, DEFAULT_COST_MODEL, management));
    }
    const optLabel = useRealOptions
      ? `REAL BARS + REAL option prices (modeled spread) · ${realDays}/${sessions.length} days had option data`
      : "REAL BARS + modeled (Black-Scholes) option chains";
    const span = `${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · real SPY 1-min`;
    report(all, sessions.length, stratLabel, optLabel, span);
  } else {
    const days = argNum("days", 60);
    const seed = argNum("seed", 1);
    const all: Trade[] = [];
    for (let d = 0; d < days; d++) {
      const s = generateSession(seed + d, BASE_MS + d * DAY_MS);
      const chainAt: ChainProvider = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
      all.push(...simulateSession(s.bars, FADE, FUND, evalFor(s.bars), chainAt, gross, premiumExit, DEFAULT_COST_MODEL, management));
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
