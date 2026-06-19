// ============================================================================
//  pb-conviction-probe — does a PER-ENTRY trend-strength FLOOR rescue PB?
//  (2026-06-18.) Motivation: on the 06-18 flat-but-whippy tape PB fired a PUT at
//  er 0.15 then a CALL at er 0.03 fifty-one minutes apart — a "pullback in a
//  trend" with no trend. PB's only live conviction gate is the COST gate (premium
//  efficiency), which is BLIND to whether a trend exists. This probe adds the
//  missing axis: an entry floor on `er` (efficiency ratio, 0=chop 1=clean trend)
//  and `relVol` (volume expansion) — both already on the Features the evaluator
//  reads, both logged in the live signal rationale. The gate WRAPS the pullback
//  evaluator (suppress an `enter` when er<floor or relVol<floor); the strategy
//  file is untouched.
//
//  WHY THIS AXIS AND NOT THE DEAD ONES (don't re-litigate):
//   · cost-gate / EV-margin tightening is INVERTED for ride channels (high
//     evMargin = high vol = worse) — [[conviction-sizing-roadmap]]. NOT this.
//   · gap-magnitude conviction REFUTED — [[gap-regime-verdict]]. NOT this.
//   · a MORNING regime-mute (drift+persistence) FAILED OOS 3/5 —
//     [[pb-regime-mute]]. This is its PER-ENTRY cousin (different granularity).
//   PB has NO convex tail ([[compound-vs-ride]]) so filtering entries costs no
//   upside — the one thing that makes a floor low-risk to try.
//
//  GAUNTLET (the standard bar): the floor must (1) raise exp$/TRADE, not just cut
//  trade count to shrink a -EV book (the mechanical-vs-real tell); (2) survive the
//  ex-CHOP-MIX confound (profit that vanishes without the CHOP-MIX-25-26 window is
//  a rising tide, fingerprint #1); (3) help across windows, not rescue-the-worst;
//  (4) improve the block-bootstrap tail (lower DD / higher p5) without gutting the
//  trend windows. FAITHFUL config throughout: live 0.25-tick gate + audited 1-tick
//  fills (0.25 bracket on the winner) + RISK 500 / daily-stop 500 / maxC 4.
//
//    npm run pb-conviction-probe
//  Real Databento NBBO, PB @1DTE, the 5-window corpus.
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

// FAITHFUL live knobs (strategist_config 2026-06-18: pb-ride armed RISK 500 /
// daily_stop 500 / max_contracts 4 / entry_dte 1). RISK → engine budget total = 2×risk.
const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 4, daily_stop_usd: DAILY_STOP, muted: false, soloed: false };
// fill = slippage the P&L pays (1-tick audited / 0.25 optimistic = a bracket);
// gate = slippage the 3× cost gate uses to decide (live worker = 0.25, decide.ts).
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

const ER_FLOORS = [0, 0.10, 0.20, 0.30, 0.40];
const RV_FLOORS = [0, 1.0, 1.3];

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f2 = (v: number) => v.toFixed(2);

// The conviction-gated evaluator: run the real pullback evaluator, but veto an
// `enter` whose entry-bar er/relVol is below the floor. `rec` optionally captures
// the (er, relVol) of every WANTED entry (pre-cost-gate) for the distribution cut.
function gatedPullback(bars: Bar[], erFloor: number, rvFloor: number, rec?: { er: number; rv: number }[]): Evaluate {
  const inner = buildPullback(bars, 1, DEFAULT_PULLBACK_PARAMS);
  return (f, pos) => {
    const it = inner(f, pos);
    if (it && it.kind === "enter") {
      if (rec) rec.push({ er: f.er, rv: f.relVol });
      if (f.er < erFloor || f.relVol < rvFloor) return null;
    }
    return it;
  };
}

interface ComboResult { trades: { w: string; pnl: number }[]; day: Map<string, number>; }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  // PB is 1DTE → require the NEXT session's expiry present. 5-window corpus.
  const real = sessions.filter((s) => {
    const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET);
    return !!cc && !!nx && cc.some((q) => q.expiration === nx) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); const exp = nextOf.get(s.dateET)!; return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  const runCombo = (erFloor: number, rvFloor: number, fill: CostModel, rec?: { er: number; rv: number }[]): ComboResult => {
    const trades: { w: string; pnl: number }[] = [];
    const day = new Map<string, number>();
    for (const s of real) {
      const ev = gatedPullback(s.bars as Bar[], erFloor, rvFloor, rec);
      const ts: Trade[] = simulateSession(s.bars, CFG, FUND, ev, chainFor(s), false, { stopPct: 50 }, fill, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE });
      let d = 0;
      for (const t of ts) { trades.push({ w: winOf(s.dateET), pnl: t.pnl }); d += t.pnl; }
      day.set(s.dateET, d);
    }
    return { trades, day };
  };

  // per-window + pooled + ex-CHOP-MIX + exp$/t aggregates for a combo result
  const agg = (r: ComboResult) => {
    const byWin = new Map<string, { n: number; pnl: number }>();
    for (const w of WINDOWS) byWin.set(w.name, { n: 0, pnl: 0 });
    let n = 0, pnl = 0, wins = 0, exNpnl = 0;
    for (const t of r.trades) {
      const b = byWin.get(t.w)!; b.n++; b.pnl += t.pnl;
      n++; pnl += t.pnl; if (t.pnl > 0) wins++;
      if (t.w !== CHOPMIX) exNpnl += t.pnl;
    }
    return { byWin, n, pnl, win: n ? wins / n : 0, exp: n ? pnl / n : 0, exChopMix: exNpnl };
  };

  console.log(`\n  PB-CONVICTION · ${real.length} SPY sessions (real NBBO, PB @1DTE) · FAITHFUL gate 0.25 + audited 1-tick fills + RISK ${RISK}/stop ${DAILY_STOP}/maxC 4`);
  console.log(`  Gate = a per-entry floor on er (trend strength) and/or relVol (volume expansion). Baseline = no floor = today's PB.\n`);

  // ---- (0) BASELINE + the er/relVol distribution of WANTED entries ----
  const rec: { er: number; rv: number }[] = [];
  const base1 = runCombo(0, 0, FILL_1T, rec);
  const base025 = runCombo(0, 0, FILL_025);
  const a0 = agg(base1), a0b = agg(base025);
  console.log(`  ══ (0) BASELINE — faithful PB, NO conviction floor ══`);
  console.log(`  window               n    exp$/t      Σ$`);
  for (const w of WINDOWS) { const b = a0.byWin.get(w.name)!; console.log(`  ${w.name.padEnd(18)} ${String(b.n).padStart(4)}   ${usd(b.n ? b.pnl / b.n : 0).padStart(7)}   ${usd(b.pnl).padStart(8)}`); }
  console.log(`  POOLED  n ${a0.n}  win ${(a0.win * 100).toFixed(0)}%  exp$/t ${usd(a0.exp)}  Σ ${usd(a0.pnl)}  ·  ex-CHOP-MIX ${usd(a0.exChopMix)}  ·  fill bracket [${usd(a0.pnl)} 1t, ${usd(a0b.pnl)} 0.25]`);
  const ers = rec.map((x) => x.er).sort((a, b) => a - b), rvs = rec.map((x) => x.rv).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr.length ? arr[Math.floor(p * (arr.length - 1))] : NaN;
  const frac = (arr: number[], thr: number) => arr.length ? arr.filter((x) => x < thr).length / arr.length : 0;
  console.log(`  entry er    p10 ${f2(pct(ers, 0.1))}  p25 ${f2(pct(ers, 0.25))}  p50 ${f2(pct(ers, 0.5))}  p75 ${f2(pct(ers, 0.75))}   ·  share er<0.20 = ${(frac(ers, 0.20) * 100).toFixed(0)}%  er<0.30 = ${(frac(ers, 0.30) * 100).toFixed(0)}%`);
  console.log(`  entry relVol p10 ${f2(pct(rvs, 0.1))}  p25 ${f2(pct(rvs, 0.25))}  p50 ${f2(pct(rvs, 0.5))}  p75 ${f2(pct(rvs, 0.75))}   ·  share relVol<1.0 = ${(frac(rvs, 1.0) * 100).toFixed(0)}%\n`);

  // ---- (1) THE SWEEP — er × relVol floors (audited 1-tick fill) ----
  console.log(`  ══ (1) SWEEP — er_floor × relVol_floor (audited 1-tick fill; baseline exp$/t ${usd(a0.exp)}, Σ ${usd(a0.pnl)}) ══`);
  console.log(`  erFloor  rvFloor   n    win%   exp$/t    Σ$        ΔΣ vs base   ex-CHOP-MIX   win/5`);
  type Row = { erF: number; rvF: number; a: ReturnType<typeof agg>; betterWins: number };
  const rows: Row[] = [];
  for (const erF of ER_FLOORS) for (const rvF of RV_FLOORS) {
    if (erF === 0 && rvF === 0) { rows.push({ erF, rvF, a: a0, betterWins: 0 }); }
    else {
      const a = agg(runCombo(erF, rvF, FILL_1T));
      let bw = 0; for (const w of WINDOWS) if ((a.byWin.get(w.name)!.pnl) >= (a0.byWin.get(w.name)!.pnl)) bw++;
      rows.push({ erF, rvF, a, betterWins: bw });
    }
  }
  for (const r of rows) {
    const tag = r.erF === 0 && r.rvF === 0 ? "  ← baseline" : "";
    console.log(`  ${f2(r.erF)}     ${f2(r.rvF)}    ${String(r.a.n).padStart(4)}  ${(r.a.win * 100).toFixed(0).padStart(3)}%  ${usd(r.a.exp).padStart(7)}  ${usd(r.a.pnl).padStart(8)}   ${usd(r.a.pnl - a0.pnl).padStart(8)}    ${usd(r.a.exChopMix).padStart(8)}    ${r.erF === 0 && r.rvF === 0 ? "—" : `${r.betterWins}/5`}${tag}`);
  }

  // ARMABLE winner: max exp$/t among combos that (a) beat baseline exp$/t, (b) hold
  // ex-CHOP-MIX, (c) help ≥3/5 windows, AND (d) trade ≥ MIN_N (no sub-sample noise crowns
  // — a 4-trade combo with a huge exp$/t is overfit, not an edge). `thin` = the most-sampled
  // POSITIVE combo regardless of MIN_N (the high-conviction tail to inspect / collect-forward).
  const MIN_N = 30;
  const passing = rows.filter((r) => !(r.erF === 0 && r.rvF === 0) && r.a.exp > a0.exp && r.a.exChopMix >= a0.exChopMix && r.betterWins >= 3);
  const armable = [...passing].filter((r) => r.a.n >= MIN_N).sort((x, y) => y.a.exp - x.a.exp)[0];
  // thin = best-SAMPLED combo that still passed the rising-tide + breadth filters (NOT just any
  // positive combo — a large-n positive that fails ex-CHOP-MIX is a CHOP-MIX-carried mirage).
  const thin = [...passing].sort((x, y) => y.a.n - x.a.n)[0];
  const focus = armable ?? thin; // armable if one exists; else the best-sampled robust tail
  console.log("");

  if (!focus) {
    console.log(`  ══ VERDICT ══  NO floor produces a positive book at ANY threshold — the floor joins the entry-filter graveyard for PB.\n`);
    return;
  }
  const armed = !!armable;

  // ---- (2) PER-WINDOW — focus combo vs baseline ----
  const hdr = armed ? `ARMABLE WINNER (n≥${MIN_N})` : `BEST POSITIVE TAIL — n=${focus.a.n} < ${MIN_N}, sample too thin to wire (collect-forward)`;
  console.log(`  ══ (2) ${hdr}: er≥${f2(focus.erF)} relVol≥${f2(focus.rvF)} — per-window vs baseline ══`);
  console.log(`  window               base exp$/t (n)      gated exp$/t (n)      ΔΣ$      better?`);
  for (const w of WINDOWS) {
    const b = a0.byWin.get(w.name)!, g = focus.a.byWin.get(w.name)!;
    console.log(`  ${w.name.padEnd(18)} ${`${usd(b.n ? b.pnl / b.n : 0)} (${b.n})`.padStart(16)}   ${`${usd(g.n ? g.pnl / g.n : 0)} (${g.n})`.padStart(16)}   ${usd(g.pnl - b.pnl).padStart(7)}   ${g.pnl >= b.pnl ? "✓" : "✗"}`);
  }
  const win025 = agg(runCombo(focus.erF, focus.rvF, FILL_025));
  console.log(`  POOLED  base exp$/t ${usd(a0.exp)} (n ${a0.n}) → gated ${usd(focus.a.exp)} (n ${focus.a.n})  ·  Σ ${usd(a0.pnl)} → ${usd(focus.a.pnl)}  ·  fill bracket [${usd(focus.a.pnl)} 1t, ${usd(win025.pnl)} 0.25]`);
  if (!armed) console.log(`  ⚠ no combo is BOTH positive AND ≥${MIN_N} trades — PB only flips +EV by cutting to a ${focus.a.n}-trade sniper tail (${(100 * (1 - focus.a.n / a0.n)).toFixed(0)}% of the book gone). That is overfit territory, not a volume channel.`);
  console.log("");

  // ---- (3) TAIL CHECK — block-bootstrap the daily series, baseline vs focus ----
  const datesS = [...new Set(real.map((s) => s.dateET))].sort();
  const winnerDay = runCombo(focus.erF, focus.rvF, FILL_1T).day;
  const baseSeries = datesS.map((d) => base1.day.get(d) ?? 0);
  const gateSeries = datesS.map((d) => winnerDay.get(d) ?? 0);
  const maxDD = (s: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of s) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
  const boot = (series: number[]) => {
    const n = series.length, B = 5, paths = 2000, terms: number[] = [], dds: number[] = [];
    for (let p = 0; p < paths; p++) {
      const path: number[] = []; let seed = (p * 2654435761) >>> 0;
      const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
      while (path.length < n) { const start = Math.floor(rnd() * n); for (let k = 0; k < B && path.length < n; k++) path.push(series[(start + k) % n]); }
      terms.push(path.reduce((a, x) => a + x, 0)); dds.push(maxDD(path));
    }
    terms.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.floor(p * (arr.length - 1))];
    return { p5: q(terms, 0.05), p50: q(terms, 0.5), p95: q(terms, 0.95), mddP5: q(dds, 0.05) };
  };
  const bb = boot(baseSeries), bg = boot(gateSeries);
  console.log(`  ══ (3) TAIL CHECK — block-bootstrap (B=5, 2000 paths) of the daily PB series ══`);
  console.log(`  policy       Σ realized    p5 terminal   p50 terminal   p95 terminal   maxDD p5 (worst)`);
  console.log(`  baseline    ${usd(baseSeries.reduce((a, x) => a + x, 0)).padStart(9)}   ${usd(bb.p5).padStart(9)}   ${usd(bb.p50).padStart(10)}   ${usd(bb.p95).padStart(10)}   ${usd(bb.mddP5).padStart(10)}`);
  console.log(`  conviction  ${usd(gateSeries.reduce((a, x) => a + x, 0)).padStart(9)}   ${usd(bg.p5).padStart(9)}   ${usd(bg.p50).padStart(10)}   ${usd(bg.p95).padStart(10)}   ${usd(bg.mddP5).padStart(10)}`);
  console.log(`  → the floor must lift p5 / cut maxDD WITHOUT collapsing p95 (PB has no convex tail, so p95 erosion = it cut real winners).\n`);

  console.log(`  ══ VERDICT SCAFFOLD ══`);
  console.log(`  focus er≥${f2(focus.erF)} relVol≥${f2(focus.rvF)}: exp$/t ${usd(a0.exp)}→${usd(focus.a.exp)}, Σ ${usd(a0.pnl)}→${usd(focus.a.pnl)} (bracket [${usd(focus.a.pnl)},${usd(win025.pnl)}]), helps ${focus.betterWins}/5, ex-CHOP-MIX ${usd(a0.exChopMix)}→${usd(focus.a.exChopMix)}, n ${a0.n}→${focus.a.n}.`);
  console.log(armed
    ? `  ARMABLE: ≥${MIN_N} trades AND positive AND robust. Graduate to paper-lab, live-observe before wiring.`
    : `  NOT ARMABLE: the only positive books are sniper tails (n<${MIN_N}). The er floor is a real but MONOTONIC harm-reducer — it reveals PB fires mostly on non-trends, but cutting the bleed never yields a +EV book at volume. PB's fix is the TRIGGER (demand trend in the shape), not a post-hoc threshold. Collect-forward the high-er tail.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
