// ============================================================================
//  pattern-verify — the RIGOROUS filter for the fan-out's candidate patterns.
//  Reads data/pattern-candidates.json (the workflow's consolidated entry
//  candidates) and runs each BACKTESTABLE one through the re-entry-aware OOS
//  battery the macd-verify lesson demands: per-window expectancy + leave-one-out
//  + a matched-selectivity PLACEBO (on a re-entry-aware book ANY slot-freeing
//  gate lifts expectancy via churn → a candidate is only REAL if it beats a
//  random filter of equal selectivity). Capital-blind dataset splits are
//  HYPOTHESES; this is the foul-out-aware truth.
//
//    npm run pattern-verify
// ============================================================================

import { existsSync, readFileSync } from "fs";
import { computeFeatures } from "./engine";
import { CH, WINDOWS, prep, simChannel, pool, byWindow, exp$, type LG, type Ch, type Prepped, type SessRes } from "./lever-shared";

const CAND_FILE = "data/pattern-candidates.json";
const PLACEBO_K = 20, P_GRID = [0.1, 0.2, 0.3, 0.4];
const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
const padR = (s: string, n: number) => s.padEnd(n);

// slug → the backtest channel in lever-shared CH (ORB-family + manual/qqq variants fold to their base)
const SLUG_CH: Record<string, string> = {
  "breakout-alt-v3": "BREAK(ALT V3)", "breakout-smart-entries": "BREAK(ALT)",
  "pb-ride": "PB RIDER 1DTE", "pb-ride-2": "PB RIDER 1DTE",
  "breakout": "ORB(breakout)", "breakout-qqq": "ORB(breakout)", "breakout-manual": "ORB(breakout)", "orb-trend-rider": "ORB(breakout)", "orb-spy-trail": "ORB(breakout)",
  "power": "POWERHOUR", "power-smart-entries": "POWERHOUR", "power-manual": "POWERHOUR",
  "power-final30": "POWER Final30",
  "grind-v3": "GRIND v3", "grind-v3-2": "GRIND v3",
  "grind": "GRIND(base)", "grind-manual": "GRIND(base)", "grind-smart-entries": "GRIND(base)",
  "orb-qqq-trail": "QQQ-ORB", "qqq-thrust-trail": "QQQ-ORB",
};

type Cond = { feat: string; op: "lt" | "gte" | "band" | "is"; value?: number; lo?: number; hi?: number };
type Pred = { all: Cond[] };
type Cand = { id: string; label: string; slug: string; backtestable?: boolean; predicate: Pred; evidence?: string; confidence?: string };

const dirSign = (d: "call" | "put") => (d === "call" ? 1 : -1);
function featOf(name: string, f: ReturnType<typeof computeFeatures>, dir: "call" | "put", mh: number | null): number | boolean | null {
  switch (name) {
    case "dirVwapAtr": return f.atr > 0 ? (dirSign(dir) * (f.close - f.vwap)) / f.atr : null;
    case "histRel": return dirSign(dir) * (mh ?? 0);
    case "whipZone": return f.er >= 0.10 && f.er < 0.20 && f.atr >= 0.40;
    case "orDepthAtr": return f.atr > 0 && f.openRangeHi != null && f.openRangeLo != null ? (dir === "call" ? (f.close - f.openRangeHi) / f.atr : (f.openRangeLo - f.close) / f.atr) : null;
    case "er": return f.er;
    case "relVol": return f.relVol;
    case "atr": return f.atr;
    case "dirMom": return dirSign(dir) * f.mom;
    case "minToClose": return f.minutesToClose;
    case "absGap": return null; // session-level — NOT visible to the entry-bar leverGate → flagged untestable (→ gap_min)
    default: return null;
  }
}
const condHolds = (c: Cond, v: number | boolean | null): boolean => {
  if (v === null) return false;                 // missing feat → don't block (fail-open for a block-gate)
  if (c.op === "is") return v === true;
  if (typeof v !== "number") return false;
  if (c.op === "lt") return v < (c.value ?? 0);
  if (c.op === "gte") return v >= (c.value ?? 0);
  if (c.op === "band") return v >= (c.lo ?? -Infinity) && v < (c.hi ?? Infinity);
  return false;
};
const predToLG = (p: Pred): LG => (f, dir, mh) => p.all.length > 0 && p.all.every((c) => condHolds(c, featOf(c.feat, f, dir, mh)));
const usesAbsGap = (p: Pred) => p.all.some((c) => c.feat === "absGap");

// seeded PRNG + helpers (mirror macd-verify)
function mulberry32(seed: number) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const randGate = (rng: () => number, p: number): LG => () => rng() < p;
const ex = (rs: SessRes[]) => { const p = pool(rs); return p.n ? p.tot / p.n : 0; };
const exExcl = (rs: SessRes[], win: string) => ex(rs.filter((r) => r.win !== win));

function verify(D: Prepped, ch: Ch, cand: Cand, seedBase: number) {
  const baseRS = simChannel(D, ch);
  const gateRS = simChannel(D, ch, predToLG(cand.predicate));
  const bP = pool(baseRS), gP = pool(gateRS);
  const bBW = byWindow(baseRS), gBW = byWindow(gateRS);
  const poolDexp = ex(gateRS) - ex(baseRS);

  // A. per-window expectancy
  let helped = 0;
  for (const w of WINDOWS) { const b = bBW.get(w.name), g = gBW.get(w.name); const be = b && b.n ? b.tot / b.n : 0, ge = g && g.n ? g.tot / g.n : 0; if (ge > be) helped++; }
  // B. leave-one-out (drop each window; robust if Δexp>0 even dropping the best)
  const loo = WINDOWS.map((w) => exExcl(gateRS, w.name) - exExcl(baseRS, w.name));
  const looWorst = Math.min(...loo);
  // C. placebo — random filter matched on trade count (heavy channels get fewer seeds)
  const K = bP.n > 1500 ? 6 : PLACEBO_K;
  const placebo = P_GRID.map((p) => {
    const exps: number[] = [], ns: number[] = [];
    for (let k = 0; k < K; k++) { const rng = mulberry32(seedBase + k * 131 + Math.round(p * 1000)); const rs = simChannel(D, ch, randGate(rng, p)); exps.push(ex(rs)); ns.push(pool(rs).n); }
    const mean = exps.reduce((a, b) => a + b, 0) / exps.length;
    return { p, mean, nmean: ns.reduce((a, b) => a + b, 0) / ns.length, pval: exps.filter((e) => e >= ex(gateRS)).length / exps.length };
  });
  const matched = placebo.reduce((a, b) => (Math.abs(b.nmean - gP.n) < Math.abs(a.nmean - gP.n) ? b : a));

  const passes = (helped >= 4 ? 1 : 0) + (looWorst > 0 ? 1 : 0) + (matched.pval <= 0.1 ? 1 : 0);
  const verdict = poolDexp <= 0 ? "DEAD (Δexp≤0)" : passes >= 3 ? "✓ HOLDS UP" : passes >= 2 ? "~ PARTIAL" : "✗ FRAGILE";
  return { poolDexp, baseN: bP.n, gateN: gP.n, helped, looWorst, placeboP: matched.pval, placeboMatchedP: matched.p, verdict, passes };
}

async function main() {
  const fi = process.argv.indexOf("--file");
  const file = fi >= 0 ? process.argv[fi + 1] : CAND_FILE;
  if (!existsSync(file)) { console.log(`\n  ${file} not found — run the pattern-mine-allchannels workflow first (it writes the candidates).\n`); return; }
  const doc = JSON.parse(readFileSync(file, "utf8")) as { generated?: string; entry?: Cand[]; exit?: any[] };
  const entry = doc.entry ?? [];
  const SPY = await prep("SPY", "data/databento-mdte");

  console.log(`\n  PATTERN-VERIFY · ${entry.length} entry candidates (generated ${doc.generated ?? "?"}) · ${SPY.real.length} SPY sessions · re-entry-aware OOS + placebo`);
  console.log(`  a candidate is REAL only if it lifts pooled EXPECTANCY, helps ≥4/5 OOS windows, survives leave-one-out, AND beats a random filter of equal selectivity (placebo ≤10%).\n`);

  const skipped: string[] = [];
  const results: Array<{ cand: Cand; ch: string; r: ReturnType<typeof verify> }> = [];
  let i = 0;
  for (const cand of entry) {
    const chName = SLUG_CH[cand.slug];
    if (!chName) { skipped.push(`${cand.id} (${cand.slug}: not a backtest channel — dataset-only)`); continue; }
    if (usesAbsGap(cand.predicate)) { skipped.push(`${cand.id} (uses absGap → not visible at the entry bar; route to gap_min vocab)`); continue; }
    if (!cand.predicate?.all?.length) { skipped.push(`${cand.id} (empty predicate)`); continue; }
    const ch = CH.find((c) => c.name === chName);
    if (!ch) { skipped.push(`${cand.id} (${chName}: no CH)`); continue; }
    const r = verify(SPY, ch, cand, 0x51e5 + (i++) * 977 + cand.id.length);
    results.push({ cand, ch: chName, r });
    console.log(`  ${r.r ? "" : ""}${(r.verdict + "").padEnd(14)} ${padR(cand.id, 24)} ${padR(chName, 14)} poolΔexp ${f1(r.poolDexp)}/t (${r.baseN}→${r.gateN}t)  win ${r.helped}/5  drop-best ${r.looWorst > 0 ? "✓" : "✗"}(${f1(r.looWorst)})  placebo ${(r.placeboP * 100).toFixed(0)}%@p${r.placeboMatchedP}`);
    console.log(`                 ↳ ${cand.label}  [${cand.confidence ?? "?"}]`);
  }

  console.log(`\n  ━━ SUMMARY ━━`);
  const held = results.filter((x) => x.r.passes >= 3 && x.r.poolDexp > 0);
  const partial = results.filter((x) => x.r.passes === 2 && x.r.poolDexp > 0);
  console.log(`  ${results.length} verified · ${held.length} HOLD UP · ${partial.length} PARTIAL · ${results.length - held.length - partial.length} fragile/dead · ${skipped.length} skipped`);
  if (held.length) console.log(`  HOLD UP: ${held.map((x) => `${x.cand.id} (${x.ch}, Δexp ${f1(x.r.poolDexp)})`).join("; ")}`);
  if (partial.length) console.log(`  PARTIAL: ${partial.map((x) => x.cand.id).join(", ")}`);
  if (skipped.length) console.log(`  SKIPPED (not OOS-verifiable here):\n    - ${skipped.join("\n    - ")}`);
  console.log(`\n  ⚠ Even HOLD-UP = forward-test, NOT arm: options MODELED + candidates mined on these windows. Live shadow-accrual is the validator.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
