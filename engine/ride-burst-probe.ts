// ============================================================================
//  ride-burst-probe — the "ride-not-scalp" thesis. grind's momentum-burst entry is
//  −EV as a MACHINE (grind-entry-probe), but was it the DIRECTION, or the tiny scalp
//  target (cost-walled) + flat-open chop + 0DTE gamma? This rebuilds the burst as a
//  RIDER: same momentum_atr+er+curfew entry, but exit via an ATR-chandelier TRAIL
//  (not the 0.6-ATR scalp), with toggle-able trend_align (drop counter-trend) + gap_min
//  (gap days only), at 0DTE AND 1DTE (time-value, like pb-ride). Attribution ladder so
//  each layer's effect is isolated. Real NBBO; exp$/t + the −50%-stop rate (the cost-wall).
//
//    npm run ride-burst-probe
//  PASS = a variant turns +EV pooled AND holds across the 5 regime windows (then paper-lab).
//  Most likely outcome (be honest): the trail cuts the stop rate but the burst is still
//  too weak a signal to clear the cost gate — i.e. grind's ENTRY, not its exit, is the wall.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec, Condition } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "rb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const TRAIL = { atrChandelierK: 1.5 }; // the RIDE (breakout's chandelier), replacing grind's scalp target

const meta = { name: "rb", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "rb" } as StrategySpec["meta"];
const burst = (op: ">=" | "<=", v: number): Condition[] => [{ kind: "momentum_atr", op, value: v, lookback: 3 }, { kind: "rel_vol", min: 1.0 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "time_before", et: "14:00" }];
const riderEval = (trend: boolean, gap: boolean) => {
  const extra = (side: "up" | "down"): Condition[] => [...(trend ? [{ kind: "trend_align", side, ref: "ema21" } as Condition] : []), ...(gap ? [{ kind: "gap_min", pct: 0.25 } as Condition] : [])];
  const spec: StrategySpec = { meta, exits: [{ timeET: "15:25" }], sizing: {}, entries: [
    { direction: "call", reason: "u", all: [...burst(">=", 0.8), ...extra("up")] },
    { direction: "put", reason: "d", all: [...burst("<=", -0.8), ...extra("down")] },
  ] };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};

const WINDOWS = [
  { name: "CHOP-Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND-AM26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND-24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOPMIX2526", from: "2025-11-01", to: "2026-02-28" },
];
const isStop = (r: string) => /stop/i.test(r);

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => {
    const c = mdte.get(s.dateET); const nx = nextOf.get(s.dateET);
    return !!c && !!nx && c.some((q) => q.expiration === nx) && c.some((q) => q.expiration === s.dateET) && s.bars.length >= 90;
  });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };

  // scalp = grind-v3 builtin (its own fixed-target exit, no trail); rider = trail exit.
  const runScalp = (set: RealSession[]) => set.flatMap((s) => simulateSession(s.bars, CFG, FUND, (f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS), chainFor(s, s.dateET), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));
  const runRider = (mk: (s: RealSession) => Evaluate, dte: 0 | 1, set: RealSession[]) => set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainFor(s, dte === 0 ? s.dateET : nextOf.get(s.dateET)!), false, { stopPct: 50 }, NBBO, undefined, TRAIL, undefined, undefined, 0, GATE));

  const stat = (ts: Trade[]) => ({ n: ts.length, total: ts.reduce((a, t) => a + t.pnl, 0), exp: ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : 0, stopPct: ts.length ? ts.filter((t) => isStop(t.exitReason)).length / ts.length : 0 });
  const perWin = (run: (set: RealSession[]) => Trade[]) => WINDOWS.map((w) => stat(run(real.filter((s) => s.dateET >= w.from && s.dateET <= w.to))).exp);

  const ROWS: Array<[string, (set: RealSession[]) => Trade[]]> = [
    ["scalp grind-v3 0DTE (ref)", runScalp],
    ["rider 0DTE", (set) => runRider(riderEval(false, false), 0, set)],
    ["rider +trend 0DTE", (set) => runRider(riderEval(true, false), 0, set)],
    ["rider +gap 0DTE", (set) => runRider(riderEval(false, true), 0, set)],
    ["rider +trend+gap 0DTE", (set) => runRider(riderEval(true, true), 0, set)],
    ["rider 1DTE", (set) => runRider(riderEval(false, false), 1, set)],
    ["rider +trend 1DTE", (set) => runRider(riderEval(true, false), 1, set)],
    ["rider +gap 1DTE", (set) => runRider(riderEval(false, true), 1, set)],
    ["rider +trend+gap 1DTE", (set) => runRider(riderEval(true, true), 1, set)],
  ];

  console.log(`\n  RIDE-NOT-SCALP probe · grind burst, trail exit, ±trend ±gap, 0/1DTE · ${real.length} sessions · real NBBO`);
  console.log(`  ${"variant".padEnd(24)} ${"exp$/t".padStart(7)} ${"n".padStart(5)} ${"Σ".padStart(8)} ${"stop%".padStart(6)}   ` + WINDOWS.map((w) => w.name.padStart(12)).join(""));
  for (const [label, run] of ROWS) {
    const all = run(real); const s = stat(all); const pw = perWin(run);
    console.log(`  ${label.padEnd(24)} ${s.exp.toFixed(1).padStart(7)} ${String(s.n).padStart(5)} ${((s.total >= 0 ? "+" : "") + Math.round(s.total)).padStart(8)} ${Math.round(s.stopPct * 100) + "%"}`.padEnd(58) + "   " + pw.map((e) => e.toFixed(1).padStart(12)).join(""));
  }
  console.log(`\n  READ: rider beats scalp on exp$/t? trail cuts stop%? does any variant go +EV pooled AND hold ≥4/5 windows?`);
  console.log(`  If the best variant is still −EV, grind's ENTRY (weak burst signal) is the wall — not the exit. Then trend_align has no home here either.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
