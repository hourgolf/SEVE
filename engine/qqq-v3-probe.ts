// ============================================================================
//  qqq-v3-probe — does V3's edge TRANSFER to QQQ? (probe queue item, 2026-06-11)
//
//  Context: V3 (breakout-alt-v3 = ALT minus momentum_atr) is the desk's only
//  clearly +EV SPY config; its entries→14:00 window was ARMED 2026-06-11 after
//  passing 5/5 regime windows. QQQ's incumbent (breakout-qqq) runs the BUILTIN
//  bare ORB and is cut-listed (−EV every window; its dormant spec entry refuted).
//  Question: do V3's gates (vwap_side + ER + rel_vol, no momentum_atr) carry the
//  edge to QQQ's tape, where gross-signal analysis said breakout-style edge is
//  QQQ-specific?
//
//  HONEST LIMIT: real QQQ NBBO exists locally only for 2026-03-02 → 2026-06-10
//  (one regime stretch + sub-splits). That CANNOT clear the 5-window arm bar —
//  this probe is a port gate (build/refute interest), not an arm ticket. If it
//  prints, the next step is buying the OOS windows (~$0.20 each) and the full
//  5-window run before any spec lands in the DB.
//
//    npm run qqq-v3-probe
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { STRATEGY_REGISTRY } from "./registry";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "win", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

// V3 entries — byte-identical to entry-window-probe's ENTRIES_V3 (the validated shape).
const ENTRIES_V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const mkSpec = (id: string): StrategySpec => ({
  meta: { name: id, regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: id } as StrategySpec["meta"],
  exits: [{ timeET: "15:25" }], entries: ENTRIES_V3, sizing: {},
});
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
// Builtin bare ORB — what breakout-qqq ACTUALLY runs live (base-slug resolution).
const builtinEval = (slug: string): ((s: RealSession) => Evaluate) => {
  const def = STRATEGY_REGISTRY[slug];
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
function windowed(base: (s: RealSession) => Evaluate, startET: string, endET: string): (s: RealSession) => Evaluate {
  const a = hm(startET), b = hm(endET);
  return (s) => {
    const e = base(s);
    return (f, pos) => {
      const intent = e(f, pos);
      if (intent?.kind !== "enter") return intent;
      const etMin = 960 - f.minutesToClose;
      return etMin >= a && etMin < b ? intent : null;
    };
  };
}

const V3 = specEval(mkSpec("v3"));
interface Variant { name: string; makeEval: (s: RealSession) => Evaluate }
const VARIANTS: Variant[] = [
  { name: "V3 as-armed (→14:00)  ", makeEval: windowed(V3, "09:30", "14:00") },
  { name: "V3 original (→15:25)  ", makeEval: V3 },
  { name: "V3 morning-only →11:00", makeEval: windowed(V3, "09:30", "11:00") },
  { name: "builtin ORB (incumbent)", makeEval: builtinEval("breakout") },
];
// Sub-splits inside the one covered stretch — a stability read, NOT regime windows.
const SPLITS = [
  { name: "Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "Jun26", from: "2026-06-01", to: "2026-06-10" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function runUnderlying(sym: string) {
  const sessions = await loadRealSessions({ symbol: sym, sinceDaysAgo: 800 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), sym) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.dateET >= "2026-03-01" && s.dateET <= "2026-06-10");
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const run = (v: Variant, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, v.makeEval(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  console.log(`\n  ${sym} — ${real.length} sessions (2026-03-02 → 2026-06-10, real NBBO, ride −50% stop, cost gate 3.0)`);
  console.log("  variant                   exp$/t   n   win%     pooled$" + SPLITS.map((w) => w.name.padStart(11)).join(""));
  for (const v of VARIANTS) {
    const all = run(v, real);
    const m = metrics(all, real.length);
    const exp = all.length ? m.totalPnl / all.length : 0;
    const winPct = all.length ? (100 * all.filter((t) => t.pnl > 0).length) / all.length : 0;
    const per = SPLITS.map((w) => {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      return Math.round(metrics(run(v, win), win.length).totalPnl);
    });
    console.log(`  ${v.name}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%  ${`${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(11)).join(""));
  }
}

async function main() {
  console.log(`\n  QQQ-V3 PORT PROBE · one covered stretch — a PORT GATE, not an arm ticket`);
  await runUnderlying("QQQ");
  await runUnderlying("SPY"); // same-window reference: what the edge looks like where it's proven
  console.log(`\n  READ: port interest = QQQ V3 ≥ +EV pooled AND ≥2/3 splits green AND beats the`);
  console.log(`  incumbent builtin ORB. Arming would still need the bought-data 5-window bar.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
