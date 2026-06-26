// conviction-size-probe — the ONE un-refuted conviction-sizing vein (scope in [[conviction-sizing-roadmap]]):
// MACD-hist-ALIGNMENT as a continuous SIZE scalar (a MOMENTUM axis, orthogonal to the vol axis that killed
// gap/evMargin/atr sizing both directions on 06-19). Up-size MACD-aligned entries (histRel>0), down-size
// against. Run at the LIVE config (RISK 2000 / maxC 24) so the scalar has granularity (the $500/6 faithful
// config quantized qty 2-6 → sizing was near-inert, the gap-sizing trap). NO engine change: sizing keeps the
// entry SET fixed (same trades, scaled qty), so we post-scale the flat baseline's qty (capped at maxC); the
// MACD entry-GATE is run faithfully via the existing leverGate (re-entry-aware) for the beat-the-gate guard.
//
// THE 4 GUARDS (each a prior trap): (1) lift EXPECTANCY not just total; (2) MC-tail proxy = maxDD on the daily
// curve (sizing is multiplicative on a convex book); (3) OOS per-window; (4) ⚠ ORTHOGONALITY corr(histRel,
// atr/|gap|)≈0 (else it's vol-sizing-in-disguise = refuted) AND sized must beat the MACD-GATE (else the gate
// already captured it = the gap_min-captured-gap trap).
//   npx tsx --env-file=.env.local engine/conviction-size-probe.ts

import { simulateSession } from "./backtest";
import { macdHistSeries } from "./macd";
import { computeFeatures } from "./engine";
import { V3, ALT, WINDOWS, prep, cfgOf, FILL_1T, GATE_LIVE, RATIO, winOf, specEval, mkGate, usd, type Prepped, type Sym } from "./lever-shared";
import type { FundState } from "./types";

const FUND2000: FundState = { total_capital_usd: 4000, master_daily_stop_usd: 1e9, is_halted: false }; // RISK 2000 (=total/2)
const MAXC = 24;
const px = { profitPct: 100, stopPct: 50 };
const DIRS: Record<string, string> = { SPY: "data/databento-mdte", IWM: "data/databento-mdte-iwm", QQQ: "data/databento-mdte-qqq" };
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const f2 = (v: number) => (Number.isNaN(v) ? "—" : v.toFixed(2));
const p = (s: unknown, w: number) => String(s).padStart(w);

type Tr = { date: string; win: string | null; pnl: number; qty: number; histRel: number; atr: number; gapAbs: number };

function runTrades(D: Prepped, entries: any, gate?: any): Tr[] {
  const ev = specEval(entries, "15:25");
  const out: Tr[] = [];
  for (const s of D.real) {
    const macd = macdHistSeries(s.bars.map((b) => b.close));
    const idxByTs = new Map<number, number>(); s.bars.forEach((b, i) => idxByTs.set(b.ts, i));
    const ts = simulateSession(s.bars, cfgOf(MAXC), FUND2000, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, gate, 0);
    for (const t of ts) {
      const idx = idxByTs.get(t.entryTs) ?? -1;
      const mh = idx >= 0 ? (macd[idx] ?? 0) : 0;
      out.push({ date: s.dateET, win: winOf(s.dateET), pnl: t.pnl, qty: Math.abs(t.qty),
        histRel: (t.optType === "call" ? 1 : -1) * mh, atr: idx >= 0 ? computeFeatures(s.bars, idx).atr : 0, gapAbs: Math.abs(s.gap ?? 0) });
    }
  }
  return out;
}

// post-scale a flat trade's pnl by a histRel size scalar (capped at maxC) — sizing keeps the entry set fixed
const sizePnl = (t: Tr, up: number, dn: number): number => {
  const scalar = t.histRel >= 0 ? up : dn;
  const sizedQty = Math.max(1, Math.min(MAXC, Math.round(t.qty * scalar)));
  return t.qty > 0 ? t.pnl * (sizedQty / t.qty) : t.pnl;
};

const tot = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const exp = (xs: number[]) => (xs.length ? tot(xs) / xs.length : NaN);
function maxDD(trs: Tr[], pnlOf: (t: Tr) => number): number { // peak-to-trough on the cumulative daily curve
  const byDay = new Map<string, number>(); for (const t of trs) byDay.set(t.date, (byDay.get(t.date) ?? 0) + pnlOf(t));
  let cum = 0, peak = 0, dd = 0; for (const d of [...byDay.keys()].sort()) { cum += byDay.get(d)!; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return dd;
}
function corr(a: number[], b: number[]): number {
  const n = a.length; if (n < 3) return NaN;
  const ma = exp(a), mb = exp(b); let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
}
const perWin = (trs: Tr[], pnlOf: (t: Tr) => number) => WINDOWS.map((w) => { const f = trs.filter((t) => t.win === w.name); return f.length ? exp(f.map(pnlOf)) : NaN; });

function report(name: string, flat: Tr[], gated: Tr[]) {
  const variants: Array<{ k: string; pnl: (t: Tr) => number; src: Tr[] }> = [
    { k: "flat", pnl: (t) => t.pnl, src: flat },
    { k: "sized 1.3/0.7", pnl: (t) => sizePnl(t, 1.3, 0.7), src: flat },
    { k: "sized 1.5/0.5", pnl: (t) => sizePnl(t, 1.5, 0.5), src: flat },
    { k: "GATE(macd-against)", pnl: (t) => t.pnl, src: gated },
  ];
  console.log(`\n━━ ${name} ━━  (n flat ${flat.length}, gated ${gated.length})`);
  console.log(`  ${p("variant", 18)}${p("n", 5)}${p("total", 9)}${p("exp/t", 8)}${p("maxDD", 9)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
  for (const v of variants) {
    const pnls = v.src.map(v.pnl);
    const pw = perWin(v.src, v.pnl).map((e) => p(f1(e), 8)).join("");
    console.log(`  ${p(v.k, 18)}${p(v.src.length, 5)}${p(usd(tot(pnls)), 9)}${p(f1(exp(pnls)), 8)}${p(usd(maxDD(v.src, v.pnl)), 9)}   ${pw}`);
  }
  // guard 4: orthogonality — is histRel just vol in disguise?
  console.log(`  orthogonality: corr(histRel, atr) = ${f2(corr(flat.map((t) => t.histRel), flat.map((t) => t.atr)))} · corr(histRel, |gap|) = ${f2(corr(flat.map((t) => t.histRel), flat.map((t) => t.gapAbs)))}  (≈0 = a NEW axis; large = vol-in-disguise)`);
}

async function main() {
  console.log(`\n  CONVICTION-SIZE · MACD-hist as a SIZE scalar · live config (RISK 2000 / maxC 24) · faithful fills · the 4 guards`);
  for (const sym of ["SPY", "IWM", "QQQ"] as Sym[]) {
    let D: Prepped; try { D = await prep(sym, DIRS[sym]); } catch (e) { console.log(`  ${sym}: prep failed`); continue; }
    for (const [nm, entries] of [["V3", V3], ["ALT", ALT]] as const) {
      report(`${nm}/${sym}`, runTrades(D, entries), runTrades(D, entries, mkGate(["ha"])));
    }
  }
  console.log(`\n  READ — ARMABLE only if a sized variant: (1) exp/t > flat (not just total), (2) maxDD no worse, (3) +window-robust,`);
  console.log(`  (4) corr(histRel,vol)≈0 AND beats GATE(macd-against). Else: engine-feature sizing is FULLY closed → operator-selection is the last vein. ⚠ modeled options; if it passes → faithful --sizing-model + montecarlo before any paper-lab.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
