// ============================================================================
//  EMA Cross sweep with OUT-OF-SAMPLE validation — the honest fine-tune.
//  Tunes on the in-sample window (Jan→Mar) and reports each config's
//  out-of-sample (Apr→May) result, which the tuner never saw. A config that's
//  profitable in BOTH is a robustness signal; great IS + poor OOS = overfit.
//  Loads real option chains ONCE and reuses across configs. Run: npm run sweep:cross
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { priceChain } from "./market";
import { aggregate } from "./aggregate";
import { simulateSession } from "./backtest";
import { makeCrossover, type CrossParams } from "./strategies/crossover";
import type { Bar, FundState, StrategistConfig, Trade } from "./types";

const OOS_CUTOFF = "2026-04-01"; // dates ≥ this are out-of-sample

const CFG: StrategistConfig = {
  slug: "cross", capital_pct: 30, aggression: 40, max_contracts: 6,
  daily_stop_usd: 90, muted: false, soloed: false,
};
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };

const GRID = {
  tf: [5, 15],
  emaFast: [9, 12, 15],
  emaSlow: [21, 26, 34],
  volMult: [1.0, 1.2],
  stopAtr: [1.0, 2.0],
  timeStop: [45, 90],
};

interface Stat { n: number; total: number; exp: number; win: number; maxDD: number }
interface Row { tf: number; p: CrossParams; is: Stat; oos: Stat }

function stat(trades: Trade[]): Stat {
  const n = trades.length;
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const wins = trades.filter((t) => t.pnl > 0).length;
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, total, exp: n ? total / n : 0, win: n ? wins / n : 0, maxDD: dd };
}

interface Sess { date: string; bars: Bar[]; chain: ChainProvider }

function runSet(set: Sess[], tf: number, p: CrossParams): Trade[] {
  const trades: Trade[] = [];
  for (const s of set) {
    const bars = aggregate(s.bars, tf);
    const evalFn = makeCrossover(bars.map((b) => b.close), p, tf);
    trades.push(...simulateSession(bars, CFG, FUND, evalFn, s.chain));
  }
  return trades;
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const pad = (s: string, w: number) => s.padStart(w);

function printTable(title: string, rows: Row[]) {
  console.log(`\n  ${title}`);
  console.log("   tf  fast slow  vol stopA tStop |  IS n  IS exp  IS tot | OOS n OOS exp OOS tot  OOS win");
  console.log("  ─────────────────────────────────────────────────────────────────────────────────────");
  for (const r of rows) {
    console.log(
      "  " +
        [pad(r.tf + "m", 4), pad(String(r.p.emaFast), 4), pad(String(r.p.emaSlow), 4),
         pad(r.p.volMult.toFixed(1), 4), pad(r.p.stopAtr.toFixed(1), 5), pad(String(r.p.timeStop), 5)].join(" ") +
        " |" +
        [pad(String(r.is.n), 5), pad(usd(r.is.exp), 7), pad(usd(r.is.total), 7)].join(" ") +
        " |" +
        [pad(String(r.oos.n), 5), pad(usd(r.oos.exp), 7), pad(usd(r.oos.total), 7), pad((r.oos.win * 100).toFixed(0) + "%", 6)].join(" ")
    );
  }
}

async function main() {
  const sessions = await loadRealSessions();
  console.log(`Loading real option chains for ${sessions.length} sessions…`);
  const byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET));

  const all: Sess[] = sessions.map((s) => {
    const c = byDay.get(s.dateET);
    const chain: ChainProvider = c && c.length ? makeRealChain(c) : (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
    return { date: s.dateET, bars: s.bars, chain };
  });
  const IS = all.filter((s) => s.date < OOS_CUTOFF);
  const OOS = all.filter((s) => s.date >= OOS_CUTOFF);
  console.log(`In-sample: ${IS.length} days (< ${OOS_CUTOFF})   Out-of-sample: ${OOS.length} days (≥ ${OOS_CUTOFF})`);

  const rows: Row[] = [];
  for (const tf of GRID.tf)
    for (const emaFast of GRID.emaFast)
      for (const emaSlow of GRID.emaSlow)
        for (const volMult of GRID.volMult)
          for (const stopAtr of GRID.stopAtr)
            for (const timeStop of GRID.timeStop) {
              if (emaFast >= emaSlow) continue;
              const p: CrossParams = { emaFast, emaSlow, volMult, useMacd: false, stopAtr, timeStop, flattenBeforeClose: 35 };
              rows.push({ tf, p, is: stat(runSet(IS, tf, p)), oos: stat(runSet(OOS, tf, p)) });
            }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  SEVE refined sweep · EMA Cross · ${rows.length} configs · IS-tuned, OOS-validated`);
  console.log("══════════════════════════════════════════════════════════════════");
  // rank by in-sample expectancy (what a tuner would pick), show the OOS truth
  printTable("TOP 14 by IN-SAMPLE expectancy (≥20 IS trades)",
    rows.filter((r) => r.is.n >= 20).sort((a, b) => b.is.exp - a.is.exp).slice(0, 14));
  const robust = rows.filter((r) => r.is.total > 0 && r.oos.total > 0 && r.oos.n >= 10);
  console.log(`\n  Robust (profitable IS AND OOS, ≥10 OOS trades): ${robust.length} / ${rows.length}`);
  printTable("BEST ROBUST configs by OOS expectancy",
    robust.sort((a, b) => b.oos.exp - a.oos.exp).slice(0, 10));
  console.log("══════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
