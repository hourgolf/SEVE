// conf-gate-probe — does MOMO's "nose" fix V3/ALT's finds-and-surrenders ENTRY?
//
// V3/ALT fire on the FIRST close beyond the 30-min opening range with NO check on the breakout
// BAR's quality → in chop that first poke is a wicky graze that reverses (the giveback probe: V3
// reaches +30% only 45% of the time). MOMO requires a `strong_trend` candle (body>65% of range,
// close in top/bottom 20% = a decisive thrust) out of an 8-bar `range_break` coil → it never takes
// a graze (70% reach +30%). Both are EXISTING armable vocab (specEvaluate.ts; MOMO arms on them).
//
// This adds those conditions to V3/ALT and measures, 5-window real-NBBO (the faithful lever-shared
// harness: RISK 500, cost gate 3.0 @0.25, 1-tick fills, re-entry-aware):
//   (1) exp$/t at the LIVE exit (+100/−50, 15:25) — the go/no-go (mechanical-mirage-proof; n drops
//       with a gate, so judge per-trade expectancy, NOT total),
//   (2) reach +30%/+50% — the MFE-survival mechanism (profit-target-hit method, mfe-probe's), i.e.
//       does the gate lift the hit-rate toward MOMO's ~70%,
//   (3) n — the frequency cost.
// MOMO's own entries are shown as the reference target. A "HOLDS" here is a SHADOW-CLONE candidate,
// not an arm (modeled options + the entry mined on-window → forward-validate). [[giveback-takeprofit-split]]
//   npx tsx --env-file=.env.local engine/conf-gate-probe.ts
import { simulateSession } from "./backtest";
import { prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, specEval, V3, ALT, type Prepped } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Trade } from "./types";

type Entries = StrategySpec["entries"];
// append a per-direction condition to each leg's `all` (call→up, put→down)
const withCond = (entries: Entries, up: any, down: any): Entries =>
  entries.map((e) => ({ ...e, all: [...e.all, e.direction === "call" ? up : down] })) as Entries;
const ST = (e: Entries) => withCond(e, { kind: "strong_trend", dir: "up" }, { kind: "strong_trend", dir: "down" });
const RB = (e: Entries) => withCond(e, { kind: "range_break", dir: "up", bars: 8 }, { kind: "range_break", dir: "down", bars: 8 });

// MOMO's actual live entries — the reference "nose" (the reach target)
const MOMO: Entries = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 }, { kind: "strong_trend", dir: "up" }, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 }, { kind: "strong_trend", dir: "down" }, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
] as any;

const VARIANTS: { name: string; entries: Entries }[] = [
  { name: "V3 base",        entries: V3 as Entries },
  { name: "V3 +strong",     entries: ST(V3 as Entries) },
  { name: "V3 +strong+rb",  entries: RB(ST(V3 as Entries)) },
  { name: "ALT base",       entries: ALT as Entries },
  { name: "ALT +strong",    entries: ST(ALT as Entries) },
  { name: "ALT +strong+rb", entries: RB(ST(ALT as Entries)) },
  { name: "— MOMO (ref)",   entries: MOMO },
];

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "   —" : (v >= 0 ? "+" : "") + v.toFixed(1));
const pct = (v: number) => (Number.isNaN(v) ? "  —" : Math.round(v) + "%");
const p = (s: any, w: number) => String(s).padStart(w);

// one pass: run entries at a given premium exit across all sessions (0DTE → same-day chain)
function pass(D: Prepped, entries: Entries, px: { profitPct?: number; stopPct?: number }) {
  const ev = specEval(entries, "15:25");
  return D.real.map((s) => ({
    win: winOf(s.dateET),
    ts: simulateSession(s.bars, cfgOf(6), FUND, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, undefined),
  }));
}
const flat = (z: { win: string | null; ts: Trade[] }[]) => z.flatMap((x) => x.ts);
// reach +X% = MFE survival via the profit-target-hit method (run at profitPct=X, frac exiting target_premium)
const reach = (D: Prepped, e: Entries, tgt: number) => {
  const f = flat(pass(D, e, { profitPct: tgt, stopPct: 50 }));
  return f.length ? 100 * f.filter((t) => t.exitReason === "target_premium").length / f.length : NaN;
};

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  CONFIRMATION-GATE PROBE · V3/ALT + MOMO's strong_trend/range_break nose · ${D.real.length} SPY sessions · 5-window real NBBO`);
  console.log(`  EV @ live exit (+100/−50, 15:25). reach% = MFE survival (profit-target-hit). gate ON, 1-tick fills.\n`);
  console.log(`  ${p("variant", 16)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}${p("rch30", 7)}${p("rch50", 7)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
  const rows = VARIANTS.map((v) => {
    const z = pass(D, v.entries, { profitPct: 100, stopPct: 50 });
    const f = flat(z), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0);
    const win = n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN;
    const wexp = WINDOWS.map((w) => { const ff = z.filter((x) => x.win === w.name).flatMap((x) => x.ts); return ff.length ? ff.reduce((a, t) => a + t.pnl, 0) / ff.length : NaN; });
    return { ...v, n, tot, exp: n ? tot / n : NaN, win, r30: reach(D, v.entries, 30), r50: reach(D, v.entries, 50), wexp };
  });
  for (const r of rows) {
    console.log(`  ${p(r.name, 16)}${p(r.n, 5)}${p(f1(r.exp), 8)}${p(usd(r.tot), 9)}${p(pct(r.win), 5)}${p(pct(r.r30), 7)}${p(pct(r.r50), 7)}   ${r.wexp.map((e) => p(f1(e), 8)).join("")}`);
  }
  console.log("");
  const verdict = (gated: string, base: string) => {
    const g = rows.find((r) => r.name === gated)!, b = rows.find((r) => r.name === base)!;
    const dW = g.wexp.map((e, i) => e - b.wexp[i]).filter((d) => !Number.isNaN(d));
    const help = dW.filter((d) => d > 0).length, of = dW.length;
    const dropBest = dW.length ? dW.reduce((a, x) => a + x, 0) - Math.max(...dW) : NaN;
    const robust = g.exp - b.exp > 0 && help >= Math.ceil(of * 0.8) && dropBest > 0;
    console.log(`  ${p(gated, 16)} Δexp ${f1(g.exp - b.exp)}/t · helps ${help}/${of} · drop-best ${f1(dropBest)} · reach30 ${pct(b.r30)}→${pct(g.r30)} · n ${b.n}→${g.n}  ⇒ ${robust ? "HOLDS" : "does not clearly hold"}`);
  };
  verdict("V3 +strong", "V3 base"); verdict("V3 +strong+rb", "V3 base");
  verdict("ALT +strong", "ALT base"); verdict("ALT +strong+rb", "ALT base");
  const momo = rows.find((r) => r.name === "— MOMO (ref)")!;
  console.log(`\n  MOMO (ref) reach30 = ${pct(momo.r30)} — the hit-rate the gate is trying to lift V3/ALT toward (base V3 ≈ 45% in the live giveback data).`);
  console.log(`  ⚠ modeled options + entry mined on-window → a HOLDS = a shadow-clone candidate, NOT an arm. Watch the n drop (frequency cost).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
