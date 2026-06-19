// ============================================================================
//  pyramid-faithful — does the +$22.5k pyramid edge survive the LIVE risk governor?
//  (#2 sizing/allocation, 2026-06-19.) The 4-skeptic verification flagged that the
//  pyramid-probe's +$22.5k was generated VIOLATING the live per-channel cap: stacks
//  grew to ~23 contracts while max_contracts=6 (the cap applies to each LOT, not the
//  total stack). Live, a per-channel max_contracts caps the WHOLE position. So the gate
//  before any multi-lot worker build: does pyramiding still beat RIDE when the total
//  stack is capped — and how much extra per-channel risk (a raised cap) does the full
//  edge actually require?
//
//  Runs V3/ALT (the validated +EV core, the only real convex tail) RIDE vs +3@30% pyramid
//  at maxStack ∈ {6 (current cap = ~1.5× base), 12 (2×), ∞ (uncapped = the +$22.5k)}.
//  Reports Σ / maxDD / boot-p5 / max-stack-reached + the per-window OOS (regime-wide or
//  one-window?). FAITHFUL: live 0.25 gate + 1-tick fills, RISK 500 / daily-stop 500.
//
//    npm run pyramid-faithful
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "pf", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: DAILY_STOP, muted: false, soloed: false };
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"]) => { const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries }); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }); };
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
const CH: Array<{ name: string; mk: (s: RealSession) => Evaluate }> = [
  { name: "BREAK(ALT V3)", mk: specEval([{ direction: "call", reason: "u", all: leg("break_above", "above", false) }, { direction: "put", reason: "d", all: leg("break_below", "below", false) }]) },
  { name: "BREAK(ALT)", mk: specEval([{ direction: "call", reason: "u", all: leg("break_above", "above", true) }, { direction: "put", reason: "d", all: leg("break_below", "below", true) }]) },
];
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
type Pyr = { maxAdds: number; minProfitPct: number; maxStack?: number } | null;
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const maxDD = (s: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of s) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
const bootP5 = (s: number[]) => { const n = s.length, B = 5, paths = 1500, t: number[] = []; for (let p = 0; p < paths; p++) { let seed = (p * 2654435761 + 1) >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; }; let sum = 0, len = 0; while (len < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < B && len < n; k++) { sum += s[(st + k) % n]; len++; } } t.push(sum); } t.sort((a, b) => a - b); return t[Math.floor(0.05 * (t.length - 1))]; };

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET); return !!cc && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to); });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  const run = (mk: (s: RealSession) => Evaluate, pyr: Pyr) => {
    const daily: number[] = []; const byWin = new Map<string, number>(); for (const w of WINDOWS) byWin.set(w.name, 0);
    let tot = 0, n = 0, maxStack = 0;
    for (const s of real) {
      const ts: Trade[] = simulateSession(s.bars, CFG, FUND, mk(s), chainFor(s), false, { stopPct: 50 }, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, pyr ?? undefined);
      const d = ts.reduce((a, x) => a + x.pnl, 0); daily.push(d); tot += d; n += ts.length; byWin.set(winOf(s.dateET), byWin.get(winOf(s.dateET))! + d);
      for (const t of ts) maxStack = Math.max(maxStack, t.qty ?? 0);
    }
    return { tot, n, maxStack, dd: maxDD(daily), p5: bootP5(daily), byWin };
  };

  console.log(`\n  PYRAMID-FAITHFUL · ${real.length} SPY sessions (real NBBO) · FAITHFUL (live 0.25 gate / 1-tick fills) · RISK ${RISK}/stop ${DAILY_STOP}/base-cap 6`);
  console.log(`  does the pyramid edge survive the live per-channel total-stack cap? +3@30% at maxStack {6=current, 12=2×, ∞=uncapped (+$22.5k)}\n`);

  const CONFIGS: Array<{ lbl: string; pyr: Pyr }> = [
    { lbl: "RIDE (no pyr)", pyr: null },
    { lbl: "+3@30% cap6", pyr: { maxAdds: 3, minProfitPct: 30, maxStack: 6 } },
    { lbl: "+3@30% cap12", pyr: { maxAdds: 3, minProfitPct: 30, maxStack: 12 } },
    { lbl: "+3@30% UNCAP", pyr: { maxAdds: 3, minProfitPct: 30 } },
  ];
  for (const ch of CH) {
    console.log(`  ${ch.name}`);
    console.log(`    config           Σ P&L (trades)   maxStack    maxDD      boot-p5    vs RIDE    win/5`);
    let rideTot = 0; let rideWin = new Map<string, number>();
    for (const C of CONFIGS) {
      const r = run(ch.mk, C.pyr);
      if (C.lbl.startsWith("RIDE")) { rideTot = r.tot; rideWin = r.byWin; }
      const better = WINDOWS.filter((w) => r.byWin.get(w.name)! >= (rideWin.get(w.name) ?? -Infinity)).length;
      const vs = C.lbl.startsWith("RIDE") ? "" : `${usd(r.tot - rideTot)}${r.tot > rideTot ? " ✓" : ""}`;
      console.log(`    ${C.lbl.padEnd(14)} ${`${usd(r.tot)} (${r.n}t)`.padStart(16)}   ${String(r.maxStack).padStart(4)}    ${usd(r.dd).padStart(8)}   ${usd(r.p5).padStart(8)}   ${vs.padStart(8)}   ${C.lbl.startsWith("RIDE") ? "—" : better + "/5"}`);
    }
    console.log("");
  }
  console.log(`  READ: if cap6 (the live governor) ≈ RIDE, the +$22.5k requires 3-4× the per-channel contract cap — i.e. it's a RISK-APPETITE`);
  console.log(`  decision (run 12-23 contract stacks), not a free edge. ARM-worthy only if cap6/cap12 beats RIDE robustly (≥4/5) AND the tail holds.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
