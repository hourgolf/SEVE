// ============================================================================
//  macd-verify — the ADVERSARIAL battery on the lever-probe's #1 finding:
//  "MACD-hist-against (block call+hist<0 / put+hist>0) is the REAL edge on the
//   validated core V3/ALT" (expectancy ~5×, OOS 4/5).
//
//  The lever-probe said it's real; this script TRIES TO KILL IT four ways:
//    A. PER-WINDOW EXPECTANCY  — is the lift in 4/5 windows, or carried by one?
//    B. LEAVE-ONE-WINDOW-OUT   — drop the BEST window; does the pooled lift survive?
//    C. THRESHOLD SENSITIVITY  — is θ=0 a knife-edge, or does it degrade gracefully?
//    D. PLACEBO (seeded)       — does MACD beat a RANDOM filter of equal selectivity?
//       (on a +EV book a random cut leaves expectancy flat — so a real lift = signal,
//        a mechanical lift = the shallow-VWAP trap that the pooled-$ view fell for.)
//
//    npm run macd-verify
// ============================================================================

import { computeFeatures } from "./engine";
import {
  CH, WINDOWS, prep, simChannel, pool, byWindow, histRel, exp$, type LG, type Ch, type Prepped, type SessRes,
} from "./lever-shared";

const PLACEBO_K = 30;                 // seeds per placebo block-rate
const P_GRID = [0.1, 0.2, 0.3, 0.4, 0.5];
const padR = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);

// the MACD-hist-against gate, parameterized by threshold θ (θ=0 is the lever)
const haGate = (theta: number): LG => (_f, dir, mh) => histRel(dir, mh) < theta;

// seeded PRNG (mulberry32) — reproducible placebo, no Math.random
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randGate = (rng: () => number, p: number): LG => () => rng() < p;

const ex = (rs: SessRes[]) => { const p = pool(rs); return p.n ? p.tot / p.n : 0; };
const exExcl = (rs: SessRes[], win: string) => { const f = rs.filter((r) => r.win !== win); return ex(f); };

async function verifyChannel(D: Prepped, ch: Ch) {
  const baseRS = simChannel(D, ch);
  const macdRS = simChannel(D, ch, haGate(0));
  const bP = pool(baseRS), mP = pool(macdRS);
  const bBW = byWindow(baseRS), mBW = byWindow(macdRS);

  console.log(`\n  ━━ ${ch.name} ━━  base ${bP.n}t ${exp$(bP.tot, bP.n)}/t  →  +MACD ${mP.n}t ${exp$(mP.tot, mP.n)}/t  (pooled Δexp ${f1(ex(macdRS) - ex(baseRS))})`);

  // A. per-window expectancy
  console.log(`     A. PER-WINDOW $/t   ${WINDOWS.map((w) => padL(w.short, 9)).join("")}`);
  const perWinDelta: Record<string, number> = {};
  for (const tag of ["base", "+MACD"] as const) {
    const bw = tag === "base" ? bBW : mBW;
    const cells = WINDOWS.map((w) => { const e = bw.get(w.name); return padL(e && e.n ? exp$(e.tot, e.n) : "—", 9); }).join("");
    console.log(`        ${padR(tag, 8)}${cells}`);
  }
  let helped = 0;
  const dcells = WINDOWS.map((w) => {
    const b = bBW.get(w.name), m = mBW.get(w.name);
    const be = b && b.n ? b.tot / b.n : 0, me = m && m.n ? m.tot / m.n : 0;
    const d = me - be; perWinDelta[w.name] = d; if (d > 0) helped++;
    return padL(f1(d), 9);
  }).join("");
  console.log(`        ${padR("Δexp", 8)}${dcells}   → helps ${helped}/${WINDOWS.length}`);

  // B. leave-one-window-out (drop each → pooled Δexp over the remaining 4; worst = drop the best)
  const looDeltas = WINDOWS.map((w) => ({ w: w.short, d: exExcl(macdRS, w.name) - exExcl(baseRS, w.name) }));
  const worst = looDeltas.reduce((a, b) => (b.d < a.d ? b : a));
  console.log(`     B. LEAVE-ONE-OUT Δexp:  ${looDeltas.map((l) => `${l.w} ${f1(l.d)}`).join("  ")}`);
  console.log(`        worst case (drop ${worst.w}) → Δexp ${f1(worst.d)}  ${worst.d > 0 ? "✓ survives" : "✗ collapses"}`);

  // C. threshold sensitivity
  const thetas = [-0.10, -0.05, -0.02, 0, 0.02, 0.05, 0.10];
  console.log(`     C. THRESHOLD (block histRel<θ):  θ=0 is the lever; robust = graceful, not knife-edge`);
  const thRows = thetas.map((th) => {
    const rs = th === 0 ? macdRS : simChannel(D, ch, haGate(th));
    return { th, dexp: ex(rs) - ex(baseRS), n: pool(rs).n };
  });
  console.log(`        ${thRows.map((r) => `θ${r.th >= 0 ? "+" : ""}${r.th.toFixed(2)}:Δ${f1(r.dexp)}(${r.n}t)`).join("  ")}`);
  const thPos = thRows.filter((r) => r.th < 0.06 && r.th > -0.06).every((r) => r.dexp > 0);

  // D. placebo — random filter of equal selectivity (matched on trade count)
  const placebo = P_GRID.map((p) => {
    const exps: number[] = []; const ns: number[] = [];
    for (let k = 0; k < PLACEBO_K; k++) {
      const rng = mulberry32(0x9e37 + k * 101 + Math.round(p * 1000) + ch.name.length * 7);
      const rs = simChannel(D, ch, randGate(rng, p));
      exps.push(ex(rs)); ns.push(pool(rs).n);
    }
    const mean = exps.reduce((a, b) => a + b, 0) / exps.length;
    const sd = Math.sqrt(exps.reduce((a, b) => a + (b - mean) ** 2, 0) / exps.length);
    const nmean = ns.reduce((a, b) => a + b, 0) / ns.length;
    const ge = exps.filter((e) => e >= ex(macdRS)).length;
    return { p, mean, sd, nmean, pval: ge / exps.length };
  });
  // matched bucket = placebo p whose mean trade-count is closest to +MACD's n
  const matched = placebo.reduce((a, b) => (Math.abs(b.nmean - mP.n) < Math.abs(a.nmean - mP.n) ? b : a));
  console.log(`     D. PLACEBO (random filter, ${PLACEBO_K} seeds/p):  +MACD exp ${exp$(mP.tot, mP.n)} (n=${mP.n})`);
  for (const pl of placebo) {
    const mark = pl === matched ? " ←matched(n)" : "";
    console.log(`        p=${pl.p.toFixed(2)}  rand exp ${f1(pl.mean)}±${pl.sd.toFixed(1)} (n̄=${Math.round(pl.nmean)})  P(rand≥MACD)=${(pl.pval * 100).toFixed(0)}%${mark}`);
  }
  console.log(`        → at matched selectivity (p=${matched.p.toFixed(2)}, n̄=${Math.round(matched.nmean)}): MACD beats a random cut with p-value ${(matched.pval * 100).toFixed(0)}%  ${matched.pval <= 0.1 ? "✓ signal" : matched.pval <= 0.25 ? "~ weak" : "✗ mechanical"}`);

  return { name: ch.name, helped, total: WINDOWS.length, looWorst: worst.d, thresholdOK: thPos, placeboP: matched.pval, poolDexp: ex(macdRS) - ex(baseRS) };
}

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  const targets = CH.filter((c) => c.name === "BREAK(ALT V3)" || c.name === "BREAK(ALT)");

  console.log(`\n  MACD-VERIFY · adversarial battery on the +MACD (hist-against) lever · ${SPY.real.length} SPY sessions (real NBBO)`);
  console.log(`  the lever-probe ranked this the #1 finding (REAL edge on V3/ALT). Four kill-attempts: per-window / leave-one-out / threshold / placebo.`);

  const verdicts = [];
  for (const ch of targets) verdicts.push(await verifyChannel(SPY, ch));

  console.log(`\n  ━━ VERDICT ━━`);
  for (const v of verdicts) {
    const checks = [
      `per-window ${v.helped}/${v.total}${v.helped >= 4 ? "✓" : "✗"}`,
      `drop-best ${v.looWorst > 0 ? "✓" : "✗"}`,
      `threshold ${v.thresholdOK ? "✓" : "✗"}`,
      `placebo ${v.placeboP <= 0.1 ? "✓" : v.placeboP <= 0.25 ? "~" : "✗"}`,
    ];
    const passes = (v.helped >= 4 ? 1 : 0) + (v.looWorst > 0 ? 1 : 0) + (v.thresholdOK ? 1 : 0) + (v.placeboP <= 0.1 ? 1 : 0);
    console.log(`  ${padR(v.name, 14)} poolΔexp ${f1(v.poolDexp)}/t  |  ${checks.join("  ")}  |  ${passes}/4 ${passes >= 3 ? "→ HOLDS UP" : passes >= 2 ? "→ PARTIAL" : "→ FRAGILE"}`);
  }
  console.log(`\n  ⚠ Even 4/4 = forward-test, NOT arm: options are MODELED + the lever was mined partly on these windows. worker-24e accrual is the real validator.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
