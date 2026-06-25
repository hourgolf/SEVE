// ============================================================================
//  grind-bucket-probe — does CONCENTRATING grind on its winning sub-buckets turn
//  its tiny +$7/t micro-scalp edge into a real OOS edge, or is it just mechanical
//  trade-cutting?  (the open-minded clean-books reopening of the entry axis.)
//
//  CLEAN-BOOKS FINDING (execution-integrity-clean-books): GRIND(base) is the desk's
//  one working micro-scalp (+$7/t, capture ~+87% of its tiny excursions); the
//  shared-OCC $0-booking bug UNDER-credited it (booked +$595, clean +$1,688). Its
//  winning sub-buckets from forensics-mine: deep-VWAP (dirVwapAtr≥6) +$44/t,
//  deep-OR (orDepthAtr≥1) +$41/t.
//
//  QUESTION: does gating grind to those buckets HOLD UP OOS, or is a bucket split
//  just mechanical trade-cutting — which (pattern-fanout-verdict, the #1 lesson) a
//  RANDOM cut of equal selectivity matches on a re-entry-aware book?  The PLACEBO
//  is load-bearing.  A gate is only REAL if it beats a matched-selectivity random
//  filter (mulberry32, ~30 seeds, P(rand ≥ gated) small).
//
//  GATE CONVENTION (lever-shared.LG): return TRUE → BLOCK the entry; the engine then
//  re-enters the next valid signal (the freed one-at-a-time slot).  This re-entry-
//  awareness is REQUIRED — a capital-blind "just delete trades" replay OVERSTATES
//  every gate via the churn it frees.  simChannel(D, ch, gate) does this correctly.
//
//  NOTE: gap is NOT visible to the LG signature (only f=computeFeatures, dir,
//  macdHist) — so the gap sub-bucket is NOT testable via this gate.  We test the
//  dirVwapAtr + orDepthAtr buckets only and say so.
//
//  FAITHFUL: RISK 500 / DAILY_STOP 500 / cost gate 3.0 (gateCostModel slip 0.25) /
//  1-tick fills, the 5 OOS regime windows — all from lever-shared (canonical).
//
//  DOCTRINE: even a clean 4/4 pass is a FORWARD-TEST hypothesis, NOT an arm signal
//  (options are MODELED; the gate may be mined on these very windows).  Report
//  honest negatives — a refutation that confirms "the entry axis is mined out (now
//  on clean data)" is a valid, valuable result.
//
//    npx tsx --env-file=.env.local engine/grind-bucket-probe.ts
// ============================================================================

import { computeFeatures } from "./engine";
import { CH, WINDOWS, prep, simChannel, pool, byWindow, dirVwapAtr, exp$, type LG, type Ch, type Prepped, type SessRes } from "./lever-shared";

const PLACEBO_K = 30;          // ~30 seeds per probability point (operator's spec)
// wide grid so we can MATCH high-selectivity gates: on the high-volume GRIND(base) book re-entry
// REFILLS freed slots, so a random p-block thins the realized count far less than (1−p) — p=0.7
// still keeps ~4400 of 7508. The ceiling is pushed to 0.9 so the matcher can reach a gate that keeps
// only ~47% (deepVWAP≥6 = 3541); otherwise the "matched" placebo is under-selective and the P is moot.
const P_GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9];
const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
const padR = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

// ── the directional OR-depth (the deep-OR bucket axis) ──────────────────────
// identical to pattern-verify's featOf("orDepthAtr"): how far past the opening
// range the entry bar closed, in ATRs.  null → OR not yet formed / atr 0.
const orDepthAtr = (f: ReturnType<typeof computeFeatures>, dir: "call" | "put"): number | null =>
  f.atr > 0 && f.openRangeHi != null && f.openRangeLo != null
    ? (dir === "call" ? (f.close - f.openRangeHi) / f.atr : (f.openRangeLo - f.close) / f.atr)
    : null;

// ── the bucket gates (TRUE → BLOCK an entry OUTSIDE the winning bucket) ──────
// deepVWAP: keep only dirVwapAtr ≥ thr (block below).  deepOR: keep only
// orDepthAtr ≥ 1 (block below / when OR not formed).  either: keep if EITHER
// bucket passes (block only when both fail).  Guards: a null/undefined feature
// FAILS the keep-test → BLOCKS (we cannot confirm the entry is in the bucket).
const gateDeepVWAP = (thr: number): LG => (f, dir) => dirVwapAtr(f, dir) < thr;            // block below threshold
const gateDeepOR: LG = (f, dir) => { const d = orDepthAtr(f, dir); return d == null || d < 1; }; // block below 1 / no OR
const gateEither = (thr: number): LG => (f, dir, mh) => !(gateDeepVWAP(thr)(f, dir, mh) === false || gateDeepOR(f, dir, mh) === false);
//   either: pass (don't block) iff deepVWAP passes OR deepOR passes.
//   gateX(...)===false  ⇔  "that bucket does NOT block"  ⇔  "entry IS in that bucket".

// ── seeded PRNG (mulberry32) — reproducible matched-selectivity placebo ──────
function mulberry32(seed: number) {
  return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const randGate = (rng: () => number, p: number): LG => () => rng() < p; // block a random p-fraction

const ex = (rs: SessRes[]) => { const p = pool(rs); return p.n ? p.tot / p.n : 0; };          // pooled exp$/t
const exExcl = (rs: SessRes[], win: string) => ex(rs.filter((r) => r.win !== win));            // drop-one-window exp$/t

// ── the full battery for one (channel, gate) ────────────────────────────────
function battery(D: Prepped, ch: Ch, baseRS: SessRes[], gate: LG, seedBase: number) {
  const gateRS = simChannel(D, ch, gate);
  const bP = pool(baseRS), gP = pool(gateRS);
  const bBW = byWindow(baseRS), gBW = byWindow(gateRS);
  const gateEx = ex(gateRS), baseEx = ex(baseRS);
  const poolDexp = gateEx - baseEx;

  // A. per-window: how many of the 5 windows does the gate HELP (higher exp$/t)?
  const perWin = WINDOWS.map((w) => {
    const b = bBW.get(w.name), g = gBW.get(w.name);
    const be = b && b.n ? b.tot / b.n : 0, ge = g && g.n ? g.tot / g.n : 0;
    return { w: w.short, be, ge, bn: b?.n ?? 0, gn: g?.n ?? 0, helped: ge > be };
  });
  const helped = perWin.filter((p) => p.helped).length;

  // B. leave-one-out: drop each window; robust only if Δexp>0 even dropping the BEST
  const loo = WINDOWS.map((w) => exExcl(gateRS, w.name) - exExcl(baseRS, w.name));
  const looWorst = Math.min(...loo);

  // C. PLACEBO (load-bearing) — random filter of MATCHED selectivity. On a
  //    re-entry-aware book ANY slot-freeing gate lifts exp$/t via churn, so the
  //    gate is REAL only if it beats a random cut that keeps the same # of trades.
  const placebo = P_GRID.map((p) => {
    const exps: number[] = [], ns: number[] = [];
    for (let k = 0; k < PLACEBO_K; k++) {
      const rng = mulberry32(seedBase + k * 131 + Math.round(p * 1000));
      const rs = simChannel(D, ch, randGate(rng, p));
      exps.push(ex(rs)); ns.push(pool(rs).n);
    }
    const mean = exps.reduce((a, b) => a + b, 0) / exps.length;
    const nmean = ns.reduce((a, b) => a + b, 0) / ns.length;
    const pval = exps.filter((e) => e >= gateEx).length / exps.length; // P(random ≥ gated)
    return { p, mean, nmean, pval };
  });
  // match the placebo to the GATE's surviving trade count (equal selectivity)
  const matched = placebo.reduce((a, b) => (Math.abs(b.nmean - gP.n) < Math.abs(a.nmean - gP.n) ? b : a));

  const passes = (poolDexp > 0 ? 1 : 0) + (helped >= 4 ? 1 : 0) + (looWorst > 0 ? 1 : 0) + (matched.pval <= 0.1 ? 1 : 0);
  const verdict = poolDexp <= 0 ? "DEAD (Δexp≤0)" : passes === 4 ? "✓✓ HOLDS (beats placebo)" : passes === 3 ? "~ PARTIAL" : "✗ MECHANICAL/FRAGILE";
  return { gateRS, baseEx, gateEx, poolDexp, baseN: bP.n, gateN: gP.n, keepFrac: bP.n ? gP.n / bP.n : 0, perWin, helped, loo, looWorst, matched, placebo, passes, verdict };
}

type B = ReturnType<typeof battery>;

function printChannel(ch: Ch, baseRS: SessRes[], rows: Array<{ label: string; b: B }>) {
  const bP = pool(baseRS), bBW = byWindow(baseRS);
  console.log(`\n${"━".repeat(96)}`);
  console.log(`  ${ch.name}  —  base exp$/t ${exp$(bP.tot, bP.n)} on ${bP.n} trades  (clean-books micro-scalp)`);
  // base per-window line
  console.log(`  base by window: ${WINDOWS.map((w) => { const b = bBW.get(w.name); return `${w.short} ${b && b.n ? exp$(b.tot, b.n) : "—"}(${b?.n ?? 0})`; }).join("  ")}`);
  console.log(`${"─".repeat(96)}`);
  console.log(`  ${padR("gate", 16)}${padL("keep", 13)}${padL("exp$/t", 9)}${padL("Δexp", 8)}${padL("help", 6)}${padL("LOOw", 8)}${padL("placebo (matched n, P(rand≥gate))", 36)}  verdict`);
  for (const { label, b } of rows) {
    // expose the MATCH QUALITY (load-bearing): the matched placebo's realized trade count vs the
    // gate's. If these diverge, the random cut is NOT of equal selectivity → P is not trustworthy.
    const mdrift = Math.round(b.matched.nmean - b.gateN);
    const placeboCell = `p≈${b.matched.p.toFixed(1)} n≈${Math.round(b.matched.nmean)}(${mdrift >= 0 ? "+" : ""}${mdrift}) ${f1(b.matched.mean)} P=${(b.matched.pval * 100).toFixed(0)}%`;
    console.log(
      `  ${padR(label, 16)}` +
      `${padL(`${b.gateN}/${b.baseN} ${(b.keepFrac * 100).toFixed(0)}%`, 13)}` +
      `${padL((b.gateEx >= 0 ? "+" : "") + b.gateEx.toFixed(1), 9)}` +
      `${padL(f1(b.poolDexp), 8)}` +
      `${padL(`${b.helped}/5`, 6)}` +
      `${padL(f1(b.looWorst), 8)}` +
      `${padL(placeboCell, 36)}  ${b.verdict}`
    );
  }
  // per-window detail for each gate (the OOS picture the operator asked for)
  for (const { label, b } of rows) {
    console.log(`    └ ${padR(label, 13)} per-window Δexp: ` +
      b.perWin.map((p) => `${p.w} ${p.helped ? "✓" : "✗"}${f1(p.ge - p.be)}(${p.gn})`).join("  "));
  }
}

async function main() {
  console.log(`\n  GRIND-BUCKET-PROBE · concentrate grind on its winning sub-buckets vs a matched-selectivity placebo · re-entry-aware OOS`);
  console.log(`  FAITHFUL: RISK 500 / DAILY_STOP 500 / cost gate 3.0 (gateCostModel slip 0.25) / 1-tick fills · 5 OOS windows`);
  console.log(`  buckets (forensics-mine): deep-VWAP dirVwapAtr≥thr (+$44/t @≥6) · deep-OR orDepthAtr≥1 (+$41/t) · either = OR of the two`);
  console.log(`  ⚠ the GAP sub-bucket is NOT testable here — gap is not in the LG signature (only f=computeFeatures, dir, macdHist).`);
  console.log(`  a gate is REAL only if it lifts pooled exp$/t, helps ≥4/5 OOS windows, survives leave-one-out, AND beats a`);
  console.log(`  random filter of EQUAL selectivity (placebo P(rand≥gated) ≤10%, ~${PLACEBO_K} seeds/p).  The placebo is the load-bearing test.`);

  const SPY = await prep("SPY", "data/databento-mdte");
  console.log(`\n  ${SPY.real.length} SPY sessions with clean next-session + same-day chains.`);

  // the two grind channels (clean-books: GRIND(base) is the working micro-scalp; GRIND v3 the disciplined sibling)
  const targets = [CH.find((c) => c.name === "GRIND(base)")!, CH.find((c) => c.name === "GRIND v3")!];

  for (let ci = 0; ci < targets.length; ci++) {
    const ch = targets[ci];
    const baseRS = simChannel(SPY, ch);
    const seedBase = 0x6471d + ci * 7919; // distinct, reproducible per channel
    const rows: Array<{ label: string; b: B }> = [
      { label: "deepVWAP≥6", b: battery(SPY, ch, baseRS, gateDeepVWAP(6), seedBase + 60) },
      { label: "deepOR≥1",   b: battery(SPY, ch, baseRS, gateDeepOR,       seedBase + 10) },
      { label: "either",     b: battery(SPY, ch, baseRS, gateEither(6),    seedBase + 99) },
      // deep-VWAP threshold sensitivity (operator's ask: ≥2 / ≥4 / ≥6)
      { label: "deepVWAP≥2", b: battery(SPY, ch, baseRS, gateDeepVWAP(2), seedBase + 20) },
      { label: "deepVWAP≥4", b: battery(SPY, ch, baseRS, gateDeepVWAP(4), seedBase + 40) },
    ];
    printChannel(ch, baseRS, rows);
  }

  console.log(`\n${"━".repeat(96)}`);
  console.log(`  READ: a bucket gate that BEATS its matched-selectivity placebo (P≤10%) on a re-entry-aware book is a genuine`);
  console.log(`  reopening of the entry axis worth FORWARD-TESTING.  If every gate's lift is matched by a random cut of equal`);
  console.log(`  selectivity (placebo P high), the "winning bucket" was MECHANICAL trade-cutting → a 4th (now clean-data)`);
  console.log(`  confirmation that the grind entry axis is mined out.  Even a clean pass is a HYPOTHESIS, not an arm (modeled options).`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
