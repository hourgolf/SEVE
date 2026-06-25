// ============================================================================
//  macd-roster-verify — the DESK-WIDE adversarial battery on the +MACD
//  (hist-against) entry gate. macd-verify.ts ran the 4-test battery on ONLY the
//  two validated core channels (V3 / ALT); this runs the IDENTICAL battery over
//  the ENTIRE CH roster (every directional channel, each on its own symbol).
//
//  WHY desk-wide: the clean-books dataset read says MACD-against entries (call
//  with hist<0 / put with hist>0) cost the desk ~-$7,302 (136t, -$54/t) vs
//  aligned +$997 (+$2/t) — more than the whole month loss. But that is a
//  CAPITAL-BLIND read; deleting trades from a one-at-a-time book OVERSTATES the
//  lever (the freed slot would have re-entered). This probe tests the same gate
//  RE-ENTRY-AWARE (lever-shared.simChannel's leverGate) + adversarially, channel
//  by channel, so we learn WHICH channels the gate genuinely helps, which it
//  hurts, and which is mechanical.
//
//  OPEN-MINDED: prior verdict (forensics-levers) = MACD-against real-but-MODEST
//  on V3/ALT ONLY. Approach fresh. POWER is structurally a FADE (clean-books:
//  it wins counter-trend) → the align gate likely HURTS it; report that honestly.
//  A refutation that confirms "the entry axis is mined out" is a valid result.
//
//  The +MACD gate (θ=0) BLOCKS an entry where histRel(dir, macdHist) < 0:
//    call with macdHist < 0  (momentum-against a long)  → blocked
//    put  with macdHist > 0  (momentum-against a short) → blocked
//
//  FOUR kill-attempts per channel (identical to macd-verify.ts):
//    A. PER-WINDOW EXPECTANCY  — is the lift in ≥4/5 windows, or carried by one?
//    B. LEAVE-ONE-WINDOW-OUT   — drop the BEST window; does the pooled lift survive?
//    C. THRESHOLD SENSITIVITY  — is θ=0 a knife-edge, or does it degrade gracefully?
//    D. PLACEBO (seeded)       — does MACD beat a RANDOM filter of equal selectivity?
//       (on a book a random cut of matched count is the null; a real lift = signal,
//        a mechanical lift = the shallow-VWAP trap the pooled-$ view falls for.)
//
//    npx tsx --env-file=.env.local engine/macd-roster-verify.ts
// ============================================================================

import {
  CH, WINDOWS, prep, simChannel, pool, byWindow, histRel, exp$,
  type LG, type Ch, type Prepped, type SessRes,
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

// how many of the 5 OOS windows does this channel actually have data in
// (QQQ data starts 2026-03 → ~2 windows; the battery scorecard de-rates accordingly)
const populatedWindows = (rs: SessRes[]) => {
  const m = byWindow(rs);
  return WINDOWS.filter((w) => (m.get(w.name)?.n ?? 0) > 0).length;
};

type Verdict = {
  name: string; sym: string;
  baseN: number; baseExp: number; macdN: number; macdExp: number;
  helped: number; populated: number; looWorst: number; looWorstWin: string;
  thresholdOK: boolean; placeboP: number; placeboMatchN: number; poolDexp: number;
};

async function verifyChannel(D: Prepped, ch: Ch): Promise<Verdict> {
  const baseRS = simChannel(D, ch);
  const macdRS = simChannel(D, ch, haGate(0));
  const bP = pool(baseRS), mP = pool(macdRS);
  const bBW = byWindow(baseRS), mBW = byWindow(macdRS);
  const populated = populatedWindows(baseRS);

  console.log(`\n  ━━ ${ch.name}  [${ch.sym}] ━━  base ${bP.n}t ${exp$(bP.tot, bP.n)}/t  →  +MACD ${mP.n}t ${exp$(mP.tot, mP.n)}/t  (pooled Δexp ${f1(ex(macdRS) - ex(baseRS))})`);

  // A. per-window expectancy
  console.log(`     A. PER-WINDOW $/t   ${WINDOWS.map((w) => padL(w.short, 9)).join("")}`);
  for (const tag of ["base", "+MACD"] as const) {
    const bw = tag === "base" ? bBW : mBW;
    const cells = WINDOWS.map((w) => { const e = bw.get(w.name); return padL(e && e.n ? exp$(e.tot, e.n) : "—", 9); }).join("");
    console.log(`        ${padR(tag, 8)}${cells}`);
  }
  let helped = 0;
  const dcells = WINDOWS.map((w) => {
    const b = bBW.get(w.name), m = mBW.get(w.name);
    if (!b || !b.n) return padL("—", 9);                 // window absent (e.g. QQQ pre-2026) → not a help/hurt
    const be = b.tot / b.n, me = m && m.n ? m.tot / m.n : 0;
    const d = me - be; if (d > 0) helped++;
    return padL(f1(d), 9);
  }).join("");
  console.log(`        ${padR("Δexp", 8)}${dcells}   → helps ${helped}/${populated}`);

  // B. leave-one-window-out (drop each populated window → pooled Δexp over the rest; worst = drop the best)
  const looDeltas = WINDOWS
    .filter((w) => (bBW.get(w.name)?.n ?? 0) > 0)
    .map((w) => ({ w: w.short, name: w.name, d: exExcl(macdRS, w.name) - exExcl(baseRS, w.name) }));
  const worst = looDeltas.length ? looDeltas.reduce((a, b) => (b.d < a.d ? b : a)) : { w: "—", name: "—", d: 0 };
  console.log(`     B. LEAVE-ONE-OUT Δexp:  ${looDeltas.map((l) => `${l.w} ${f1(l.d)}`).join("  ") || "—"}`);
  console.log(`        worst case (drop ${worst.w}) → Δexp ${f1(worst.d)}  ${worst.d > 0 ? "✓ survives" : "✗ collapses"}`);

  // C. threshold sensitivity
  const thetas = [-0.10, -0.05, -0.02, 0, 0.02, 0.05, 0.10];
  console.log(`     C. THRESHOLD (block histRel<θ):  θ=0 is the lever; robust = graceful, not knife-edge`);
  const thRows = thetas.map((th) => {
    const rs = th === 0 ? macdRS : simChannel(D, ch, haGate(th));
    return { th, dexp: ex(rs) - ex(baseRS), n: pool(rs).n };
  });
  console.log(`        ${thRows.map((r) => `θ${r.th >= 0 ? "+" : ""}${r.th.toFixed(2)}:Δ${f1(r.dexp)}(${r.n}t)`).join("  ")}`);
  const thresholdOK = thRows.filter((r) => r.th < 0.06 && r.th > -0.06).every((r) => r.dexp > 0);

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

  return {
    name: ch.name, sym: ch.sym,
    baseN: bP.n, baseExp: ex(baseRS), macdN: mP.n, macdExp: ex(macdRS),
    helped, populated, looWorst: worst.d, looWorstWin: worst.w,
    thresholdOK, placeboP: matched.pval, placeboMatchN: Math.round(matched.nmean),
    poolDexp: ex(macdRS) - ex(baseRS),
  };
}

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  let QQQ: Prepped | null = null;
  try { QQQ = await prep("QQQ", "data/databento-mdte-qqq"); } catch { QQQ = null; }
  const dataFor = (ch: Ch): Prepped | null => (ch.sym === "QQQ" ? QQQ : SPY);

  console.log(`\n  MACD-ROSTER-VERIFY · DESK-WIDE adversarial battery on the +MACD (hist-against) entry gate`);
  console.log(`  SPY ${SPY.real.length} sessions${QQQ ? ` · QQQ ${QQQ.real.length}` : " · QQQ unavailable"} (real NBBO) · RE-ENTRY-AWARE leverGate · FAITHFUL (live 0.25 gate + 1-tick fills)`);
  console.log(`  gate (θ=0): BLOCK call when macdHist<0 / put when macdHist>0 (momentum-against). The freed slot re-enters the next valid signal.`);
  console.log(`  four kill-attempts/channel: per-window helps · leave-one-out (drop-best) · threshold gracefulness · placebo (random cut of matched count).`);
  console.log(`  windows: ${WINDOWS.map((w) => w.short).join(" · ")}`);
  console.log(`  ⚠ clean-books capital-blind read = ~-$7,302 leak from MACD-against entries; this RE-ENTRY-AWARE test asks whether blocking them survives the foul-out reality + the 4 kills.`);

  const verdicts: Verdict[] = [];
  for (const ch of CH) {
    const D = dataFor(ch);
    if (!D || D.real.length === 0) { console.log(`\n  ━━ ${ch.name}  [${ch.sym}] ━━  — no data (skipped)`); continue; }
    verdicts.push(await verifyChannel(D, ch));
  }

  // ── DESK-WIDE SCORECARD ─────────────────────────────────────────────────
  console.log(`\n\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ━━ DESK-WIDE VERDICT ━━  (a channel HOLDS UP only if it passes ≥3/4 AND poolΔexp>0)`);
  console.log(`  ${padR("channel", 16)}${padR("sym", 5)}${padL("base$/t", 9)}${padL("+MACD$/t", 10)}${padL("poolΔ", 8)}   checks (per-window / drop-best / threshold / placebo)`);
  for (const v of verdicts) {
    const perWinPass = v.populated >= 4 ? v.helped >= 4 : v.helped >= v.populated; // de-rate few-window symbols (QQQ): require ALL its windows
    // PLACEBO is only meaningful as evidence of a useful gate when the lever actually LIFTS the book:
    // a p-value that "beats a random cut" on a gate whose poolΔexp ≤ 0 is large-n noise (GRIND-base:
    // p=10% on Δexp −0.2 over 7,508 trades), NOT signal — crediting it inverts the test. Gate on a
    // positive lift so the placebo mark/pass mean what they claim.
    const placeboPass = v.poolDexp > 0 && v.placeboP <= 0.1;
    const placeboMark = v.poolDexp <= 0 ? "✗" : v.placeboP <= 0.1 ? "✓" : v.placeboP <= 0.25 ? "~" : "✗";
    const checks = [
      `per-win ${v.helped}/${v.populated}${perWinPass ? "✓" : "✗"}`,
      `drop-best ${v.looWorst > 0 ? "✓" : "✗"}`,
      `thresh ${v.thresholdOK ? "✓" : "✗"}`,
      `placebo ${placeboMark}`,
    ];
    const passes = (perWinPass ? 1 : 0) + (v.looWorst > 0 ? 1 : 0) + (v.thresholdOK ? 1 : 0) + (placeboPass ? 1 : 0);
    const holds = passes >= 3 && v.poolDexp > 0;
    const dir = v.poolDexp > 0.5 ? "HELPS" : v.poolDexp < -0.5 ? "HURTS" : "FLAT";
    const tag = holds ? "→ HOLDS UP" : passes >= 2 && v.poolDexp > 0 ? "→ PARTIAL" : `→ ${dir === "HURTS" ? "GATE HURTS" : dir === "FLAT" ? "INERT/MECH" : "FRAGILE"}`;
    console.log(`  ${padR(v.name, 16)}${padR(v.sym, 5)}${padL(exp$(v.baseExp * v.baseN, v.baseN), 9)}${padL(exp$(v.macdExp * v.macdN, v.macdN), 10)}${padL(f1(v.poolDexp), 8)}   ${checks.join("  ")}  |  ${passes}/4 ${tag}`);
  }

  const holdsUp = verdicts.filter((v) => {
    const perWinPass = v.populated >= 4 ? v.helped >= 4 : v.helped >= v.populated;
    const placeboPass = v.poolDexp > 0 && v.placeboP <= 0.1; // placebo credited only on a positive lift (see above)
    const passes = (perWinPass ? 1 : 0) + (v.looWorst > 0 ? 1 : 0) + (v.thresholdOK ? 1 : 0) + (placeboPass ? 1 : 0);
    return passes >= 3 && v.poolDexp > 0;
  });
  const hurts = verdicts.filter((v) => v.poolDexp < -0.5);

  console.log(`\n  SUMMARY: gate HOLDS UP on ${holdsUp.length ? holdsUp.map((v) => v.name).join(", ") : "NONE"}.`);
  console.log(`           gate HURTS (poolΔexp<0) on ${hurts.length ? hurts.map((v) => `${v.name} (${f1(v.poolDexp)})`).join(", ") : "none"}.`);
  console.log(`           the rest are INERT / MECHANICAL (Δexp≈0, or a pooled lift that fails the placebo = a random-cut artifact, not signal).`);
  console.log(`\n  ⚠ DOCTRINE: even a 4/4-clean pass is a FORWARD-TEST hypothesis, NOT an arm signal — options are MODELED and the gate may be mined on these very windows.`);
  console.log(`  A refutation that confirms "the entry axis is mined out" is a valid, valuable result. Honest negatives reported as-is.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
