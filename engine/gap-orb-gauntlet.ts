// ============================================================================
//  gap-orb-gauntlet — does gap_min on ORB-base survive the OOS + MC gauntlet, or is
//  the +$1,130 a TREND-OOS-MA25 artifact? (Thread A follow-up, 2026-06-19.)
//
//  ride-filter-probe found gap_min 0.25 ALONE flips ORB-base −$1,159 → +$1,130 with
//  exp$/t −$2→+$3 (real selection) — BUT only 2/5 windows improved and it was largely
//  one-window-carried (MA25). This settles arm-vs-park:
//   (1) THRESHOLD SWEEP — per-window Σ for each gap_min, is there a robust band?
//   (2) OOS LEAVE-ONE-OUT — fit the best gap threshold on the OTHER 4 windows, apply to
//       the held-out 5th. PASS = the best-on-history threshold beats always-on on ≥4/5
//       held-out windows (it GENERALIZES, isn't fit to the pooled corpus).
//   (3) MC TAIL — block-bootstrap the daily series, gap-filtered vs always-on.
//  gap_min gates ENTRIES, so a sub-threshold-gap day simply takes no trades — it's a
//  pure ex-ante DAY SELECTOR (gap is known at the open; zero look-ahead). Faithful:
//  ORB's live spec (or_width/vwap/momentum/rel_vol/time_before 15:00) + RISK 500 / stop
//  500 / +75% target / gate 3 / real Databento NBBO.
//
//    npm run gap-orb-gauntlet
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 1000, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "go", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 500, muted: false, soloed: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };
const TARGET = 75, STOP = 50;
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const GAPS = [0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const orbLeg = (side: "above" | "below", gapMin: number): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: side === "above" ? "break_above" : "break_below", minutes: 30 },
  { kind: "or_width_min", pct: 0.25 } as any,
  { kind: "vwap_side", side },
  { kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 5 } as any,
  { kind: "rel_vol", min: 1.3 },
  ...(gapMin > 0 ? [{ kind: "gap_min", pct: gapMin } as any] : []),
  { kind: "time_before", et: "15:00" },
];
const orbEval = (gapMin: number): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries: [
    { direction: "call", reason: "u", all: orbLeg("above", gapMin) },
    { direction: "put", reason: "d", all: orbLeg("below", gapMin) },
  ] });
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET); return !!cc && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to); });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;
  const datesS = [...new Set(real.map((s) => s.dateET))].sort();

  // daily P&L map per gap threshold (simulateSession per session — matches ride-filter exactly)
  const dayByGap = new Map<number, Map<string, number>>();
  const tradesByGap = new Map<number, number>();
  for (const g of GAPS) {
    const ev = orbEval(g); const m = new Map<string, number>(); let nt = 0;
    for (const s of real) {
      const ts: Trade[] = simulateSession(s.bars, CFG, FUND, ev(s), chainFor(s), false, { profitPct: TARGET, stopPct: STOP }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
      m.set(s.dateET, ts.reduce((a, x) => a + x.pnl, 0)); nt += ts.length;
    }
    dayByGap.set(g, m); tradesByGap.set(g, nt);
  }
  const winSum = (g: number, w: string) => real.filter((s) => winOf(s.dateET) === w).reduce((a, s) => a + (dayByGap.get(g)!.get(s.dateET) ?? 0), 0);
  const tot = (g: number) => real.reduce((a, s) => a + (dayByGap.get(g)!.get(s.dateET) ?? 0), 0);

  console.log(`\n  GAP-ORB GAUNTLET · ${real.length} SPY sessions (real NBBO) · ORB-base + gap_min, OOS + MC. Faithful RISK500/stop500/+75%/gate3.\n`);

  // ---- (1) THRESHOLD SWEEP (in-sample, per window) ----
  console.log(`  ══ (1) gap_min sweep — per-window Σ (in-sample) ══`);
  console.log(`  ${"gap".padEnd(6)}${"n".padStart(5)}${"exp$/t".padStart(8)}` + WINDOWS.map((w) => w.name.replace(/ .*/, "").padStart(10)).join("") + `${"Σ".padStart(10)}  win/5`);
  for (const g of GAPS) {
    const cells = WINDOWS.map((w) => usd(winSum(g, w.name)).padStart(10)).join("");
    const better = WINDOWS.filter((w) => winSum(g, w.name) >= winSum(0, w.name)).length;
    const nt = tradesByGap.get(g)!;
    console.log(`  ${g.toFixed(2).padEnd(6)}${String(nt).padStart(5)}${usd(nt ? tot(g) / nt : 0).padStart(8)}${cells}${usd(tot(g)).padStart(10)}  ${g === 0 ? "—" : better + "/5"}`);
  }
  console.log("");

  // ---- (2) OOS LEAVE-ONE-OUT — fit best gap on the OTHER 4, apply to held-out ----
  console.log(`  ══ (2) OOS LEAVE-ONE-OUT — best gap on the OTHER 4 windows, applied to the held-out window ══`);
  console.log(`  held-out window     always-on Σ      best-gap (on other-4)   held-out Σ @ that gap    better?`);
  let oosTot = 0, oosBase = 0, oosBetter = 0;
  for (const W of WINDOWS) {
    const others = WINDOWS.filter((w) => w.name !== W.name);
    let bestG = 0, bestOther = -Infinity;
    for (const g of GAPS) { const o = others.reduce((a, w) => a + winSum(g, w.name), 0); if (o > bestOther) { bestOther = o; bestG = g; } }
    const held = winSum(bestG, W.name), base = winSum(0, W.name);
    oosTot += held; oosBase += base; if (held >= base) oosBetter++;
    console.log(`  ${W.name.padEnd(18)} ${usd(base).padStart(12)}      gap ${bestG.toFixed(2)}              ${usd(held).padStart(12)}        ${held >= base ? "✓" : "✗"}`);
  }
  console.log(`  POOLED  always-on ${usd(oosBase)}  →  OOS-gap ${usd(oosTot)}  (Δ ${usd(oosTot - oosBase)})  · better ${oosBetter}/5  ${oosBetter >= 4 ? "· PASS the OOS bar" : "· FAILS the OOS bar (≥4/5 needed)"}`);
  console.log("");

  // ---- (3) MC TAIL — block-bootstrap base vs gap0.25 ----
  const maxDD = (s: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of s) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
  const boot = (series: number[]) => {
    const n = series.length, B = 5, paths = 2000, terms: number[] = [], dds: number[] = [];
    for (let p = 0; p < paths; p++) { const path: number[] = []; let seed = (p * 2654435761) >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
      while (path.length < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < B && path.length < n; k++) path.push(series[(st + k) % n]); } terms.push(path.reduce((a, x) => a + x, 0)); dds.push(maxDD(path)); }
    terms.sort((a, b) => a - b); dds.sort((a, b) => a - b); const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
    return { p5: q(terms, 0.05), p50: q(terms, 0.5), p95: q(terms, 0.95), mdd: q(dds, 0.05) };
  };
  const bs = datesS.map((d) => dayByGap.get(0)!.get(d) ?? 0), gs = datesS.map((d) => dayByGap.get(0.25)!.get(d) ?? 0);
  const bb = boot(bs), bg = boot(gs);
  console.log(`  ══ (3) MC TAIL — block-bootstrap (B=5, 2000 paths), gap0.25 vs always-on ══`);
  console.log(`  policy        Σ        p5         p50        p95        maxDD p5`);
  console.log(`  always-on   ${usd(bs.reduce((a, x) => a + x, 0)).padStart(8)}  ${usd(bb.p5).padStart(8)}  ${usd(bb.p50).padStart(9)}  ${usd(bb.p95).padStart(9)}  ${usd(bb.mdd).padStart(9)}`);
  console.log(`  gap_min0.25 ${usd(gs.reduce((a, x) => a + x, 0)).padStart(8)}  ${usd(bg.p5).padStart(8)}  ${usd(bg.p50).padStart(9)}  ${usd(bg.p95).padStart(9)}  ${usd(bg.mdd).padStart(9)}`);
  console.log("");

  console.log(`  ══ VERDICT ══  ARM iff OOS ≥4/5 held-out windows AND MC lifts p5 / cuts maxDD without collapsing p95.`);
  console.log(`  Else PARK (one-window-carried, not a generalizable gap edge) → collect-forward / paper-lab, don't wire the spec.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
