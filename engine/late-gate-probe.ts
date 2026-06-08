// ============================================================================
//  late-gate-probe — does a late-session re-entry cap (one-and-done) help, and
//  does it even BITE in the backtest? (Modeling agenda #2, 2026-06-08 handoff.)
//
//  Thesis: power OVER-TRADES the whipsawy final 20 min — after the peak it kept
//  opening NEW wrong-way leans. A one-and-done / tighter late re-entry gate should
//  cut leans 2..N. First question before "does it help": does the backtest even
//  REPRODUCE the over-trading? (power-final30 already takes ~1 trade/session.) The
//  Δtrades column answers that — if the gate doesn't cut trades, it has nothing to fix.
//
//    npm run late-gate-probe -- --days 410
//
//  NB this is a PER-CHANNEL gate. Live 06-08 "over-trading" was partly CROSS-channel
//  (POWERHOUR base + ALT each leaning the same minutes) — a per-channel cap can't
//  touch that. Base = own exits + −50% prem stop. Single-leg ATM 0DTE, post-cost.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { powerEvaluate, DEFAULT_POWER_PARAMS, DEFAULT_POWER_FINAL30 } from "./strategies/power";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { loadRealSessions } from "./realsource";
import { makeRealChain, loadOptionBarsByDay, type ChainProvider } from "./optionsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { Evaluate, FundState, StrategistConfig } from "./types";

const CFG: StrategistConfig = { slug: "power", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

const STRATS: { name: string; ev: Evaluate }[] = [
  { name: "power",         ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS) },
  { name: "power-final30", ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_FINAL30) },
  { name: "breakout",      ev: (f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS) },
];

// Gate configs: base (none), then one-and-done at a few cutoffs, then a 2-cap.
const GATES: { tag: string; g?: { cutoffMin: number; maxEntries: number } }[] = [
  { tag: "base" },
  { tag: "f20·1", g: { cutoffMin: 20, maxEntries: 1 } },
  { tag: "f30·1", g: { cutoffMin: 30, maxEntries: 1 } },
  { tag: "f60·1", g: { cutoffMin: 60, maxEntries: 1 } },
  { tag: "f20·2", g: { cutoffMin: 20, maxEntries: 2 } },
];

const WINDOWS: { name: string; from: string; to: string }[] = [
  { name: "CHOP Mar26",          from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND Apr-May26",     from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS May-Aug25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24May-Aug",     from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25N-26F",    from: "2025-11-01", to: "2026-02-28" },
];

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 410;
  const oi = process.argv.indexOf("--options");
  const optMode = oi >= 0 && process.argv[oi + 1] ? process.argv[oi + 1] : "databento";
  const dbento = optMode === "databento", useReal = optMode === "real";

  const sessions = await loadRealSessions({ sinceDaysAgo });
  if (!sessions.length) { console.log("\nNo real sessions — backfill underlying_bars first.\n"); return; }
  let byDay = new Map<string, unknown[]>();
  if (dbento) byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  else if (useReal) { try { byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET)) as Map<string, unknown[]>; } catch (e) { console.log(`  (option_bars unavailable — ${(e as Error).message}; modeled)`); } }
  const COST = dbento ? REAL_NBBO_COST : DEFAULT_COST_MODEL;
  const chainOf = (s: typeof sessions[number]): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (dbento && c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    if (useReal && c && c.length) return makeRealChain(c as Parameters<typeof makeRealChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };
  const PREM = { stopPct: 50 };

  console.log(`\n  LATE-GATE probe · loaded ${sessions.length} sessions · ${dbento ? "REAL NBBO Databento" : useReal ? "real option_bars" : "modeled"} · base = own exits + −50% prem stop`);
  console.log(`  cells show  Δtrades / ΔtotalPnl  vs base  (base shows absolute trades / totalPnl)\n`);

  for (const w of WINDOWS) {
    const win = sessions.filter((s) => s.dateET >= w.from && s.dateET <= w.to && (byDay.get(s.dateET)?.length ?? 0) > 0);
    if (!win.length) continue;
    console.log(`  ══ ${w.name}  (${win.length} sessions) ══`);
    console.log("  " + "strat".padEnd(15) + GATES.map((g) => g.tag.padStart(15)).join(""));
    for (const st of STRATS) {
      const cells = GATES.map((gt) => {
        const trades = win.flatMap((s) => simulateSession(s.bars, CFG, FUND, st.ev, chainOf(s), false, PREM, COST, undefined, undefined, undefined, gt.g));
        return { n: trades.length, pnl: metrics(trades, win.length).totalPnl, exp: trades.length ? metrics(trades, win.length).totalPnl / trades.length : 0 };
      });
      const base = cells[0];
      const row = cells.map((c, i) => {
        const txt = i === 0 ? `${c.n}t/${usd(c.pnl)}` : `${c.n - base.n}t/${c.pnl >= base.pnl ? "+" : ""}${usd(c.pnl - base.pnl)}`;
        return txt.padStart(15);
      }).join("");
      console.log("  " + st.name.padEnd(15) + row);
      // exp$/trade per cell — the mechanical-vs-real tell: flat exp = the P&L move is
      // just "fewer −EV trades" (mechanical); rising exp = the gate cut WORSE-than-avg leans.
      console.log("  " + "  exp$/t".padEnd(15) + cells.map((c) => (`${c.exp >= 0 ? "+" : ""}${c.exp.toFixed(1)}`).padStart(15)).join(""));
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
