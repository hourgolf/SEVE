// ============================================================================
//  Regime test — does the LOCKED 15m EMA-cross config hold across time buckets?
//  Runs the default params (no re-tuning) over all available history, bucketed
//  by quarter, so we can see whether the edge generalizes across regimes or was
//  specific to one stretch. Uses Black-Scholes option fills (cheap, works on the
//  full bars history without backfilling option chains everywhere) — modeled
//  fills, so read the SHAPE across buckets, not the exact dollar level.
//  Run: npm run regime
// ============================================================================

import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { priceChain } from "./market";
import { aggregate } from "./aggregate";
import { simulateSession } from "./backtest";
import { makeCrossover, DEFAULT_CROSS_PARAMS } from "./strategies/crossover";
import type { FundState, StrategistConfig, Trade } from "./types";

const TF = 15;
const CFG: StrategistConfig = {
  slug: "cross", capital_pct: 30, aggression: 40, max_contracts: 6,
  daily_stop_usd: 90, muted: false, soloed: false,
};
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };

const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const pad = (s: string, w: number) => s.padEnd(w);
const padL = (s: string, w: number) => s.padStart(w);

async function main() {
  const sessions = await loadRealSessions();
  const byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET));
  let realDays = 0;
  // trades tagged with their session quarter
  const tagged: { q: string; t: Trade }[] = [];
  for (const s of sessions) {
    const bars = aggregate(s.bars, TF);
    const evalFn = makeCrossover(bars.map((b) => b.close), DEFAULT_CROSS_PARAMS, TF);
    const c = byDay.get(s.dateET);
    // real option prices where we have them; BS only as a fallback (it badly
    // mis-prices 0DTE — real and BS differ by hundreds of $/trade)
    let chain: ChainProvider;
    if (c && c.length) { chain = makeRealChain(c); realDays++; }
    else chain = (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
    const q = quarterOf(s.dateET);
    for (const t of simulateSession(bars, CFG, FUND, evalFn, chain)) tagged.push({ q, t });
  }
  console.log(`(${realDays}/${sessions.length} days used real option prices)`);

  const quarters = [...new Set(tagged.map((x) => x.q))].sort();
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  SEVE regime test · EMA Cross ${TF}m · locked default params`);
  console.log(`  ${DEFAULT_CROSS_PARAMS.emaFast}/${DEFAULT_CROSS_PARAMS.emaSlow} · vol ${DEFAULT_CROSS_PARAMS.volMult} · stop ${DEFAULT_CROSS_PARAMS.stopAtr}ATR · ${DEFAULT_CROSS_PARAMS.timeStop}m`);
  console.log("  (real option prices where available; modeled 3% spread)");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  quarter    trades  win%   exp/trd     total");
  console.log("  ──────────────────────────────────────────────");
  for (const q of quarters) {
    const ts = tagged.filter((x) => x.q === q).map((x) => x.t);
    const n = ts.length;
    const wins = ts.filter((t) => t.pnl > 0).length;
    const total = ts.reduce((a, t) => a + t.pnl, 0);
    console.log(
      "  " + pad(q, 10) + padL(String(n), 6) + padL((n ? (wins / n) * 100 : 0).toFixed(0) + "%", 7) +
        padL(usd(n ? total / n : 0), 10) + padL(usd(total), 10)
    );
  }
  const all = tagged.map((x) => x.t);
  const wins = all.filter((t) => t.pnl > 0).length;
  const total = all.reduce((a, t) => a + t.pnl, 0);
  console.log("  ──────────────────────────────────────────────");
  console.log("  " + pad("ALL", 10) + padL(String(all.length), 6) + padL((all.length ? (wins / all.length) * 100 : 0).toFixed(0) + "%", 7) + padL(usd(all.length ? total / all.length : 0), 10) + padL(usd(total), 10));
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
