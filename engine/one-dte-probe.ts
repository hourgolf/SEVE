// ============================================================================
//  one-dte-probe — same strategies, same risk caps, 1DTE contracts instead of
//  0DTE. (2026-06-12, operator's walk-thought: "buying time and avoiding the
//  whipsaw reversal seems like it could have saved a lot of trades.")
//
//  MECHANISM UNDER TEST: a 1DTE ATM option carries ~√2× the time value and far
//  less gamma — an adverse 0.3% wiggle that marks a 0DTE down −50% (stop!) might
//  dent a 1DTE −25% and SURVIVE the whipsaw to catch the resume. The price of
//  that survival: richer premium (fewer contracts at the same risk $), less
//  convexity on the win side, and slower decay also works AGAINST quick wins.
//
//  CLEAN A/B: both arms price from the SAME multi-DTE cache (data/databento-
//  mdte/), one chain filtered to TODAY's expiry, one to the NEXT session's.
//  Identical entries, exits, cost model, sizing rule, −50% premium stop,
//  same-day flatten (this is NOT an overnight-hold test — the desk's same-day
//  rule stands; only the contract's time value changes).
//
//  Channels: the keepers as-armed (V3, ALT), ORB as-live, grind-v3 (builtin
//  fast scalper — does time value help or hurt a 5-min hold?), and PB-ride
//  (the killed pullback candidate — does buying time revive a refuted shape?).
//
//  THESIS METRIC: premium_stop RATE. If 1DTE stops fire materially less often
//  AND exp$/t improves, the whipsaw-survival thesis is real. ⚠ COVERAGE: the
//  mdte cache spans Mar→Jun26 ONLY (one regime stretch) — this is a PULSE
//  CHECK, not the 5-window bar; the 1DTE windows for the other 4 regimes are
//  being bought in parallel for the full verdict.
//
//    npm run one-dte-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { makeEval as pbEval, precompute as pbPre } from "./ema-pullback-probe";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "dte", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const specEval = (entries: StrategySpec["entries"], timeET: string) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const sgn = (v: number) => (v >= 0 ? "+" : "");
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  // usable: mdte cache present AND it actually quotes the next session's expiry
  const real = sessions.filter((s) => {
    const c = mdte.get(s.dateET); const nx = nextOf.get(s.dateET);
    return !!c && !!nx && c.some((q) => q.expiration === nx) && c.some((q) => q.expiration === s.dateET) && s.bars.length >= 90;
  });

  const chainFor = (s: RealSession, exp: string): ChainProvider => {
    const all = makeMultiDteChain(mdte.get(s.dateET)!);
    return (_spot, _mtc, ts) => all(ts).filter((q) => q.expiration === exp);
  };
  const CH: Array<[string, (s: RealSession) => Evaluate]> = [
    ["V3 (as-armed)", specEval(V3, "15:25")],
    ["ALT (as-armed)", specEval(ALT, "15:25")],
    ["ORB (as-live)", specEval(ORB, "15:30")],
    ["grind-v3 (builtin)", () => (f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS)],
    ["PB-ride (killed)", (s) => pbEval(pbPre(s), false, false)],
  ];
  const run = (mk: (s: RealSession) => Evaluate, dte: 0 | 1, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainFor(s, dte === 0 ? s.dateET : nextOf.get(s.dateET)!), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  console.log(`\n  ONE-DTE probe · same strategies + risk caps, 1DTE contracts · real NBBO (multi-DTE cache) · ${real.length} sessions`);
  console.log(`  span ${real[0]?.dateET} → ${real[real.length - 1]?.dateET} — full 5-regime-window corpus (the verdict run)`);
  console.log(`  thesis metric = premium_stop rate: time value should let 1DTE SURVIVE the whipsaw the 0DTE stops out on.\n`);
  console.log(`  channel               dte   exp$/t    n   win%  stop%  eod%     pooled$` + WINDOWS.map((w) => w.name.slice(0, 11).padStart(13)).join(""));
  for (const [name, mk] of CH) {
    const rows: string[] = [];
    const perW: Record<number, number[]> = { 0: [], 1: [] };
    let t0: Trade[] = [], t1: Trade[] = [];
    for (const dte of [0, 1] as const) {
      const all = run(mk, dte, real);
      if (dte === 0) t0 = all; else t1 = all;
      const exp = all.length ? all.reduce((a, t) => a + t.pnl, 0) / all.length : 0;
      const tot = all.reduce((a, t) => a + t.pnl, 0);
      const winPct = all.length ? (100 * all.filter((t) => t.pnl > 0).length) / all.length : 0;
      const stopPct = all.length ? (100 * all.filter((t) => /stop/i.test(t.exitReason)).length) / all.length : 0;
      const eodPct = all.length ? (100 * all.filter((t) => /eod|time|flatten/i.test(t.exitReason)).length) / all.length : 0;
      const per = WINDOWS.map((w) => Math.round(run(mk, dte, real.filter((s) => s.dateET >= w.from && s.dateET <= w.to)).reduce((a, t) => a + t.pnl, 0)));
      perW[dte] = per;
      rows.push(`  ${(dte === 0 ? name : "").padEnd(20)} ${dte}DTE  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%  ${stopPct.toFixed(0).padStart(4)}%  ${eodPct.toFixed(0).padStart(3)}%  ${`${sgn(tot)}${Math.round(tot)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(13)).join(""));
    }
    console.log(rows.join("\n"));
    const d = t1.reduce((a, t) => a + t.pnl, 0) - t0.reduce((a, t) => a + t.pnl, 0);
    const dW = perW[1].map((v, i) => v - perW[0][i]);
    console.log(`  ${"".padEnd(20)} Δ1−0  ${`${sgn(d)}${Math.round(d)}`.padStart(7)} pooled · windows improved: ${dW.filter((x) => x > 0).length}/5` + "".padEnd(13) + dW.map((p) => `${sgn(p)}${p}`.padStart(13)).join("") + "\n");
  }
  console.log(`  READ: thesis lives if 1DTE stop% drops AND Δ pooled > 0 on the keepers. Watch grind-v3 (5-min holds`);
  console.log(`  shouldn't care about theta but DO care about gamma — if its target rate collapses, time value diluted`);
  console.log(`  the very pop it scalps). Full 5-window verdict once the 1DTE windows finish downloading.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
