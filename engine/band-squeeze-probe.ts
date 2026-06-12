// ============================================================================
//  band-squeeze-probe — generative-inventory candidate #2 (2026-06-12).
//
//  THESIS: when EMA9/EMA21 converge (band width collapses in ATR terms), intraday
//  volatility is COILING; the release tends to continue directionally. Enter the
//  expansion in the ribbon's direction — an opening-range-breakout cousin that
//  isn't anchored to 9:30, so it can catch midday coils the ORB family
//  structurally cannot. (TTM/Bollinger-squeeze family, transplanted to the ribbon.)
//
//  PRE-REGISTERED (fixed before first run; no sweeping):
//   bandWidth = |EMA9 − EMA21| / ATR14 (1-min session EMAs)
//   SQUEEZE   = bandWidth ≤ 0.25 for 10 consecutive bars (the coil)
//   RELEASE   = this bar's bandWidth > 0.25 (edge-triggered by construction —
//               a fire breaks the coil condition until a NEW squeeze forms)
//   DIRECTION = ribbon order at release (close > e9 > e21 → call; mirrored put)
//               + momentum displacement |mom| ≥ 0.3·ATR with the direction
//   window    = entries 10:00 → 14:00 ET · flatten 15:25
//   exits     = RIDE (−50% premium stop only) vs SCALP (±0.8·ATR, 15-min box)
//   variants  = ± release-bar relVol ≥ 1.2 · gap-day (|gap| ≥ 0.25%) subsets
//   live stack: cost gate 3.0 + catastrophic −50% premium stop everywhere.
//
//  ITERATION BAR: +EV pooled AND ≥3/5 windows green → paper-lab draft. Full
//  5-window bar still gates any arm. Expect death; cheap kills are the point.
//
//    npm run band-squeeze-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { ema } from "../lib/indicators";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, Intent, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "sqz", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const P = {
  squeezeAtr: 0.25, squeezeBars: 10, momAtr: 0.3,
  entryStartMin: 30, entryEndMin: 270, flattenMtc: 35,
  scalpTargetAtr: 0.8, scalpStopAtr: 0.8, scalpTimeBox: 15,
  releaseRelVol: 1.2,
};
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

interface Pre { e9: number[]; e21: number[]; bw: number[] } // bw = band width in ATR
function precompute(s: RealSession): Pre {
  const closes = s.bars.map((b) => b.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  const bw: number[] = [];
  for (let i = 0; i < s.bars.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 13); j <= i; j++) { sum += s.bars[j].high - s.bars[j].low; n++; }
    const atr = Math.max(1e-9, sum / n);
    bw.push(Math.abs(e9[i] - e21[i]) / atr);
  }
  return { e9, e21, bw };
}

const makeEval = (pre: Pre, scalp: boolean, needVol: boolean) => (f: Parameters<Evaluate>[0], pos: Parameters<Evaluate>[1]): Intent => {
  const i = f.minute;
  if (pos) {
    if (f.minutesToClose <= P.flattenMtc) return { kind: "exit", reason: "eod_flatten" };
    if (scalp) {
      if (i - pos.entryMinute >= P.scalpTimeBox) return { kind: "exit", reason: "time_stop" };
      if (pos.optType === "call") {
        if (f.close >= pos.entryUnderlying + P.scalpTargetAtr * f.atr) return { kind: "exit", reason: "target" };
        if (f.close <= pos.entryUnderlying - P.scalpStopAtr * f.atr) return { kind: "exit", reason: "stop" };
      } else {
        if (f.close <= pos.entryUnderlying - P.scalpTargetAtr * f.atr) return { kind: "exit", reason: "target" };
        if (f.close >= pos.entryUnderlying + P.scalpStopAtr * f.atr) return { kind: "exit", reason: "stop" };
      }
    }
    return null;
  }
  if (i < P.entryStartMin || i > P.entryEndMin || i < P.squeezeBars + 21) return null;
  if (f.atr <= 0) return null;
  if (pre.bw[i] <= P.squeezeAtr) return null;                              // not released
  for (let j = i - P.squeezeBars; j < i; j++) if (pre.bw[j] > P.squeezeAtr) return null; // coil must be unbroken
  if (needVol && f.relVol < P.releaseRelVol) return null;
  const up = f.close > pre.e9[i] && pre.e9[i] > pre.e21[i] && f.mom >= P.momAtr * f.atr;
  const dn = f.close < pre.e9[i] && pre.e9[i] < pre.e21[i] && f.mom <= -P.momAtr * f.atr;
  if (up) return { kind: "enter", direction: "call", reason: "squeeze_up" };
  if (dn) return { kind: "enter", direction: "put", reason: "squeeze_dn" };
  return null;
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const preBy = new Map<string, Pre>();
  const preOf = (s: RealSession) => { let p = preBy.get(s.dateET); if (!p) { p = precompute(s); preBy.set(s.dateET, p); } return p; };
  const gapOk = (s: RealSession) => s.gap != null && Math.abs(s.gap) >= 0.25;
  const run = (scalp: boolean, vol: boolean, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, makeEval(preOf(s), scalp, vol), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  const variants: Array<{ name: string; scalp: boolean; vol: boolean; gapOnly: boolean }> = [
    { name: "SQZ-ride", scalp: false, vol: false, gapOnly: false },
    { name: "SQZ-ride +vol", scalp: false, vol: true, gapOnly: false },
    { name: "SQZ-scalp", scalp: true, vol: false, gapOnly: false },
    { name: "SQZ-scalp +vol", scalp: true, vol: true, gapOnly: false },
    { name: "SQZ-ride · gap days", scalp: false, vol: false, gapOnly: true },
    { name: "SQZ-ride+vol · gap", scalp: false, vol: true, gapOnly: true },
  ];
  console.log(`\n  BAND-SQUEEZE probe · generative candidate #2 · real NBBO · ${real.length} SPY sessions`);
  console.log(`  coil = |EMA9−EMA21| ≤ ${P.squeezeAtr}·ATR for ${P.squeezeBars} bars · release = width breaks out, ribbon-ordered, |mom| ≥ ${P.momAtr}·ATR · 10:00→14:00`);
  console.log(`  ITERATION BAR: +EV pooled AND ≥3/5 windows green → paper-lab draft. Expect death; cheap kills are the point.\n`);
  console.log(`  variant                exp$/t    n   win%     pooled$` + WINDOWS.map((w) => w.name.slice(0, 11).padStart(13)).join(""));
  for (const v of variants) {
    const base = v.gapOnly ? real.filter(gapOk) : real;
    const all = run(v.scalp, v.vol, base);
    const exp = all.length ? all.reduce((a, t) => a + t.pnl, 0) / all.length : 0;
    const tot = all.reduce((a, t) => a + t.pnl, 0);
    const winPct = all.length ? (100 * all.filter((t) => t.pnl > 0).length) / all.length : 0;
    const per = WINDOWS.map((w) => Math.round(run(v.scalp, v.vol, base.filter((s) => s.dateET >= w.from && s.dateET <= w.to)).reduce((a, t) => a + t.pnl, 0)));
    console.log(`  ${v.name.padEnd(21)} ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%  ${`${sgn(tot)}${Math.round(tot)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(13)).join(""));
  }
  console.log(`\n  Generative residue: a surviving exit family = the draft shape; gap-day dominance = inherits gap_min;`);
  console.log(`  all dead = midday coils don't pay at 0DTE — the ORB anchor (the open's information) was load-bearing.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
