// ============================================================================
//  breakeven-probe — does a LOW-threshold breakeven-once-in-profit stop help,
//  robustly, across regime windows? (Modeling agenda #1, 2026-06-08 handoff.)
//
//  The thesis: the day's biggest avoidable leak was green→red ROUND-TRIPS — a
//  position that went +$168/+$273/+$336 (≈ +30–50% premium) then gave it ALL back
//  to a stop-out loss. Moving the stop to ENTRY once up ~+30% converts those to
//  ~breakeven WITHOUT capping the convex tail (a runner that never retraces to
//  entry is untouched — unlike a profit target / trail, which the MC already killed).
//
//  Why this isn't already answered: power-probe's only breakeven config engages at
//  +100% (atR:2) — pure tail protection. It would NOT have caught the +30–50% round-
//  trips. This probe sweeps the LOW engage thresholds (+20/+30/+40/+50%) the thesis
//  actually needs, across the regime windows the handoff warns scramble orderings.
//
//    npm run breakeven-probe -- --days 410                 # 3 core windows (real NBBO)
//    npm run breakeven-probe -- --days 800                 # + the 2024 / chop-mix windows
//
//  Base = live-like (own strat exits + the −50% premium catastrophic stop that all
//  channels run live). +beNN layers the breakeven on top. Daily stops are left OFF
//  here to ISOLATE the exit effect (the live cost-gate / daily-stop would interact —
//  the montecarlo step layers --stop if needed). Single-leg ATM 0DTE, post-cost.
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

// The ENGINE's riskGovernor still uses the OLD budget model (capital_pct×aggression),
// not the worker's risk-$ model — so size pins to max_contracts here (budget ≫ cost),
// giving a constant 6-contract size across every cell (the breakeven DELTA is the
// signal; sizing just scales it). Daily stops OFF (1e9) to ISOLATE the exit effect.
const CFG: StrategistConfig = { slug: "power", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

const STRATS: { name: string; ev: Evaluate }[] = [
  { name: "power",        ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS) },
  { name: "power-final30", ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_FINAL30) },
  { name: "breakout",     ev: (f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS) },
];

// Engage thresholds: 0 = base (no breakeven), then the low thresholds the thesis needs.
const BE_LEVELS = [0, 20, 30, 40, 50];

// Regime windows (the handoff's "orderings scramble" set). Skipped automatically if
// the loaded --days span doesn't reach them.
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
  const dates = sessions.map((s) => s.dateET);
  let byDay = new Map<string, unknown[]>();
  if (dbento) byDay = loadDatabentoByDay(dates) as unknown as Map<string, unknown[]>;
  else if (useReal) { try { byDay = await loadOptionBarsByDay(dates) as Map<string, unknown[]>; } catch (e) { console.log(`  (option_bars unavailable — ${(e as Error).message}; modeled)`); } }
  const COST = dbento ? REAL_NBBO_COST : DEFAULT_COST_MODEL;
  const chainOf = (s: typeof sessions[number]): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (dbento && c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    if (useReal && c && c.length) return makeRealChain(c as Parameters<typeof makeRealChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };

  // Live-like base = own strat exits + the −50% premium catastrophic stop.
  const PREM = { stopPct: 50 };
  console.log(`\n  BREAKEVEN probe · loaded ${sessions.length} sessions (${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET}) · ${dbento ? "REAL NBBO Databento" : useReal ? "real option_bars" : "modeled"} · base = own exits + −50% prem stop\n`);

  for (const w of WINDOWS) {
    const win = sessions.filter((s) => s.dateET >= w.from && s.dateET <= w.to && (byDay.get(s.dateET)?.length ?? 0) > 0);
    if (!win.length) continue; // window not in the loaded span / no real chains
    console.log(`  ══ ${w.name}  (${win.length} real-chain sessions, ${win[0].dateET} → ${win[win.length - 1].dateET}) ══`);
    console.log("  " + "strat".padEnd(15) + BE_LEVELS.map((b) => (b === 0 ? "base" : `+be${b}`).padStart(11)).join("") + "   (totalPnl / maxDD)");
    for (const st of STRATS) {
      const cells = BE_LEVELS.map((be) => {
        const beExit = be > 0 ? { engagePct: be, lockPct: 0 } : undefined;
        const trades = win.flatMap((s) => simulateSession(s.bars, CFG, FUND, st.ev, chainOf(s), false, PREM, COST, undefined, undefined, beExit));
        const m = metrics(trades, win.length);
        const beCount = trades.filter((t) => t.exitReason === "breakeven_stop").length;
        return { pnl: m.totalPnl, dd: m.maxDrawdown, be: beCount };
      });
      const base = cells[0].pnl;
      const row = cells.map((c, i) => {
        const tag = i === 0 ? usd(c.pnl) : `${c.pnl >= base ? "+" : ""}${usd(c.pnl - base)}`;
        return tag.padStart(11);
      }).join("");
      console.log("  " + st.name.padEnd(15) + row);
      console.log("    " + "".padEnd(13) + cells.map((c) => (`dd ${usd(c.dd)}` + (c.be ? `·${c.be}be` : "")).padStart(11)).join(""));
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
