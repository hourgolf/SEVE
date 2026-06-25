// ============================================================================
//  forensics-mine — per-CHANNEL capital-blind split board over the forensics
//  dataset (data/forensics-dataset.jsonl, 592 live trades 06-01→06-24). For one
//  channel (or all), buckets every NEW indicator + the exit lens against outcome
//  (expectancy $/t · win% · MFE% · giveback%), so a miner can READ the splits
//  instead of recomputing them. This is the DISCOVERY layer (capital-blind, ONE
//  chop/put-tape month → HYPOTHESES only). The rigorous filter is the re-entry-
//  aware OOS + placebo verify (engine/pattern-verify.ts) — a split here is a
//  candidate, NOT an edge (the shallow-VWAP trap: a big pooled $ split can be
//  pure mechanical trade-cutting once you model the freed one-at-a-time slot).
//
//    npm run forensics-mine -- --channel grind         # one channel (slug or name)
//    npm run forensics-mine                             # roster summary (all channels)
//    npm run forensics-mine -- --channel pb-ride --json # structured (for the workflow)
// ============================================================================

import { readFileSync } from "fs";

type Row = {
  id: string; date: string; channel: string; slug: string; sym: string; dir: "call" | "put"; reason: string;
  ask: number; gap: number; er: number; relVol: number; atr: number; mom: number; vwap: number; vwapDist: number;
  macd: number; macdSignal: number; macdHist: number; orHi: number | null; orLo: number | null;
  minutesToClose: number; close: number; entryDelta: number | null;
  entry: number; exit: number; qty: number; pnl: number;
  peak: number | null; mfePct: number | null; givebackPct: number | null; holdMin: number | null; exitReason: string | null;
};

const DATA = "data/forensics-dataset.jsonl";
const rows: Row[] = readFileSync(DATA, "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ── derived awareness levers (the same formulas as lever-shared / worker 24e) ──
const dirSign = (r: Row) => (r.dir === "call" ? 1 : -1);
const dirVwapAtr = (r: Row) => (r.atr > 0 ? (dirSign(r) * r.vwapDist) / r.atr : 0);   // shallow-VWAP-displacement
const histRel = (r: Row) => dirSign(r) * r.macdHist;                                   // MACD-hist alignment (≥0 = aligned)
const whipZone = (r: Row) => r.er >= 0.10 && r.er < 0.20 && r.atr >= 0.40;             // whipsaw zone
const orDepthAtr = (r: Row) => {                                                       // depth past the 30-min OR break (in ATRs)
  if (r.atr <= 0 || r.orHi == null || r.orLo == null) return null;
  return r.dir === "call" ? (r.close - r.orHi) / r.atr : (r.orLo - r.close) / r.atr;
};
const dirMom = (r: Row) => (r.atr > 0 ? (dirSign(r) * r.mom) / 1 : 0);                 // signed momentum (already ATR-normalized in the worker stamp)

// ── stats over a row set ──
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function stat(set: Row[]) {
  const pnl = set.map((r) => r.pnl);
  const mfe = set.filter((r) => r.mfePct != null).map((r) => r.mfePct as number);
  const gb = set.filter((r) => r.givebackPct != null).map((r) => r.givebackPct as number);
  return {
    n: set.length,
    exp: mean(pnl),                                  // expectancy $/trade (capital-blind)
    tot: pnl.reduce((a, b) => a + b, 0),
    win: set.length ? (set.filter((r) => r.pnl > 0).length / set.length) * 100 : NaN,
    mfe: mfe.length ? mean(mfe) : NaN, mfeN: mfe.length,
    gb: gb.length ? mean(gb) : NaN,
  };
}
const f1 = (v: number) => (Number.isNaN(v) ? "  —" : (v >= 0 ? "+" : "") + v.toFixed(1));
const f0 = (v: number) => (Number.isNaN(v) ? "—" : Math.round(v).toString());
const usd = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)));

// ── indicator → buckets (label + predicate); null value → row excluded from that indicator ──
type Bucket = { label: string; lo?: number; hi?: number; test?: (r: Row) => boolean };
type Ind = { name: string; val: (r: Row) => number | boolean | null; buckets: Bucket[] };
const band = (lo: number, hi: number): Bucket => ({ label: `[${lo},${hi})`, lo, hi });
const INDS: Ind[] = [
  { name: "dirVwapAtr (shallow-VWAP)", val: dirVwapAtr, buckets: [{ label: "<0 (wrong side)", hi: 0 }, band(0, 2), band(2, 4), band(4, 6), { label: "≥6 (deep)", lo: 6 }] },
  { name: "histRel (MACD align)", val: histRel, buckets: [{ label: "<0 AGAINST", hi: 0 }, { label: "≥0 aligned", lo: 0 }] },
  { name: "histRel magnitude", val: histRel, buckets: [{ label: "<-0.05", hi: -0.05 }, band(-0.05, 0), band(0, 0.05), { label: "≥0.05", lo: 0.05 }] },
  { name: "whipZone (er∈[.1,.2)&atr≥.4)", val: (r) => (whipZone(r) ? 1 : 0), buckets: [{ label: "in-zone", test: whipZone }, { label: "out", test: (r) => !whipZone(r) }] },
  { name: "orDepthAtr (break depth)", val: orDepthAtr, buckets: [{ label: "<0 inside OR", hi: 0 }, band(0, 0.5), band(0.5, 1), { label: "≥1 deep", lo: 1 }] },
  { name: "|gap| (regime)", val: (r) => Math.abs(r.gap), buckets: [{ label: "<0.10 flat", hi: 0.10 }, band(0.10, 0.25), { label: "≥0.25 gappy", lo: 0.25 }] },
  { name: "er (efficiency)", val: (r) => r.er, buckets: [{ label: "<0.10 dead", hi: 0.10 }, band(0.10, 0.20), band(0.20, 0.45), { label: "≥0.45 trend", lo: 0.45 }] },
  { name: "relVol", val: (r) => r.relVol, buckets: [{ label: "<1.0", hi: 1.0 }, band(1.0, 1.3), { label: "≥1.3", lo: 1.3 }] },
  { name: "atr", val: (r) => r.atr, buckets: [{ label: "<0.20", hi: 0.20 }, band(0.20, 0.40), { label: "≥0.40", lo: 0.40 }] },
  { name: "dirMom (signed)", val: dirMom, buckets: [{ label: "<0 against", hi: 0 }, band(0, 0.3), { label: "≥0.3 strong", lo: 0.3 }] },
  { name: "entry timing (minToClose)", val: (r) => r.minutesToClose, buckets: [{ label: "≥180 early", lo: 180 }, band(60, 180), { label: "<60 late", hi: 60 }] },
];

const inBucket = (v: number | boolean | null, b: Bucket, r: Row): boolean => {
  if (b.test) return b.test(r);
  if (v == null || typeof v === "boolean") return false;
  if (b.lo != null && v < b.lo) return false;
  if (b.hi != null && v >= b.hi) return false;
  return true;
};

// ── exit lens: MFE bucket → giveback + outcome; exitReason board; holdMin board ──
function exitLens(set: Row[]) {
  const withPeak = set.filter((r) => r.mfePct != null);
  const mfeBuckets = [{ label: "MFE<0", hi: 0 }, { label: "[0,20)", lo: 0, hi: 20 }, { label: "[20,50)", lo: 20, hi: 50 }, { label: "≥50", lo: 50 }];
  const byReason = new Map<string, Row[]>();
  for (const r of set) { const k = r.exitReason ?? "(none)"; (byReason.get(k) ?? byReason.set(k, []).get(k)!).push(r); }
  const holdBuckets = [{ label: "≤2min", hi: 2 }, { label: "(2,30]", lo: 2, hi: 30 }, { label: "(30,120]", lo: 30, hi: 120 }, { label: ">120min", lo: 120 }];
  return { withPeak, mfeBuckets, byReason, holdBuckets };
}

function reportChannel(name: string, set: Row[], json: boolean) {
  const o = stat(set);
  const calls = set.filter((r) => r.dir === "call"), puts = set.filter((r) => r.dir === "put");
  if (json) {
    const out: any = { channel: name, n: o.n, exp: o.exp, win: o.win, mfe: o.mfe, giveback: o.gb, callExp: stat(calls).exp, putExp: stat(puts).exp, indicators: {} };
    for (const ind of INDS) out.indicators[ind.name] = ind.buckets.map((b) => { const s = stat(set.filter((r) => inBucket(ind.val(r), b, r))); return { bucket: b.label, n: s.n, exp: s.exp, win: s.win, mfe: s.mfe }; });
    console.log(JSON.stringify(out));
    return;
  }
  console.log(`\n━━━━ ${name} ━━━━  n=${o.n}  exp ${usd(o.exp)}/t  win ${f0(o.win)}%  MFE ${f1(o.mfe)}%(${o.mfeN})  giveback ${f1(o.gb)}%   [calls ${usd(stat(calls).exp)} ${calls.length}t · puts ${usd(stat(puts).exp)} ${puts.length}t]`);
  for (const ind of INDS) {
    const cells = ind.buckets.map((b) => {
      const s = stat(set.filter((r) => inBucket(ind.val(r), b, r)));
      return s.n === 0 ? `${b.label}:—` : `${b.label}: ${usd(s.exp)}/t (${s.n}t,w${f0(s.win)},M${f1(s.mfe)})`;
    });
    console.log(`  ${ind.name.padEnd(28)} ${cells.join("  ")}`);
  }
  // exit lens
  const ex = exitLens(set);
  console.log(`  ${"EXIT · MFE→giveback".padEnd(28)} ${ex.mfeBuckets.map((b) => { const s = stat(ex.withPeak.filter((r) => inBucket(r.mfePct, b as Bucket, r))); return s.n ? `${b.label}: gb ${f1(s.gb)}% (${s.n}t, exp ${usd(s.exp)})` : `${b.label}:—`; }).join("  ")}`);
  console.log(`  ${"EXIT · holdMin→exp".padEnd(28)} ${ex.holdBuckets.map((b) => { const s = stat(set.filter((r) => r.holdMin != null && inBucket(r.holdMin, b as Bucket, r))); return s.n ? `${b.label}: ${usd(s.exp)}/t (${s.n}t,w${f0(s.win)})` : `${b.label}:—`; }).join("  ")}`);
  const reasons = [...ex.byReason.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`  ${"EXIT · by reason".padEnd(28)} ${reasons.map(([k, rs]) => { const s = stat(rs); return `${k}: ${usd(s.exp)}/t (${s.n}t,w${f0(s.win)})`; }).join("  ")}`);
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const ci = args.indexOf("--channel");
  const chArg = ci >= 0 ? args[ci + 1] : null;

  if (!chArg) { // roster summary
    const bySlug = new Map<string, Row[]>();
    for (const r of rows) { const k = r.slug; (bySlug.get(k) ?? bySlug.set(k, []).get(k)!).push(r); }
    const roster = [...bySlug.entries()].map(([slug, rs]) => ({ slug, name: rs[0].channel, ...stat(rs) })).sort((a, b) => b.n - a.n);
    if (json) { console.log(JSON.stringify(roster.map((r) => ({ slug: r.slug, name: r.name, n: r.n, exp: r.exp, win: r.win })))); return; }
    console.log(`\n  FORENSICS ROSTER · ${rows.length} trades · ${roster.length} channels (06-01→06-24, ONE chop/put-tape month — capital-blind, HYPOTHESES only)\n`);
    console.log(`  ${"slug".padEnd(24)} ${"name".padEnd(16)}  ${"n".padStart(5)}  ${"exp/t".padStart(8)}  ${"win%".padStart(5)}`);
    for (const r of roster) console.log(`  ${r.slug.padEnd(24)} ${(r.name ?? "").slice(0, 16).padEnd(16)}  ${String(r.n).padStart(5)}  ${usd(r.exp).padStart(8)}  ${f0(r.win).padStart(5)}`);
    console.log(`\n  → mine a channel: npm run forensics-mine -- --channel <slug>\n`);
    return;
  }

  // match by slug OR display name (case-insensitive contains)
  const q = chArg.toLowerCase();
  const set = rows.filter((r) => r.slug.toLowerCase() === q || r.slug.toLowerCase().includes(q) || (r.channel ?? "").toLowerCase().includes(q));
  if (!set.length) { console.error(`no trades for channel "${chArg}" (try: npm run forensics-mine)`); process.exit(1); }
  const slugs = [...new Set(set.map((r) => r.slug))];
  for (const slug of slugs) reportChannel(`${set.find((r) => r.slug === slug)!.channel} [${slug}]`, set.filter((r) => r.slug === slug), json);
  // archetype aggregate — per-channel n is small (one chop month); the combined view is where bucket signal lives
  if (slugs.length > 1 && !json) reportChannel(`AGGREGATE "${chArg}" — ${slugs.length} channels, n=${set.length} (where the per-bucket signal lives; per-channel above is mostly noise at this n)`, set, json);
}
main();
