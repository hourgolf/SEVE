// ============================================================================
//  pyramid-probe — "double down as winners win" (the operator's TREND-side lever).
//  (2026-06-16.) compound-vs-ride showed take-profit+redeploy beats RIDE on the channels
//  WITHOUT a convex tail (PB) but LOSES on the clean-trend windows where riding the tail
//  pays. Pyramiding is the complement: ADD to a winning position as it runs (engine
//  `pyramid` param — same contract, never average down, whole stack exits together at the
//  −50%-of-weighted-avg stop). On a REAL tail (V3/ALT, confirmed +EV) adding could be the
//  desk's biggest lever; on PB it targets the trend windows compounding missed.
//
//  ⚠ Pyramiding is the convex bet AMPLIFIED — it fattens the loser when the add bar marks
//  the top. So this reports the TAIL (block-bootstrap p5 + maxDD), not just the mean: a
//  pyramid model must clear the tail, not only pooled Σ (the roadmap's standing discipline).
//
//  FAITHFUL cost (live 0.25 gate + audited 1-tick fills), live sizing (RISK 500/stop 500),
//  308 sessions, each channel at its live DTE.
//
//    npm run pyramid-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const cfgOf = (maxC: number): StrategistConfig => ({ slug: "py", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"], timeET: string) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET }], sizing: {}, entries });
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
const V3 = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", false) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", false) }];
const ALT = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", true) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", true) }];

const CH: Array<{ name: string; dte: 0 | 1; maxC: number; mk: (s: RealSession) => Evaluate }> = [
  { name: "PB RIDER (1DTE)", dte: 1, maxC: 4, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS) },
  { name: "BREAK(ALT V3)", dte: 0, maxC: 6, mk: specEval(V3, "15:25") },
  { name: "BREAK(ALT)", dte: 0, maxC: 6, mk: specEval(ALT, "15:25") },
];
type Pyr = { maxAdds: number; minProfitPct: number } | null;
const CONFIGS: Array<{ lbl: string; pyr: Pyr }> = [
  { lbl: "RIDE", pyr: null },
  { lbl: "+1@20%", pyr: { maxAdds: 1, minProfitPct: 20 } },
  { lbl: "+2@20%", pyr: { maxAdds: 2, minProfitPct: 20 } },
  { lbl: "+2@40%", pyr: { maxAdds: 2, minProfitPct: 40 } },
  { lbl: "+3@30%", pyr: { maxAdds: 3, minProfitPct: 30 } },
];

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const maxDD = (series: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of series) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
// deterministic block bootstrap (B=5) p5 terminal — index-seeded (no Math.random)
const bootP5 = (series: number[]) => {
  const n = series.length, B = 5, paths = 1500, terms: number[] = [];
  for (let p = 0; p < paths; p++) {
    let seed = (p * 2654435761 + 1) >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
    let sum = 0, len = 0; while (len < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < B && len < n; k++) { sum += series[(st + k) % n]; len++; } }
    terms.push(sum);
  }
  terms.sort((a, b) => a - b); return terms[Math.floor(0.05 * (terms.length - 1))];
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET); return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };

  console.log(`\n  PYRAMID-PROBE · ${real.length} SPY sessions (real NBBO) · FAITHFUL (live 0.25 gate + 1-tick fills) · RISK ${RISK}/stop ${DAILY_STOP}`);
  console.log(`  add to winners as they run (same contract, never average down) vs RIDE · Σ P&L (trades) / maxDD / boot-p5\n`);

  for (const ch of CH) {
    const cfg = cfgOf(ch.maxC);
    console.log(`  ${ch.name}`);
    console.log(`    config     Σ P&L (trades)        maxDD       boot-p5     vs RIDE`);
    let rideTot = 0;
    for (const C of CONFIGS) {
      const daily: number[] = []; let tot = 0, n = 0;
      for (const s of real) {
        const exp = ch.dte === 0 ? s.dateET : nextOf.get(s.dateET)!;
        const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), chainFor(s, exp), false, { stopPct: 50 }, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, C.pyr ?? undefined);
        const d = ts.reduce((a, x) => a + x.pnl, 0); daily.push(d); tot += d; n += ts.length;
      }
      if (C.lbl === "RIDE") rideTot = tot;
      const dd = maxDD(daily), p5 = bootP5(daily);
      const vs = C.lbl === "RIDE" ? "" : `${usd(tot - rideTot)}${tot > rideTot ? " ✓" : ""}`;
      console.log(`    ${C.lbl.padEnd(8)} ${`${usd(tot)} (${n}t)`.padStart(18)}   ${usd(dd).padStart(9)}   ${usd(p5).padStart(9)}   ${vs}`);
    }
    console.log("");
  }
  console.log(`  READ: a pyramid config beats RIDE only if Σ is higher AND the tail (maxDD / boot-p5) doesn't blow out.`);
  console.log(`  Expect adds to help where a REAL tail exists (V3/ALT) and to fatten the loser elsewhere. Tail-check is decisive.\n`);

  // ---- PER-WINDOW OOS for V3 (the biggest lever) — regime-wide or one hot window? ----
  const WINDOWS = [
    { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
    { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
    { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
    { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
    { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
  ];
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)?.name ?? null;
  const v3 = CH[1], cfg = cfgOf(v3.maxC);
  const v3Win = (pyr: Pyr) => {
    const by = new Map<string, number>();
    for (const s of real) {
      const w = winOf(s.dateET); if (!w) continue;
      const ts: Trade[] = simulateSession(s.bars, cfg, FUND, v3.mk(s), chainFor(s, s.dateET), false, { stopPct: 50 }, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, pyr ?? undefined);
      by.set(w, (by.get(w) ?? 0) + ts.reduce((a, x) => a + x.pnl, 0));
    }
    return by;
  };
  const ride = v3Win(null), p2 = v3Win({ maxAdds: 2, minProfitPct: 40 }), p3 = v3Win({ maxAdds: 3, minProfitPct: 30 });
  console.log(`  ══ V3 PER-WINDOW — does pyramiding beat RIDE across regimes? ══`);
  console.log(`  window               RIDE       +2@40%      +3@30%    pyramid beats ride?`);
  let wins = 0;
  for (const W of WINDOWS) {
    const r = ride.get(W.name) ?? 0, a = p2.get(W.name) ?? 0, b = p3.get(W.name) ?? 0;
    const beat = a > r && b > r; if (beat) wins++;
    console.log(`  ${W.name.padEnd(18)} ${usd(r).padStart(8)}  ${usd(a).padStart(9)}  ${usd(b).padStart(9)}     ${beat ? "✓ both" : a > r || b > r ? "~ one" : "✗"}`);
  }
  console.log(`  → pyramid beats ride on ${wins}/5 windows (both configs)  ${wins >= 4 ? "· ROBUST — the desk's biggest lever, paper-lab candidate" : "· check the misses"}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
