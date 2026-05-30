// ============================================================================
//  EMA Cross sweep over TIMEFRAME × parameters, on real bars + real option
//  prices. Loads the option data ONCE (the slow part) and reuses it across all
//  configs. Ranks by total P&L so we can see whether any config is profitable.
//  Run: `npm run sweep:cross`
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { priceChain } from "./market";
import { aggregate } from "./aggregate";
import { simulateSession } from "./backtest";
import { makeCrossover, type CrossParams } from "./strategies/crossover";
import type { FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = {
  slug: "cross", capital_pct: 30, aggression: 40, max_contracts: 6,
  daily_stop_usd: 90, muted: false, soloed: false,
};
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };

const GRID = {
  tf: [1, 5, 15],
  emaFast: [9, 12],
  emaSlow: [21, 34],
  volMult: [1.0, 1.2],
  useMacd: [true, false],
};
// fixed this pass
const STOP_ATR = 1.5;
const TIME_STOP = 60;
const FLATTEN = 35;

interface Row {
  tf: number; p: CrossParams; n: number; total: number; exp: number; win: number; maxDD: number;
}

function metric(tf: number, p: CrossParams, trades: Trade[]): Row {
  const n = trades.length;
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { tf, p, n, total, exp: n ? total / n : 0, win: n ? wins / n : 0, maxDD: dd };
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const pad = (s: string, w: number) => s.padStart(w);

function printTable(title: string, rows: Row[]) {
  console.log(`\n  ${title}`);
  console.log("   tf  fast  slow   vol  macd |   n   win%   exp/trd   total    maxDD");
  console.log("  ──────────────────────────────────────────────────────────────────");
  for (const r of rows) {
    console.log(
      "  " +
        [pad(r.tf + "m", 4), pad(String(r.p.emaFast), 4), pad(String(r.p.emaSlow), 5),
         pad(r.p.volMult.toFixed(1), 5), pad(r.p.useMacd ? "Y" : "n", 5)].join(" ") +
        " | " +
        [pad(String(r.n), 4), pad((r.win * 100).toFixed(0) + "%", 5),
         pad(usd(r.exp), 8), pad(usd(r.total), 8), pad(usd(r.maxDD), 8)].join("  ")
    );
  }
}

async function main() {
  const sessions = await loadRealSessions();
  console.log(`Loading real option chains for ${sessions.length} sessions…`);
  const byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET));

  // chain provider per session (real option prices, or BS fallback) — reused across configs
  const chainOf = new Map<string, ChainProvider>();
  let realDays = 0;
  for (const s of sessions) {
    const c = byDay.get(s.dateET);
    if (c && c.length) { chainOf.set(s.dateET, makeRealChain(c)); realDays++; }
    else chainOf.set(s.dateET, (spot, mtc) => priceChain(spot, mtc, s.ivAnnual));
  }
  console.log(`${realDays}/${sessions.length} days with real option data. Sweeping…`);

  const rows: Row[] = [];
  for (const tf of GRID.tf) {
    const agg = sessions.map((s) => ({ date: s.dateET, bars: aggregate(s.bars, tf) }));
    for (const emaFast of GRID.emaFast)
      for (const emaSlow of GRID.emaSlow)
        for (const volMult of GRID.volMult)
          for (const useMacd of GRID.useMacd) {
            const p: CrossParams = {
              emaFast, emaSlow, volMult, useMacd,
              stopAtr: STOP_ATR, timeStop: TIME_STOP, flattenBeforeClose: FLATTEN,
            };
            const trades: Trade[] = [];
            for (const a of agg) {
              const evalFn = makeCrossover(a.bars.map((b) => b.close), p, tf);
              trades.push(...simulateSession(a.bars, CFG, FUND, evalFn, chainOf.get(a.date)!));
            }
            rows.push(metric(tf, p, trades));
          }
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  SEVE sweep · EMA Cross · ${rows.length} configs × ${sessions.length} real sessions`);
  console.log(`  ${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · real bars + real option prices`);
  console.log("══════════════════════════════════════════════════════════════════");
  printTable("TOP 12 by total P&L", [...rows].sort((a, b) => b.total - a.total).slice(0, 12));
  printTable("TOP 8 by expectancy/trade (≥30 trades)",
    rows.filter((r) => r.n >= 30).sort((a, b) => b.exp - a.exp).slice(0, 8));
  console.log(`\n  Profitable configs: ${rows.filter((r) => r.total > 0).length} / ${rows.length}`);
  console.log("══════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
