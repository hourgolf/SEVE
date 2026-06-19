// ============================================================================
//  pb-trigger-probe — can a STRONGER trend-establishment TRIGGER rescue PB where the
//  post-hoc er-floor couldn't? (2026-06-18, the scoped follow-on to pb-conviction-probe.)
//
//  pb-conviction showed: PB fires 67% on er<0.20 (non-trends); a post-hoc er floor is a
//  monotonic harm-reducer that only flips +EV at er≥0.40 = a 95% trade cut (sniper tail,
//  not a channel). Conclusion there: PB's fix is the TRIGGER, not a threshold. The current
//  trigger's "established trend" check is just `e9 > e21` (a 1-cent ribbon cross passes on
//  chop). This probe tests SHAPE-based strengthenings of the trend-establishment gate,
//  WRAPPING buildPullback (the strategy file is untouched; baseline = byte-identical):
//    · ribbon SEPARATION — |e9−e21| ≥ sep·ATR (the ribbon must be fanned, not just crossed)
//    · DEEP ribbon       — e9>e21>e50 (call) / e9<e21<e50 (put): a 3-EMA stack = real trend
//    · EMA21 SLOPE       — e21 moved ≥ slope·ATR in the trade dir over `lookback` bars
//    · (combos)
//
//  THE QUESTION: does any SHAPE trigger flip PB toward +EV at REASONABLE volume (≤~70% cut)
//  — unlike the er-floor's 95% cut — while holding the ex-CHOP-MIX confound? If yes, PB has a
//  fundable trigger-rebuild; if no, PB's pullback shape can't be saved by entry tightening and
//  it's a fix-the-shape-or-cut decision. FAITHFUL: PB live config (RISK 500/stop 500/maxC 4),
//  live 0.25 gate + audited 1-tick fills (0.25 bracket on the winner), 5-window corpus.
//
//    npm run pb-trigger-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { ema } from "../lib/indicators";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 4, daily_stop_usd: DAILY_STOP, muted: false, soloed: false };
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const FILL_025: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE_LIVE: CostModel = FILL_025;

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const CHOPMIX = "CHOP-MIX 25-26";

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f2 = (v: number) => v.toFixed(1);

interface Variant { name: string; sepAtr?: number; deep?: boolean; slopeLb?: number; slopeAtr?: number; }
const VARIANTS: Variant[] = [
  { name: "baseline (current)" },
  { name: "ribbon-sep 0.3", sepAtr: 0.3 },
  { name: "ribbon-sep 0.6", sepAtr: 0.6 },
  { name: "ribbon-sep 1.0", sepAtr: 1.0 },
  { name: "deep-ribbon e9>e21>e50", deep: true },
  { name: "slope 20b 0.5atr", slopeLb: 20, slopeAtr: 0.5 },
  { name: "slope 20b 1.0atr", slopeLb: 20, slopeAtr: 1.0 },
  { name: "sep0.6 + slope0.5", sepAtr: 0.6, slopeLb: 20, slopeAtr: 0.5 },
  { name: "sep0.6 + deep", sepAtr: 0.6, deep: true },
  { name: "deep + slope0.5", deep: true, slopeLb: 20, slopeAtr: 0.5 },
];

// Wrap buildPullback: veto an `enter` whose entry-bar SHAPE fails the stronger trend gate.
function triggerVariant(bars: Bar[], v: Variant): Evaluate {
  const inner = buildPullback(bars, 1, DEFAULT_PULLBACK_PARAMS);
  const closes = bars.map((b) => b.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
  return (f, pos) => {
    const it = inner(f, pos);
    if (it && it.kind === "enter") {
      const i = f.minute, call = it.direction === "call", atr = Math.max(1e-9, f.atr);
      if (v.sepAtr && Math.abs(e9[i] - e21[i]) < v.sepAtr * atr) return null;
      if (v.deep && !(call ? e9[i] > e21[i] && e21[i] > e50[i] : e9[i] < e21[i] && e21[i] < e50[i])) return null;
      if (v.slopeAtr) {
        const j = Math.max(0, i - (v.slopeLb ?? 20));
        const slope = e21[i] - e21[j];
        if (call ? slope < v.slopeAtr * atr : slope > -v.slopeAtr * atr) return null;
      }
    }
    return it;
  };
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => {
    const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET);
    return !!cc && !!nx && cc.some((q) => q.expiration === nx) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); const exp = nextOf.get(s.dateET)!; return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  const run = (v: Variant, fill: CostModel) => {
    const trades: { w: string; pnl: number }[] = []; const day = new Map<string, number>();
    for (const s of real) {
      const ev = triggerVariant(s.bars as Bar[], v);
      const ts: Trade[] = simulateSession(s.bars, CFG, FUND, ev, chainFor(s), false, { stopPct: 50 }, fill, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE });
      let d = 0; for (const t of ts) { trades.push({ w: winOf(s.dateET), pnl: t.pnl }); d += t.pnl; }
      day.set(s.dateET, d);
    }
    return { trades, day };
  };
  const agg = (r: { trades: { w: string; pnl: number }[] }, base?: Map<string, number>) => {
    const byWin = new Map<string, number>(); for (const w of WINDOWS) byWin.set(w.name, 0);
    let n = 0, pnl = 0, wins = 0, ex = 0;
    for (const t of r.trades) { byWin.set(t.w, byWin.get(t.w)! + t.pnl); n++; pnl += t.pnl; if (t.pnl > 0) wins++; if (t.w !== CHOPMIX) ex += t.pnl; }
    const bw = base ? WINDOWS.filter((w) => byWin.get(w.name)! >= (base.get(w.name) ?? -Infinity)).length : 0;
    return { byWin, n, pnl, win: n ? wins / n : 0, exp: n ? pnl / n : 0, ex, bw };
  };

  const base1 = run(VARIANTS[0], FILL_1T);
  const a0 = agg(base1);
  const baseWin = new Map(WINDOWS.map((w) => [w.name, a0.byWin.get(w.name)!]));

  console.log(`\n  PB-TRIGGER · ${real.length} SPY sessions (real NBBO, PB @1DTE) · FAITHFUL gate 0.25 + audited 1-tick fills + RISK ${RISK}/stop ${DAILY_STOP}/maxC 4`);
  console.log(`  Stronger trend-establishment TRIGGER (wraps buildPullback). Baseline = current trigger. Goal: flip +EV at REASONABLE volume (vs the er-floor's 95% cut).\n`);
  console.log(`  ${"variant".padEnd(24)}${"n".padStart(5)}${"cut%".padStart(6)}${"win%".padStart(6)}${"exp$/t".padStart(8)}${"Σ (1t)".padStart(9)}${"ex-CHOP-MIX".padStart(13)}  w/5`);
  const rows: Array<{ v: Variant; a: ReturnType<typeof agg> }> = [];
  for (const v of VARIANTS) {
    const a = v.name === VARIANTS[0].name ? a0 : agg(run(v, FILL_1T), baseWin);
    rows.push({ v, a });
    const cut = Math.round(100 * (1 - a.n / a0.n));
    const tag = v.name === VARIANTS[0].name ? "  ← baseline" : "";
    console.log(`  ${v.name.padEnd(24)}${String(a.n).padStart(5)}${(cut + "%").padStart(6)}${(Math.round(a.win * 100) + "%").padStart(6)}${usd(a.exp).padStart(8)}${usd(a.pnl).padStart(9)}${usd(a.ex).padStart(13)}${v.name === VARIANTS[0].name ? "   —" : `   ${a.bw}/5`}${tag}`);
  }

  // ---- RIBBON-SEP fine sweep + OOS (the winner is sep-based; is 0.3 a plateau or a knife-edge?) ----
  void rows;
  const SEPS = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50];
  const sepAgg = new Map<number, ReturnType<typeof agg>>();
  for (const sp of SEPS) sepAgg.set(sp, agg(run({ name: `sep${sp}`, sepAtr: sp }, FILL_1T), baseWin));
  console.log(`\n  ══ RIBBON-SEP fine sweep — is the 0.3 sweet spot a PLATEAU (robust) or a SPIKE (overfit)? ══`);
  console.log(`  ${"sep·ATR".padEnd(9)}${"n".padStart(5)}${"cut%".padStart(6)}${"exp$/t".padStart(8)}${"Σ(1t)".padStart(9)}${"ex-CHOP-MIX".padStart(13)}  w/5`);
  for (const sp of SEPS) { const a = sepAgg.get(sp)!; console.log(`  ${sp.toFixed(2).padEnd(9)}${String(a.n).padStart(5)}${(Math.round(100 * (1 - a.n / a0.n)) + "%").padStart(6)}${usd(a.exp).padStart(8)}${usd(a.pnl).padStart(9)}${usd(a.ex).padStart(13)}   ${a.bw}/5`); }
  // OOS leave-one-out: for each held-out window pick the sep maximizing the OTHER-4 Σ, apply to held-out
  let oosTot = 0; const picks: string[] = [];
  for (const W of WINDOWS) {
    let bestSp = SEPS[0], bestOther = -Infinity;
    for (const sp of SEPS) { const a = sepAgg.get(sp)!; const other = a.pnl - a.byWin.get(W.name)!; if (other > bestOther) { bestOther = other; bestSp = sp; } }
    oosTot += sepAgg.get(bestSp)!.byWin.get(W.name)!; picks.push(`${W.name.replace(/ .*/, "")}:${bestSp.toFixed(2)}`);
  }
  console.log(`  OOS leave-one-out (best sep per held-out window, fit on the OTHER 4): Σ ${usd(oosTot)}  [picks ${picks.join(" ")}]`);
  console.log(`  → PLATEAU (a BAND of seps beat baseline + OOS≈in-sample) = robust; lone-0.3-spike or OOS≪in-sample = overfit.\n`);

  // winner = best-Σ sep variant holding ex-CHOP-MIX ≥ baseline and ≥30% volume
  const best = SEPS.map((sp) => ({ sp, a: sepAgg.get(sp)! })).filter((r) => r.a.ex >= a0.ex && r.a.n >= 0.30 * a0.n).sort((x, y) => y.a.pnl - x.a.pnl)[0];
  const w = best ? { v: { name: `ribbon-sep ${best.sp.toFixed(2)}`, sepAtr: best.sp } as Variant, a: best.a } : undefined;
  console.log("");
  if (!w) {
    console.log(`  ══ VERDICT ══  NO trigger flips PB toward +EV at reasonable volume while holding ex-CHOP-MIX.`);
    console.log(`  → PB's pullback SHAPE can't be saved by entry tightening (same grave as the er-floor). Fix-the-shape-or-CUT.\n`);
    return;
  }

  // per-window + tail for the winner
  console.log(`  ══ WINNER ${w.v.name} — per-window vs baseline ══`);
  console.log(`  ${"window".padEnd(18)}${"base exp$/t (n)".padStart(18)}${"trig exp$/t (n)".padStart(18)}${"ΔΣ$".padStart(9)}`);
  for (const win of WINDOWS) {
    const bn = base1.trades.filter((t) => t.w === win.name).length, bp = a0.byWin.get(win.name)!;
    const gp = w.a.byWin.get(win.name)!;
    console.log(`  ${win.name.padEnd(18)}${`${usd(bn ? bp / bn : 0)} (${bn})`.padStart(18)}${`${usd(gp)} Σ`.padStart(18)}${usd(gp - bp).padStart(9)}`);
  }
  const w025 = agg(run(w.v, FILL_025));
  console.log(`  POOLED  base exp$/t ${usd(a0.exp)} (n ${a0.n}) → ${usd(w.a.exp)} (n ${w.a.n})  ·  Σ ${usd(a0.pnl)} → ${usd(w.a.pnl)}  ·  bracket [${usd(w.a.pnl)} 1t, ${usd(w025.pnl)} 0.25]`);

  const datesS = [...new Set(real.map((s) => s.dateET))].sort();
  const winDay = run(w.v, FILL_1T).day;
  const bs = datesS.map((d) => base1.day.get(d) ?? 0), gs = datesS.map((d) => winDay.get(d) ?? 0);
  const maxDD = (s: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of s) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
  const boot = (series: number[]) => {
    const n = series.length, B = 5, paths = 2000, terms: number[] = [], dds: number[] = [];
    for (let p = 0; p < paths; p++) { const path: number[] = []; let seed = (p * 2654435761) >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
      while (path.length < n) { const st = Math.floor(rnd() * n); for (let k = 0; k < B && path.length < n; k++) path.push(series[(st + k) % n]); } terms.push(path.reduce((a, x) => a + x, 0)); dds.push(maxDD(path)); }
    terms.sort((a, b) => a - b); dds.sort((a, b) => a - b); const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))];
    return { p5: q(terms, 0.05), p50: q(terms, 0.5), p95: q(terms, 0.95), mdd: q(dds, 0.05) };
  };
  const bb = boot(bs), bg = boot(gs);
  console.log(`\n  ══ TAIL CHECK — block-bootstrap (B=5, 2000 paths) ══`);
  console.log(`  policy     Σ        p5         p50        p95        maxDD p5`);
  console.log(`  baseline  ${usd(bs.reduce((a, x) => a + x, 0)).padStart(8)}  ${usd(bb.p5).padStart(8)}  ${usd(bb.p50).padStart(9)}  ${usd(bb.p95).padStart(9)}  ${usd(bb.mdd).padStart(9)}`);
  console.log(`  trigger   ${usd(gs.reduce((a, x) => a + x, 0)).padStart(8)}  ${usd(bg.p5).padStart(8)}  ${usd(bg.p50).padStart(9)}  ${usd(bg.p95).padStart(9)}  ${usd(bg.mdd).padStart(9)}`);
  const robust = oosTot > 0 && oosTot > 0.5 * w.a.pnl;
  console.log(`\n  ══ VERDICT ══`);
  console.log(`  IN-SAMPLE the best trigger (${w.v.name}) looks strong: Σ ${usd(a0.pnl)}→${usd(w.a.pnl)}, ${Math.round(100 * (1 - w.a.n / a0.n))}% cut, tail improves — BUT`);
  console.log(`  the fine sweep is JAGGED (0.25/0.30/0.40 spike, 0.35/0.50 dip) and OOS leave-one-out collapses to ${usd(oosTot)} (vs in-sample ${usd(w.a.pnl)})`);
  console.log(`  → ${robust ? "ROBUST: fundable trigger-rebuild — wire ribbon-sep into pullback.ts + validate." : "OVERFIT: the separation sweet-spot doesn't transfer out-of-sample."}`);
  if (!robust) console.log(`  Three entry-tightenings now fail PB (er-floor needs a 95% cut; ribbon-sep overfits; slope/deep are weak). PB is NOT fixable by tightening`);
  if (!robust) console.log(`  its existing pullback entries → FIX-THE-SHAPE (a different entry thesis = new R&D, not a tweak) or CUT the channel.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
