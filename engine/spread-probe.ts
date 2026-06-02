// ============================================================================
//  spread-probe — does the FADE-as-credit-spread have a profitable strike/stop
//  config on REAL NBBO, or does the fade signal lack edge regardless of structure?
//  Sweeps (shortOffset × width × stopPct) for the credit-vertical fade and prints
//  an R-unit scorecard, REAL-NBBO days only (Databento cbbo-1m). Same entry gate
//  as smart-specs FADE_UP/FADE_DN; legs are the only thing that varies.
//
//    npm run spread-probe -- --days 95
//
//  Offsets up to ±6 are covered by the default Databento cache (day-range ±$6);
//  wider wings need `npm run backfill:databento -- --window 20 …` first.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { loadRealSessions } from "./realsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { Condition, StrategySpec } from "../lib/desk/strategySpec";
import type { FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "fs", capital_pct: 30, aggression: 40, max_contracts: 6, daily_stop_usd: 90, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

// Same fade entry gate as engine/smart-specs.ts (kept in sync) — only the legs vary.
const FADE_UP: Condition[] = [
  { kind: "opening_range", minutes: 30, side: "break_above" },
  { kind: "vwap_dev", atr: 1.5, cmp: ">" },
  { kind: "momentum_atr", op: "<=", value: 0.6 },
  { kind: "time_before", et: "15:25" },
];
const FADE_DN: Condition[] = [
  { kind: "opening_range", minutes: 30, side: "break_below" },
  { kind: "vwap_dev", atr: 1.5, cmp: "<" },
  { kind: "momentum_atr", op: ">=", value: -0.6 },
  { kind: "time_before", et: "15:25" },
];

function fadeSpreadSpec(shortOff: number, width: number, profitPct: number, stopPct: number): StrategySpec {
  return {
    meta: { strategyId: `fs_${shortOff}_${width}`, name: "fade-spread", instrument: "SPY", structure: "vertical-spread", dteRange: [0, 1], regime: "range", direction: "neutral" },
    entries: [
      { direction: "put", reason: "fade_up", all: FADE_UP, legs: [{ optType: "call", side: "short", strikeOffset: shortOff }, { optType: "call", side: "long", strikeOffset: shortOff + width }] },
      { direction: "call", reason: "fade_dn", all: FADE_DN, legs: [{ optType: "put", side: "short", strikeOffset: -shortOff }, { optType: "put", side: "long", strikeOffset: -(shortOff + width) }] },
    ],
    exits: [{ profitPct, stopPct, timeET: "15:00" }],
    sizing: {},
  };
}

function rMetrics(trades: Trade[]) {
  const byPos = new Map<string, { pnl: number; risk: number }>();
  for (const t of trades) { const k = String(t.entryTs); const g = byPos.get(k) ?? { pnl: 0, risk: 0 }; g.pnl += t.pnl; g.risk += t.riskUsd ?? 0; byPos.set(k, g); }
  const pos = [...byPos.values()];
  const n = pos.length;
  const Rof = (p: { pnl: number; risk: number }) => (p.risk > 0 ? p.pnl / p.risk : 0);
  const Rs = pos.map(Rof);
  const wins = pos.filter((p) => p.pnl > 0), losses = pos.filter((p) => p.pnl <= 0);
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of Rs) { eq += r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); }
  return {
    n, winRate: n ? wins.length / n : 0,
    expR: n ? Rs.reduce((a, r) => a + r, 0) / n : 0,
    avgWinR: wins.length ? wins.map(Rof).reduce((a, r) => a + r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.map(Rof).reduce((a, r) => a + r, 0) / losses.length : 0,
    maxDD, totalPnl: pos.reduce((a, p) => a + p.pnl, 0),
  };
}

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 95;
  const sessions = await loadRealSessions({ sinceDaysAgo });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET));
  const realSessions = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  console.log(`\n  spread-probe · ${realSessions.length} real-NBBO sessions (${realSessions[0]?.dateET} → ${realSessions[realSessions.length - 1]?.dateET}) · post-cost\n`);
  const f2 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  console.log(`  short  width  stop%   n   winRate   expR    avgWinR  avgLossR   maxDD     P&L`);
  console.log("  " + "─".repeat(72));

  const rows: { label: string; m: ReturnType<typeof rMetrics> }[] = [];
  for (const shortOff of [1, 2, 3]) {
    for (const width of [3, 5]) {
      for (const stopPct of [75, 100, 150]) {
        const spec = fadeSpreadSpec(shortOff, width, 50, stopPct);
        const def = specToStrategyDef(spec);
        const px = specPremiumExit(spec);
        const trades: Trade[] = [];
        for (const s of realSessions) {
          const chain = makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
          trades.push(...simulateSession(s.bars, CFG, FUND, def.build(s.bars, 1), chain, false, px, REAL_NBBO_COST, undefined));
        }
        const m = rMetrics(trades);
        rows.push({ label: `  ${String(shortOff).padStart(3)}  ${String(width).padStart(5)}  ${String(stopPct).padStart(5)}`, m });
        console.log(`${`  ${String(shortOff).padStart(3)}  ${String(width).padStart(5)}  ${String(stopPct).padStart(5)}`}  ${String(m.n).padStart(3)}   ${(m.winRate * 100).toFixed(1).padStart(5)}%   ${f2(m.expR).padStart(6)}   ${f2(m.avgWinR).padStart(6)}   ${f2(m.avgLossR).padStart(7)}   ${m.maxDD.toFixed(1).padStart(5)}   ${usd(m.totalPnl).padStart(7)}`);
      }
    }
  }
  const best = rows.slice().sort((a, b) => b.m.expR - a.m.expR)[0];
  console.log("\n  best expR:" + best.label + `  → expR ${f2(best.m.expR)}, P&L ${usd(best.m.totalPnl)}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
