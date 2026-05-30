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

import { computeFeatures, feePerContract, fillPrice, riskGovernor } from "./engine";
import { generateSession, priceChain } from "./market";
import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { DEFAULT_FADE_PARAMS, fadeEvaluate } from "./strategies/fade";
import { DEFAULT_BREAKOUT_PARAMS, breakoutEvaluate } from "./strategies/breakout";
import type { Bar, Evaluate, FundState, Position, Quote, StrategistConfig, Trade } from "./types";

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
  gross = false // gross=true → fill at mid, no fees (signal-only P&L)
): Trade[] {
  const trades: Trade[] = [];
  let pos: Position | null = null;
  let dayPnl = 0;

  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(bars, i);
    const chain = chainAt(f.close, f.minutesToClose, bars[i].ts);

    // update trailing peak (best favorable underlying) before the strategy reads it
    if (pos) {
      pos.peakFavorable =
        pos.optType === "call"
          ? Math.max(pos.peakFavorable, f.close)
          : Math.min(pos.peakFavorable, f.close);
    }
    const intent = evaluate(f, pos);

    if (pos && intent && intent.kind === "exit") {
      const q = findQuote(chain, pos.strike, pos.optType);
      const exitPrice = q ? (gross ? q.mid : fillPrice("sell", q)) : 0;
      const fee = gross ? 0 : feePerContract;
      const pnl = (exitPrice - pos.entryPrice) * pos.qty * 100 - fee * pos.qty * 2;
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
      });
      pos = null;
    } else if (!pos && intent && intent.kind === "enter") {
      const strike = Math.round(f.close);
      const q = findQuote(chain, strike, intent.direction);
      if (q) {
        const r = riskGovernor(cfg, fund, dayPnl, dayPnl, q.ask, false);
        if (r.ok) {
          pos = {
            slug: cfg.slug,
            strike,
            optType: intent.direction,
            qty: r.qty,
            entryPrice: fillPrice("buy", q),
            entryMinute: i,
            entryUnderlying: f.close,
            peakFavorable: f.close,
          };
        }
      }
    }
  }
  return trades;
}

interface Metrics {
  nTrades: number;
  nDays: number;
  totalPnl: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdown: number;
  byReason: Record<string, number>;
}

function metrics(trades: Trade[], nDays: number): Metrics {
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
  console.log(`  Total P&L         ${usd(m.totalPnl)}`);
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
  const evaluate: Evaluate =
    strat === "breakout"
      ? (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS)
      : (f, pos) => fadeEvaluate(f, pos, DEFAULT_FADE_PARAMS);
  const gross = process.argv.includes("--gross");
  const costTag = gross ? " · GROSS (mid fills, no fees — signal only)" : "";
  const stratLabel = (strat === "breakout" ? "The Breakout" : "The Fade") + costTag;

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
      all.push(...simulateSession(s.bars, FADE, FUND, evaluate, chainAt, gross));
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
      all.push(...simulateSession(s.bars, FADE, FUND, evaluate, chainAt, gross));
    }
    report(all, days, stratLabel, "SYNTHETIC data (shape-test — not a real-edge claim)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
