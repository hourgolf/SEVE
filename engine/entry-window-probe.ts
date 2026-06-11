// ============================================================================
//  entry-window-probe — VALIDATE the hour-edge findings before any config moves.
//
//  hour-edge-probe (2026-06-11) found, pooled over 313 sessions:
//   · V3/ALT: the edge concentrates 10:xx-11:xx; 14:xx is NEGATIVE across the
//     whole momentum family (V3 −75/t · ALT −134/t · ORB −173/t). Mechanism
//     candidate: the ride exit needs RUNWAY — a 14:xx entry is tail-capped by
//     the 15:25 flatten, so late entries pay convexity prices without the
//     convex payoff window.
//   · ORB inverts: its 10:xx hour bleeds (−50/t × 175t) while 11:00–13:59
//     re-breaks print (+$127/t × 86t) — a potential CUT-LIST RESCUE.
//
//  Pooled buckets are hypothesis generators, not verdicts (post-hoc bucket
//  picking = the mirage's front door). This probe re-runs each channel with
//  entry-WINDOW restrictions and reports PER-REGIME-WINDOW totals + pooled
//  exp$/t. READ: arm a window change ONLY if it helps (or is neutral) in ≥4 of
//  5 regime windows AND lifts pooled exp$/t — the same bar every exit-study
//  mirage failed.
//
//    npm run entry-window-probe
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "win", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const ENTRIES_ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ENTRIES_ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const ENTRIES_V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const mkSpec = (id: string, entries: StrategySpec["entries"], timeET: string): StrategySpec => ({
  meta: { name: id, regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: id } as StrategySpec["meta"],
  exits: [{ timeET }], entries, sizing: {},
});
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};

// Entry-window wrapper: pass exits through untouched; allow ENTER intents only
// when the bar's ET minute (960 − minutesToClose) is inside [startMin, endMin).
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

interface Variant { ch: string; name: string; makeEval: (s: RealSession) => Evaluate }
const V3 = specEval(mkSpec("v3", ENTRIES_V3, "15:25"));
const ALT = specEval(mkSpec("alt", ENTRIES_ALT, "15:25"));
const ORB = specEval(mkSpec("orb", ENTRIES_ORB, "15:30"));
const VARIANTS: Variant[] = [
  { ch: "V3", name: "as-live (→15:25)   ", makeEval: V3 },
  { ch: "V3", name: "entries → 14:00    ", makeEval: windowed(V3, "09:30", "14:00") },
  { ch: "V3", name: "entries → 12:00    ", makeEval: windowed(V3, "09:30", "12:00") },
  { ch: "V3", name: "morning only →11:00", makeEval: windowed(V3, "09:30", "11:00") },
  { ch: "ALT", name: "as-live (→15:25)   ", makeEval: ALT },
  { ch: "ALT", name: "entries → 14:00    ", makeEval: windowed(ALT, "09:30", "14:00") },
  { ch: "ALT", name: "entries → 12:00    ", makeEval: windowed(ALT, "09:30", "12:00") },
  { ch: "ORB", name: "as-live (→15:00)   ", makeEval: ORB },
  { ch: "ORB", name: "11:00 → 14:00      ", makeEval: windowed(ORB, "11:00", "14:00") },
  { ch: "ORB", name: "11:00 → 15:00      ", makeEval: windowed(ORB, "11:00", "15:00") },
  { ch: "ORB", name: "12:00 → 14:00      ", makeEval: windowed(ORB, "12:00", "14:00") },
];

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 800 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const run = (v: Variant, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, v.makeEval(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  console.log(`\n  ENTRY-WINDOW validation · ride (−50% stop) · cost gate · real NBBO · ${real.length} sessions`);
  console.log(`  ARM BAR: helps/neutral in ≥4 of 5 regime windows AND lifts pooled exp$/t.\n`);
  console.log("  channel·variant              exp$/t   n      pooled$" + WINDOWS.map((w) => w.name.slice(0, 12).padStart(14)).join(""));
  for (const v of VARIANTS) {
    const all = run(v, real);
    const m = metrics(all, real.length);
    const exp = all.length ? m.totalPnl / all.length : 0;
    const per = WINDOWS.map((w) => {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      return Math.round(metrics(run(v, win), win.length).totalPnl);
    });
    console.log(`  ${v.ch.padEnd(4)}${v.name}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)}  ${String(all.length).padStart(4)}  ${`${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(14)).join(""));
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
