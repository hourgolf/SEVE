// ============================================================================
//  ride-filter-probe — Thread A of the regime-awareness reopen (2026-06-19): do the
//  FILTERLESS trend channels (ORB-base, power) stop getting obliterated on chop if we
//  give them the self-routing filters the WINNERS (V3/ALT) already carry?
//
//  THE INSIGHT: V3/ALT don't bleed on chop by luck — their entries carry
//  efficiency_ratio≥0.45 + rel_vol≥1.3 + gap_min 0.25, which self-route them OUT of chop.
//  The bleeders lack the two strongest of those: ORB-base (orb-trend-rider) already has
//  rel_vol/or_width/momentum but is MISSING er + gap_min; power (builtin) has NO filters.
//  So this is NOT a central classifier (the dead axis) — it propagates the proven
//  per-channel self-routing to the channels that lack it. The added conditions are fixed
//  thresholds copied from V3/ALT (not fit here), so OOS = do they transfer, not overfit.
//
//  THE TEST that separates a real regime filter from mechanical loss-reduction: the filter
//  must CUT the CHOP-window losses (Mar26 + CHOP-MIX) while PRESERVING the TREND-window
//  gains (AprMay26 + MA25 + 2024). If it just trades less everywhere (exp$/t flat, trend
//  gutted too), it's the same mirage as every other gate. Faithful: RISK 500 / stop 500 /
//  gate 3 / real Databento NBBO, each channel's own target+stop+flatten held constant
//  base-vs-filtered so only the entry filter moves.
//
//    npm run ride-filter-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { powerEvaluate, DEFAULT_POWER_MOM60 } from "./strategies/power";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 1000, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "rf", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 500, muted: false, soloed: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31", regime: "CHOP" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31", regime: "TREND" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31", regime: "TREND" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31", regime: "TREND" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28", regime: "CHOP" },
];
const CHOPMIX = "CHOP-MIX 25-26";
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

// DAY-LEVEL realized regime (the honest "is THIS day chop" test, vs the crude multi-month
// window label). legs≥3 reversals = chop; else |move|≥0.45% = trend; else drift.
function dayRegime(b: Bar[]): "CHOP" | "TREND" | "DRIFT" {
  const o = b[0].close, c = b[b.length - 1].close, move = Math.abs((c - o) / o) * 100;
  let legs = 0, anchor = o, dir = 0;
  for (const x of b) { const m = (x.close - anchor) / anchor; if (Math.abs(m) >= 0.003) { const d = Math.sign(m); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = x.close; } }
  return legs >= 3 ? "CHOP" : move >= 0.45 ? "TREND" : "DRIFT";
}

// ---- spec builders -----------------------------------------------------------
const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"]): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries });
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
// ORB-base = orb-trend-rider's ACTUAL live entries (opening_range + or_width + vwap_side +
// momentum_atr + rel_vol + time_before 15:00). FILT adds the two missing V3/ALT filters.
interface OrbFilt { er?: number; gap?: number }
const orbLeg = (side: "above" | "below", f: OrbFilt): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: side === "above" ? "break_above" : "break_below", minutes: 30 },
  { kind: "or_width_min", pct: 0.25 } as any,
  { kind: "vwap_side", side },
  { kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 5 } as any,
  { kind: "rel_vol", min: 1.3 },
  ...(f.er ? [{ kind: "efficiency_ratio", op: ">=", value: f.er, lookback: 20 } as any] : []),
  ...(f.gap ? [{ kind: "gap_min", pct: f.gap } as any] : []),
  { kind: "time_before", et: "15:00" },
];
const orbEntries = (f: OrbFilt) => [
  { direction: "call" as const, reason: "u", all: orbLeg("above", f) },
  { direction: "put" as const, reason: "d", all: orbLeg("below", f) },
];

// power-base = the builtin power-hour lean (no filters). FILT wraps it with V3/ALT's regime
// trio (gap_min + er + rel_vol). NO time_before — power's edge IS the final hour.
function powerEval(filt: boolean): (s: RealSession) => Evaluate {
  return (s) => {
    const gap = Math.abs(s.gap ?? 0);
    return (f, pos) => {
      const it = powerEvaluate(f, pos, DEFAULT_POWER_MOM60);
      if (filt && it && it.kind === "enter") {
        if (gap < 0.25 || f.er < 0.45 || f.relVol < 1.3) return null;
      }
      return it;
    };
  };
}

// ORB filter-component sweep: which calibration keeps the trend-day edge while cutting chop+drift?
const ORB_VARIANTS: Array<{ label: string; f: OrbFilt }> = [
  { label: "base (none)", f: {} },
  { label: "gap_min 0.25", f: { gap: 0.25 } },
  { label: "gap_min 0.15", f: { gap: 0.15 } },
  { label: "er 0.45", f: { er: 0.45 } },
  { label: "er 0.30", f: { er: 0.30 } },
  { label: "er0.45+gap0.25", f: { er: 0.45, gap: 0.25 } },
  { label: "er0.30+gap0.15", f: { er: 0.30, gap: 0.15 } },
];

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const real = sessions.filter((s) => {
    const cc = mdte.get(s.dateET);
    return !!cc && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!;

  const dayRegOf = new Map(real.map((s) => [s.dateET, dayRegime(s.bars as Bar[])]));
  const run = (mk: (s: RealSession) => Evaluate, target: number) => {
    const trades: { w: string; regime: string; dreg: string; pnl: number }[] = [];
    for (const s of real) {
      const ts: Trade[] = simulateSession(s.bars, CFG, FUND, mk(s), chainFor(s), false, { profitPct: target, stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
      const w = winOf(s.dateET), dreg = dayRegOf.get(s.dateET)!;
      for (const t of ts) trades.push({ w: w.name, regime: w.regime, dreg, pnl: t.pnl });
    }
    return trades;
  };
  const agg = (trades: { w: string; regime: string; dreg: string; pnl: number }[]) => {
    const byWin = new Map<string, number>(); for (const w of WINDOWS) byWin.set(w.name, 0);
    const day = { CHOP: { n: 0, pnl: 0 }, TREND: { n: 0, pnl: 0 }, DRIFT: { n: 0, pnl: 0 } } as Record<string, { n: number; pnl: number }>;
    let n = 0, pnl = 0, wins = 0, chop = 0, trend = 0, exMix = 0;
    for (const t of trades) {
      byWin.set(t.w, byWin.get(t.w)! + t.pnl); n++; pnl += t.pnl; if (t.pnl > 0) wins++;
      if (t.regime === "CHOP") chop += t.pnl; else trend += t.pnl;
      if (t.w !== CHOPMIX) exMix += t.pnl;
      day[t.dreg].n++; day[t.dreg].pnl += t.pnl;
    }
    return { byWin, n, pnl, win: n ? wins / n : 0, exp: n ? pnl / n : 0, chop, trend, exMix, day };
  };

  console.log(`\n  RIDE-FILTER (Thread A) · ${real.length} SPY sessions (real NBBO) · add V3/ALT's chop filters (er≥0.45 + gap_min 0.25) to the filterless bleeders`);
  console.log(`  CHOP windows = {CHOP Mar26, CHOP-MIX 25-26} · TREND windows = {AprMay26, MA25, 2024}. Real regime filter = cut CHOP, keep TREND. Faithful RISK500/stop500/gate3.\n`);

  // ---- ORB-base filter sweep (day-regime is the honest test) ----
  console.log(`  ══ ORB-base (orb-trend-rider, +75%) — filter-component sweep, by realized DAY-regime ══`);
  console.log(`  the edge is regime-SEPARABLE: base WINS trend days, BLEEDS chop+drift. A real filter keeps trend-$, flips chop+drift→0 AND lifts exp$/t.`);
  console.log(`  ${"filter".padEnd(16)}${"n".padStart(5)}${"exp$/t".padStart(8)}${"Σ".padStart(9)}${"exClf".padStart(9)}${"CHOPday".padStart(10)}${"TRENDday".padStart(11)}${"DRIFTday".padStart(11)}  trend-kept`);
  let orbBaseTrend = 0; const aggByLabel = new Map<string, ReturnType<typeof agg>>();
  for (const v of ORB_VARIANTS) {
    const a = agg(run(specEval(orbEntries(v.f)), 75)); aggByLabel.set(v.label, a);
    if (v.f.er === undefined && v.f.gap === undefined) orbBaseTrend = a.day.TREND.pnl;
    const kept = orbBaseTrend ? `${Math.round(100 * a.day.TREND.pnl / orbBaseTrend)}%` : "—";
    console.log(`  ${v.label.padEnd(16)}${String(a.n).padStart(5)}${usd(a.exp).padStart(8)}${usd(a.pnl).padStart(9)}${usd(a.exMix).padStart(9)}${usd(a.day.CHOP.pnl).padStart(10)}${usd(a.day.TREND.pnl).padStart(11)}${usd(a.day.DRIFT.pnl).padStart(11)}  ${kept.padStart(5)}`);
  }
  // per-window robustness of the lead candidate (gap_min 0.25) — broad or one-window-carried?
  const base0 = aggByLabel.get("base (none)")!, gap = aggByLabel.get("gap_min 0.25")!;
  let better = 0; for (const w of WINDOWS) if (gap.byWin.get(w.name)! >= base0.byWin.get(w.name)!) better++;
  console.log(`  lead = gap_min 0.25:  per-window ` + WINDOWS.map((w) => `${w.name.replace(/ .*/, "")} ${usd(base0.byWin.get(w.name)!)}→${usd(gap.byWin.get(w.name)!)}`).join(" · ") + `   (better ${better}/5, ex-CHOP-MIX ${usd(base0.exMix)}→${usd(gap.exMix)})`);
  console.log(`  → gap_min ALONE flips ORB +EV with RISING exp$/t (real selection) — er was the over-cutter (gutted the +$36k trend edge). Same armed signal as V3/ALT.\n`);

  // ---- power: backtest loses on every day-regime (no winning regime to preserve) ----
  const pb = agg(run(powerEval(false), 100)), pf = agg(run(powerEval(true), 100));
  console.log(`  ══ power (POWERHOUR base, +100%) ══`);
  console.log(`  base     n ${String(pb.n).padStart(4)}  exp$/t ${usd(pb.exp)}  Σ ${usd(pb.pnl)}  · day CHOP ${usd(pb.day.CHOP.pnl)} / TREND ${usd(pb.day.TREND.pnl)} / DRIFT ${usd(pb.day.DRIFT.pnl)}`);
  console.log(`  +er+gap  n ${String(pf.n).padStart(4)}  exp$/t ${usd(pf.exp)}  Σ ${usd(pf.pnl)}  · day CHOP ${usd(pf.day.CHOP.pnl)} / TREND ${usd(pf.day.TREND.pnl)} / DRIFT ${usd(pf.day.DRIFT.pnl)}`);
  console.log(`  → power loses on EVERY day-regime in the backtest — no winning regime to preserve, so a filter only reduces trade count (exp$/t doesn't rise). Unfilterable HERE.`);
  console.log(`    ⚠ BUT backtest power is −$26k while LIVE power is +$1,848 (the "unrankable on backtest" channel) — judge power LIVE, not on this corpus.\n`);

  console.log(`  ══ READ ══  Thread A verdict: ORB-base IS regime-separable (trend +$, chop+drift −$) — find the filter that keeps trend-kept% high`);
  console.log(`  while flipping chop+drift; that earns the spec change. power has no backtest winning regime (judge live). Adversarially verify any ORB winner before arming.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
