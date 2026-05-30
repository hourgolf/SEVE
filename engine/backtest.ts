// ============================================================================
//  Backtest driver (Phase A) — replays synthetic sessions through the SAME
//  engine core + The Fade that the live worker will use, and prints an
//  expectancy report. Run: `npm run backtest -- --days 60 --seed 1`
//
//  DATA HONESTY: synthetic sessions validate the engine + strategy SHAPE and
//  the plumbing end-to-end. They are NOT a claim of real edge — that requires
//  captured/real option history (we have ~1 partial day so far). Treat the
//  expectancy below as a smoke-tested baseline, not a go/no-go number.
// ============================================================================

import { computeFeatures, feePerContract, fillPrice, riskGovernor } from "./engine";
import { generateSession, priceChain } from "./market";
import { fadeEvaluate } from "./strategies/fade";
import type { FundState, Position, Quote, StrategistConfig, Trade } from "./types";

const BASE_MS = 1_780_000_000_000; // fixed epoch base (deterministic stamps)
const DAY_MS = 24 * 60 * 60 * 1000;

// The Fade's seed config (from the schema seed) + the fund master strip.
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

function runSession(seed: number, dayStartMs: number, cfg: StrategistConfig, fund: FundState): Trade[] {
  const session = generateSession(seed, dayStartMs);
  const bars = session.bars;
  const trades: Trade[] = [];
  let pos: Position | null = null;
  let dayPnl = 0;

  for (let i = 0; i < bars.length; i++) {
    const f = computeFeatures(bars, i);
    const chain = priceChain(f.close, f.minutesToClose, session.ivAnnual);
    const intent = fadeEvaluate(f, pos);

    if (pos && intent && intent.kind === "exit") {
      const q = findQuote(chain, pos.strike, pos.optType);
      const exitPrice = q ? fillPrice("sell", q) : 0;
      const pnl = (exitPrice - pos.entryPrice) * pos.qty * 100 - feePerContract * pos.qty * 2;
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

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}

function main() {
  const days = arg("days", 60);
  const seed = arg("seed", 1);
  const all: Trade[] = [];
  for (let d = 0; d < days; d++) {
    all.push(...runSession(seed + d, BASE_MS + d * DAY_MS, FADE, FUND));
  }
  const m = metrics(all, days);
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);

  console.log("\n══════════════════════════════════════════════════");
  console.log("  SEVE backtest · The Fade · SYNTHETIC data");
  console.log("  (engine/strategy shape-test — not a real-edge claim)");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Sessions          ${m.nDays}`);
  console.log(`  Trades            ${m.nTrades}  (${(m.nTrades / m.nDays).toFixed(1)}/day)`);
  console.log(`  Win rate          ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`  Avg win           ${usd(m.avgWin)}`);
  console.log(`  Avg loss          ${usd(m.avgLoss)}`);
  console.log(`  Expectancy/trade  ${usd(m.expectancy)}`);
  console.log(`  Total P&L         ${usd(m.totalPnl)}`);
  console.log(`  Max drawdown      ${usd(m.maxDrawdown)}`);
  console.log(`  Exit reasons      ${JSON.stringify(m.byReason)}`);
  console.log("══════════════════════════════════════════════════\n");
}

main();
