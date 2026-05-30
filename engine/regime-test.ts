// ============================================================================
//  Regime test — does the 15m EMA-cross hold across regimes, and does a TREND
//  FILTER (efficiency-ratio gate) fix the choppy losing quarters? Runs the
//  locked default per quarter over all history with REAL option fills, at
//  several erMin gate thresholds, so we can see if higher gates flatten the bad
//  quarters without killing the good ones. Loads option chains ONCE.
//  Run: npm run regime
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { priceChain } from "./market";
import { aggregate } from "./aggregate";
import { simulateSession } from "./backtest";
import { makeCrossover, DEFAULT_CROSS_PARAMS } from "./strategies/crossover";
import type { Bar, FundState, StrategistConfig } from "./types";

const TF = 15;
const ER_VALUES = [0, 0.2, 0.3, 0.4]; // regime-gate thresholds to compare
const CFG: StrategistConfig = {
  slug: "cross", capital_pct: 30, aggression: 40, max_contracts: 6,
  daily_stop_usd: 90, muted: false, soloed: false,
};
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };

const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const padL = (s: string, w: number) => s.padStart(w);
const padR = (s: string, w: number) => s.padEnd(w);

interface Cell { n: number; total: number }

async function main() {
  const sessions = await loadRealSessions();
  const byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET));
  let realDays = 0;
  const prepped = sessions.map((s) => {
    const bars = aggregate(s.bars, TF);
    const c = byDay.get(s.dateET);
    let chain: ChainProvider;
    if (c && c.length) { chain = makeRealChain(c); realDays++; }
    else chain = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
    return { q: quarterOf(s.dateET), closes: bars.map((b: Bar) => b.close), bars, chain };
  });
  console.log(`(${realDays}/${sessions.length} days real option prices · ${TF}m · EMA ${DEFAULT_CROSS_PARAMS.emaFast}/${DEFAULT_CROSS_PARAMS.emaSlow})`);

  // results[er] -> Map<quarter, Cell>
  const results = new Map<number, Map<string, Cell>>();
  for (const er of ER_VALUES) {
    const params = { ...DEFAULT_CROSS_PARAMS, erMin: er };
    const byQ = new Map<string, Cell>();
    for (const p of prepped) {
      const evalFn = makeCrossover(p.closes, params, TF);
      const trades = simulateSession(p.bars, CFG, FUND, evalFn, p.chain);
      const cell = byQ.get(p.q) ?? byQ.set(p.q, { n: 0, total: 0 }).get(p.q)!;
      for (const t of trades) { cell.n++; cell.total += t.pnl; }
    }
    results.set(er, byQ);
  }

  const quarters = [...new Set(prepped.map((p) => p.q))].sort();
  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log("  EMA Cross 15m · trend-filter (erMin) comparison · total P&L per quarter");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  quarter   " + ER_VALUES.map((e) => padL(`er≥${e.toFixed(2)}`, 11)).join(""));
  console.log("  ────────────────────────────────────────────────────────────────────");
  for (const q of quarters) {
    console.log("  " + padR(q, 9) + ER_VALUES.map((e) => padL(usd(results.get(e)!.get(q)?.total ?? 0), 11)).join(""));
  }
  console.log("  ────────────────────────────────────────────────────────────────────");
  const sum = (er: number) => [...results.get(er)!.values()].reduce((a, c) => a + c.total, 0);
  const tot = (er: number) => [...results.get(er)!.values()].reduce((a, c) => a + c.n, 0);
  const losing = (er: number) => [...results.get(er)!.values()].filter((c) => c.total < 0).length;
  console.log("  " + padR("TOTAL", 9) + ER_VALUES.map((e) => padL(usd(sum(e)), 11)).join(""));
  console.log("  " + padR("trades", 9) + ER_VALUES.map((e) => padL(String(tot(e)), 11)).join(""));
  console.log("  " + padR("exp/trd", 9) + ER_VALUES.map((e) => padL(usd(tot(e) ? sum(e) / tot(e) : 0), 11)).join(""));
  console.log("  " + padR("losing Q", 9) + ER_VALUES.map((e) => padL(`${losing(e)}/${quarters.length}`, 11)).join(""));
  console.log("══════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
