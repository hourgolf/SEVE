// ============================================================================
//  Daily-trend gate test (the ONE remaining principled hypothesis).
//  Compares the 15m EMA cross WITHOUT a gate vs WITH a higher-timeframe daily
//  gate: only take crosses aligned with SPY's 50-day trend (calls above the
//  daily MA, puts below). Per quarter, real fills, streamed one day at a time.
//  Run: npm run daily-gate
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { priceChain } from "./market";
import { aggregate } from "./aggregate";
import { simulateSession } from "./backtest";
import { makeCrossover, DEFAULT_CROSS_PARAMS } from "./strategies/crossover";
import type { Bar, FundState, StrategistConfig } from "./types";

const TF = 15;
const MA_DAYS = 50;
const MIN_HISTORY = 10; // before this many days, no daily bias (trade both)
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
const add = (m: Map<string, Cell>, q: string, pnl: number) => {
  const c = m.get(q) ?? m.set(q, { n: 0, total: 0 }).get(q)!;
  c.n++; c.total += pnl;
};

async function main() {
  const sessions = await loadRealSessions(); // sorted by date
  // daily closes (last bar of each session) for the daily MA / bias
  const dailyClose = sessions.map((s) => s.bars[s.bars.length - 1].close);
  const biasFor = (i: number): number => {
    if (i < MIN_HISTORY) return 0;
    const lo = Math.max(0, i - MA_DAYS);
    const window = dailyClose.slice(lo, i); // up to yesterday
    const ma = window.reduce((a, c) => a + c, 0) / window.length;
    return dailyClose[i - 1] > ma ? 1 : -1;
  };

  const base = new Map<string, Cell>();
  const gated = new Map<string, Cell>();
  let realDays = 0;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const q = quarterOf(s.dateET);
    const bars = aggregate(s.bars, TF);
    const closes = bars.map((b: Bar) => b.close);
    const day = await loadOptionBarsByDay([s.dateET]);
    const c = day.get(s.dateET);
    let chain: ChainProvider;
    if (c && c.length) { chain = makeRealChain(c); realDays++; }
    else chain = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);

    const evalBase = makeCrossover(closes, DEFAULT_CROSS_PARAMS, TF, 0);
    for (const t of simulateSession(bars, CFG, FUND, evalBase, chain)) add(base, q, t.pnl);

    const bias = biasFor(i);
    const evalGated = makeCrossover(closes, DEFAULT_CROSS_PARAMS, TF, bias);
    for (const t of simulateSession(bars, CFG, FUND, evalGated, chain)) add(gated, q, t.pnl);
  }
  console.log(`(${realDays}/${sessions.length} days real fills · ${TF}m · EMA 12/26 · daily ${MA_DAYS}d trend gate)`);

  const quarters = [...new Set(sessions.map((s) => quarterOf(s.dateET)))].sort();
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  EMA Cross 15m · daily-trend gate · total P&L per quarter");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  quarter       baseline      daily-gated");
  console.log("  ────────────────────────────────────────────────────────");
  for (const q of quarters) {
    console.log("  " + padR(q, 11) + padL(usd(base.get(q)?.total ?? 0), 11) + padL(usd(gated.get(q)?.total ?? 0), 15));
  }
  const sum = (m: Map<string, Cell>) => [...m.values()].reduce((a, c) => a + c.total, 0);
  const tot = (m: Map<string, Cell>) => [...m.values()].reduce((a, c) => a + c.n, 0);
  const losing = (m: Map<string, Cell>) => [...m.values()].filter((c) => c.total < 0).length;
  console.log("  ────────────────────────────────────────────────────────");
  console.log("  " + padR("TOTAL", 11) + padL(usd(sum(base)), 11) + padL(usd(sum(gated)), 15));
  console.log("  " + padR("trades", 11) + padL(String(tot(base)), 11) + padL(String(tot(gated)), 15));
  console.log("  " + padR("exp/trd", 11) + padL(usd(sum(base) / Math.max(1, tot(base))), 11) + padL(usd(sum(gated) / Math.max(1, tot(gated))), 15));
  console.log("  " + padR("losing Q", 11) + padL(`${losing(base)}/${quarters.length}`, 11) + padL(`${losing(gated)}/${quarters.length}`, 15));
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
