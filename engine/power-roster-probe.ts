// ============================================================================
//  power-roster-probe (#3) — the power family is the desk's bleeding heart. Two
//  decisions: (1) is the cost-gate EXEMPTION on `power` still justified, or does
//  gating rescue it? (2) which of {power / power-final30 / power-smart-entries} to keep?
//
//  The ustop-sweep showed POWERHOUR(base) bled −$43,598 (15% win, 1204 trades — it
//  re-leans EVERY bar in the final hour) gate-EXEMPT; the exemption's rationale was
//  "gating kills power's gamma-convex edge." This tests that head-on: each power channel
//  UNGATED vs GATED (cost gate 3.0), per window — does gating remove the BIG POSITIVE
//  windows (a real convex tail worth protecting) or just the bleed (exemption unjustified)?
//
//    npm run power-roster
//
//  LIVE-faithful: the builtins run VWAP-OFF (DEFAULT_POWER_MOM60/MOM30 — the codebase's
//  documented proxy for the live per-bar-VWAP bug) WITH their native exits (1.0·ATR adverse
//  stop + 3-min flatten) + a −50% premium backstop. POWERHOUR(ALT) = the live spec entry
//  (vwap_side+mom+time) ride-to-15:55 + −50% (⚠ its vwap_side gate is ALSO degraded live by
//  the same bug — modeled here with a working VWAP, so ALT's real entries differ somewhat).
//  ustop 0 (live). Real SPY Databento NBBO, max_contracts 6.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { powerEvaluate, DEFAULT_POWER_MOM60, DEFAULT_POWER_MOM30 } from "./strategies/power";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "pr", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };

const ENTRIES_POWER: StrategySpec["entries"] = [
  { direction: "call", reason: "power_long", all: [{ kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
  { direction: "put", reason: "power_short", all: [{ kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
];
const ALT_SPEC: StrategySpec = {
  meta: { name: "pwrAlt", regime: "final hour", dteRange: [0, 0], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "pwrAlt" } as StrategySpec["meta"],
  exits: [{ timeET: "15:55" }], entries: ENTRIES_POWER, sizing: {},
};
const altEval = (() => { const def = specToStrategyDef(ALT_SPEC); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl }); })();

type Channel = { name: string; tag: string; makeEval: (s: RealSession) => Evaluate };
const CHANNELS: Channel[] = [
  { name: "POWERHOUR(base)", tag: "power · MOM60 · live gate-EXEMPT", makeEval: () => (f, p) => powerEvaluate(f, p, DEFAULT_POWER_MOM60) },
  { name: "Power-Final30",   tag: "power-final30 · MOM30 · gated",    makeEval: () => (f, p) => powerEvaluate(f, p, DEFAULT_POWER_MOM30) },
  { name: "POWERHOUR(ALT)",  tag: "power-smart-entries · spec · gated", makeEval: altEval },
];

const run = (ch: Channel, set: RealSession[], chainOf: (s: RealSession) => ChainProvider, gated: boolean): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, CFG, FUND, ch.makeEval(s), chainOf(s), false,
    { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, gated ? GATE : undefined));

const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",       from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };

  console.log(`\n  POWER ROSTER · gate decision + consolidation · ${real.length} real-NBBO SPY sessions · ride+(−50% stop) · ustop 0`);
  console.log(`  builtins VWAP-OFF (live proxy) + native exits; ALT = live spec entry (vwap_side degraded live — caveat)\n`);

  for (const ch of CHANNELS) {
    console.log(`  ══ ${ch.name}  [${ch.tag}] ══`);
    console.log("  " + "window".padEnd(16) + "UNGATED".padStart(13) + "GATED".padStart(13) + "   gate Δ");
    const pu = metrics(run(ch, real, chainOf, false), real.length);
    const pg = metrics(run(ch, real, chainOf, true), real.length);
    const ru = run(ch, real, chainOf, false), rg = run(ch, real, chainOf, true);
    const expu = ru.length ? pu.totalPnl / ru.length : 0, expg = rg.length ? pg.totalPnl / rg.length : 0;
    console.log("  " + "POOLED total$".padEnd(16) + `${sgn(pu.totalPnl)}${Math.round(pu.totalPnl)}`.padStart(13) + `${sgn(pg.totalPnl)}${Math.round(pg.totalPnl)}`.padStart(13) + `   ${sgn(pg.totalPnl - pu.totalPnl)}${Math.round(pg.totalPnl - pu.totalPnl)}`);
    console.log("  " + "exp$/t · win·n".padEnd(16) + `${expu.toFixed(1)}·${(pu.winRate * 100).toFixed(0)}w·${ru.length}`.padStart(13) + `${expg.toFixed(1)}·${(pg.winRate * 100).toFixed(0)}w·${rg.length}`.padStart(13));
    for (const w of WINDOWS) {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const u = Math.round(metrics(run(ch, win, chainOf, false), win.length).totalPnl);
      const g = Math.round(metrics(run(ch, win, chainOf, true), win.length).totalPnl);
      console.log("  " + w.name.padEnd(16) + `${sgn(u)}${u}`.padStart(13) + `${sgn(g)}${g}`.padStart(13) + `   ${sgn(g - u)}${g - u}`);
    }
    console.log("");
  }
  console.log("  READ #1 (gate): if GATED beats UNGATED broadly AND keeps the positive windows, the cost-gate");
  console.log("  exemption on `power` is UNJUSTIFIED → gate it. If gating erases a big positive (convex) window,");
  console.log("  the exemption stands. #2 (keep): least-negative gated channel is the consolidation keeper.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
