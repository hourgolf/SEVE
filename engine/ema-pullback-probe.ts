// ============================================================================
//  ema-pullback-probe — the GENERATIVE residue of the EMA-stretch refutation:
//  a NEW strategy shape that monetizes the band-respect pattern the operator
//  reads on the chart. (2026-06-12, the first candidate from the inventory.)
//
//  THESIS: ema-stretch-verdict proved near-band BREAKOUTS are weak breaks (the
//  break is the trigger, proximity = weakness). The pullback-continuation flips
//  the trigger: in an ESTABLISHED trend, wait for price to RETRACE to the band,
//  enter WITH the trend on the bounce — buy the dip, not the stretch. Different
//  conditional population from everything refuted (fade/VWAP-reversion was
//  COUNTER-trend; this is trend-following with entry location).
//
//  PRE-REGISTERED (no sweeping; fixed before first run):
//   trend    = EMA9 vs EMA21 stacked in trade direction (1-min session EMAs)
//   stretch  = directional (close−EMA21)/ATR14 reached ≥ 2.0 within the last 30 bars
//   touch    = |close−EMA21| ≤ 0.5·ATR (the band tag)
//   bounce   = prior bar in the touch zone, this bar closes in trend direction
//   window   = entries 10:00 → 14:00 ET (family-wide 14:xx finding); flatten 15:25
//   exits    = RIDE (−50% premium stop only, the V3 shape) vs SCALP (+0.8·ATR /
//              −0.8·ATR underlying, 15-min time box, the grind shape)
//   volume   = ± bounce-bar relVol ≥ 1.1 (pullback lore: retrace dries, bounce returns)
//   gap rows = the same variants on |gap| ≥ 0.25% days only (catalyst-day subset)
//   live stack: cost gate 3.0 + catastrophic −50% premium stop on everything.
//
//  READ: a NEW shape earns ITERATION (a paper-lab draft, not an arm) if a variant
//  is +EV pooled AND green in ≥3/5 windows. The full 5/5+exp$/t bar still gates
//  any arm. Expect failure — most shapes die; the probe is the point.
//
//    npm run ema-pullback-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { ema } from "../lib/indicators";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, Intent, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const P = {
  stretchMin: 2.0, stretchLookback: 30, touchAtr: 0.5,
  entryStartMin: 30, entryEndMin: 270, // 10:00 → 14:00
  flattenMtc: 35,                       // ≈15:25
  scalpTargetAtr: 0.8, scalpStopAtr: 0.8, scalpTimeBox: 15,
  bounceRelVol: 1.1,
};
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

interface Pre { e9: number[]; e21: number[]; atr: number[]; stretchC: number[]; stretchP: number[] }
export function precompute(s: RealSession): Pre {
  const closes = s.bars.map((b) => b.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  const atr: number[] = [], stretchC: number[] = [], stretchP: number[] = [];
  for (let i = 0; i < s.bars.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 13); j <= i; j++) { sum += s.bars[j].high - s.bars[j].low; n++; }
    const a = Math.max(1e-9, sum / n);
    atr.push(a);
    stretchC.push((closes[i] - e21[i]) / a);
    stretchP.push((e21[i] - closes[i]) / a);
  }
  return { e9, e21, atr, stretchC, stretchP };
}

// Pullback-continuation evaluator. `scalp` toggles the exit family; `needVol`
// the bounce-volume condition. State (per session closure): none needed beyond
// the precomputed arrays — stretch history is read from the arrays directly.
export const makeEval = (pre: Pre, scalp: boolean, needVol: boolean) => (f: Parameters<Evaluate>[0], pos: Parameters<Evaluate>[1]): Intent => {
  const i = f.minute;
  // ---- exits ----
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
    return null; // ride: −50% premium stop + flatten are the only exits
  }
  // ---- entries ----
  if (i < P.entryStartMin || i > P.entryEndMin || i < 22) return null;
  if (f.atr <= 0) return null;
  for (const dir of ["call", "put"] as const) {
    const st = dir === "call" ? pre.stretchC : pre.stretchP;
    if (dir === "call" ? pre.e9[i] <= pre.e21[i] : pre.e9[i] >= pre.e21[i]) continue; // ribbon must stack with trade
    let hadStretch = false;
    for (let j = Math.max(0, i - P.stretchLookback); j < i; j++) if (st[j] >= P.stretchMin) { hadStretch = true; break; }
    if (!hadStretch) continue;
    if (Math.abs(st[i - 1]) > P.touchAtr) continue;                       // prior bar tagged the band
    const closedWithTrend = dir === "call" ? f.mom > 0 : f.mom < 0;        // bounce = with-trend close (mom = close − close[3])
    if (!closedWithTrend) continue;
    if (needVol && f.relVol < P.bounceRelVol) continue;
    return { kind: "enter", direction: dir, reason: scalp ? "pb_scalp" : "pb_ride" };
  }
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

  const run = (scalp: boolean, needVol: boolean, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, makeEval(preOf(s), scalp, needVol), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  const variants: Array<{ name: string; scalp: boolean; vol: boolean; gapOnly: boolean }> = [
    { name: "PB-ride", scalp: false, vol: false, gapOnly: false },
    { name: "PB-ride +vol", scalp: false, vol: true, gapOnly: false },
    { name: "PB-scalp", scalp: true, vol: false, gapOnly: false },
    { name: "PB-scalp +vol", scalp: true, vol: true, gapOnly: false },
    { name: "PB-ride · gap days", scalp: false, vol: false, gapOnly: true },
    { name: "PB-scalp · gap days", scalp: true, vol: false, gapOnly: true },
  ];
  console.log(`\n  EMA PULLBACK-CONTINUATION probe · NEW shape (generative residue of ema-stretch) · real NBBO · ${real.length} SPY sessions`);
  console.log(`  trend=ribbon stack · pullback=touch ≤${P.touchAtr}·ATR of EMA21 after ≥${P.stretchMin}·ATR stretch (${P.stretchLookback}b) · bounce=with-trend close · 10:00→14:00`);
  console.log(`  ITERATION BAR: +EV pooled AND ≥3/5 windows green → paper-lab draft. Arming would need the full 5-window bar.\n`);
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
  console.log(`\n  Generative residue: if the SHAPE works but an exit family doesn't, the surviving family is the draft;`);
  console.log(`  if gap-day rows dominate, the draft inherits gap_min from birth. If all rows die, the band-respect`);
  console.log(`  pattern is fade-bait at 0DTE granularity — bury it with the receipts.\n`);
}

// Run only when executed directly — one-dte-probe imports makeEval/precompute,
// and a bare main() call would re-run this whole probe as an import side effect.
if (process.argv[1]?.includes("ema-pullback-probe")) main().catch((e) => { console.error(e); process.exit(1); });
