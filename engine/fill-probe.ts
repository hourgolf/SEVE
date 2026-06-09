// ============================================================================
//  fill-probe — is the desk OVER-TAXING rapid scalping via the full-spread fill?
//
//  The backtest fills every entry+exit by CROSSING THE FULL SPREAD (a marketable
//  order). On a cheap 0DTE option the bid/ask spread is the dominant cost, so a
//  high-frequency in/out scalper pays it on every round-trip. A real scalper works
//  LIMIT orders for price improvement. This probe sweeps the per-side spread-cross
//  fraction (spreadCrossFrac) from 1.0 (market order / pessimistic, the default) to
//  0.0 (passive limit at mid / optimistic, no-fill-risk bound) and reports exp$/trade.
//
//  Read it as a SENSITIVITY BAND, not a forecast: frac 1.0 = worst-case execution,
//  frac 0.0 = best-case. If a scalper (grind) is −EV at 1.0 but +EV by ~0.25–0.5, its
//  edge was killed by the COST MODEL, not the strategy → pursue with good execution.
//  If it's −EV even at 0.0 (mid), scalping is genuinely dead here, fills won't save it.
//  Low-frequency leans (power/breakout) should be far LESS fill-sensitive (fewer round
//  trips), so the SLOPE across fracs is the tell.
//
//    npm run fill-probe -- --days 800
//
//  Ungated (no cost gate) to isolate the fill effect; base = own exits + −50% prem
//  stop; real Databento NBBO, post-cost. Slippage (1 tick/side) held fixed — only the
//  spread-cross fraction varies. Symmetric (entry+exit same frac) — a real scalper's
//  execution is asymmetric, so this is a bound, not a point estimate.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { powerEvaluate, DEFAULT_POWER_PARAMS, DEFAULT_POWER_FINAL30 } from "./strategies/power";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { loadRealSessions } from "./realsource";
import { makeRealChain, loadOptionBarsByDay, type ChainProvider } from "./optionsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { Evaluate, FundState, StrategistConfig } from "./types";

const CFG: StrategistConfig = { slug: "scalp", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO = (frac: number): CostModel => ({ ...DEFAULT_COST_MODEL, spreadSource: "option_bars", spreadCrossFrac: frac });

const STRATS: { name: string; ev: Evaluate; kind: string }[] = [
  { name: "grind",        kind: "scalp", ev: (f, p) => grindEvaluate(f, p, DEFAULT_GRIND_PARAMS) },
  { name: "grind-v3",     kind: "scalp", ev: (f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS) },
  { name: "power",        kind: "lean",  ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS) },
  { name: "power-final30",kind: "lean",  ev: (f, p) => powerEvaluate(f, p, DEFAULT_POWER_FINAL30) },
  { name: "breakout",     kind: "lean",  ev: (f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS) },
];

const FRACS = [1.0, 0.75, 0.5, 0.25, 0.0];
const PREM = { stopPct: 50 };

const WINDOWS = [
  { name: "CHOP Mar26",       from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26",   from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25",   from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",         from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26",   from: "2025-11-01", to: "2026-02-28" },
];

const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);

// linear-interp the frac where exp$/t crosses 0 (between the bracketing FRACS); null if same sign throughout
function breakevenFrac(exps: number[]): number | null {
  for (let i = 0; i < FRACS.length - 1; i++) {
    const a = exps[i], b = exps[i + 1];
    if ((a <= 0 && b > 0) || (a > 0 && b <= 0)) {
      const t = a / (a - b); // 0..1 between FRACS[i] and FRACS[i+1]
      return FRACS[i] + t * (FRACS[i + 1] - FRACS[i]);
    }
  }
  return null;
}

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const sessions = await loadRealSessions({ sinceDaysAgo });
  if (!sessions.length) { console.log("\nNo real sessions.\n"); return; }
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: typeof sessions[number]): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };
  // gross=true → fill at mid, ZERO friction (no spread, slippage or commission) = the
  // pure directional edge of the strategy. The frac sweep then layers friction back on.
  const run = (set: typeof real, ev: Evaluate, frac: number, gross = false) =>
    metrics(set.flatMap((s) => simulateSession(s.bars, CFG, FUND, ev, chainOf(s), gross, PREM, NBBO(frac), undefined, undefined, undefined, undefined)), set.length);
  const expOf = (m: ReturnType<typeof metrics>) => (m.nTrades ? m.totalPnl / m.nTrades : 0);

  console.log(`\n  FILL-QUALITY sensitivity · ${real.length} real-NBBO sessions · ungated · base=own exits+−50% prem stop`);
  console.log(`  exp$/trade as the per-side spread-cross fraction goes 1.0 (market/worst) → 0.0 (mid/best)\n`);

  // ── pooled across all windows: the execution-sensitivity headline ──
  console.log("  ══ POOLED (all windows) — exp$/trade ══");
  console.log("  " + "strat".padEnd(14) + "kind".padEnd(7) + "tr/sess".padStart(8) + "GROSS".padStart(9) + FRACS.map((f) => `f${f.toFixed(2)}`.padStart(9)).join("") + "   be-frac");
  for (const st of STRATS) {
    const gross = expOf(run(real, st.ev, 0, true)); // zero-friction directional edge
    const cells = FRACS.map((fr) => run(real, st.ev, fr));
    const exps = cells.map(expOf);
    const trPerSess = cells[0].nTrades / real.length;
    const be = breakevenFrac(exps);
    console.log("  " + st.name.padEnd(14) + st.kind.padEnd(7) + trPerSess.toFixed(1).padStart(8) + f1(gross).padStart(9)
      + exps.map((e) => f1(e).padStart(9)).join("")
      + "   " + (be == null ? (exps[exps.length - 1] > 0 ? "≤0 (always+)" : ">1 (never+)") : be.toFixed(2)));
  }
  console.log("    GROSS = pure directional edge (no spread/slippage/commission). If GROSS≤0 the STRATEGY has no");
  console.log("    edge — fills can't save it. If GROSS>0 but f-cols<0, FRICTION (spread+slippage at size) eats it.\n");

  // ── per-window for the SCALPERS only (does the fill-sensitivity hold across regimes?) ──
  for (const st of STRATS.filter((s) => s.kind === "scalp")) {
    console.log(`  ══ ${st.name} per-window (exp$/t by cross-frac) ══`);
    for (const w of WINDOWS) {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const exps = FRACS.map((fr) => { const m = run(win, st.ev, fr); return m.nTrades ? m.totalPnl / m.nTrades : 0; });
      console.log("  " + w.name.padEnd(16) + exps.map((e) => f1(e).padStart(9)).join(""));
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
