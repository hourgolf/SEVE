// momo-strike-probe — does the ITM strike finding transfer to MOMO's ACTUAL shape (range_break +
// strong_trend, NOT opening_range; ride exit, NO profit cap)? Sweeps strikeOffset ITM2→OTM2 on the
// live momo-shape entries via the faithful lever-shared harness (RISK 500, cost gate 3.0 @0.25, 1-tick
// fills, 5 OOS windows, re-entry-aware). ATM(0) = the live config (anchor).
//   npx tsx --env-file=.env.local engine/momo-strike-probe.ts
import { simulateSession } from "./backtest";
import { prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, specEval, type Prepped } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Trade } from "./types";

// LIVE momo-shape entries (gap:true, trend:true, curl:false), ride exit (−50% stop + 15:25 flatten, no profit cap)
const momoLegs: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 } as any, { kind: "strong_trend", dir: "up" } as any, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 } as any, { kind: "strong_trend", dir: "down" } as any, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const OFFSETS = [-2, -1, 0, 1, 2];
const label = (o: number) => (o === 0 ? "ATM" : o < 0 ? `ITM${-o}` : `OTM${o}`);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);

const ev = specEval(momoLegs, "15:25");
function run(D: Prepped, offset: number): { date: string; ts: Trade[] }[] {
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfgOf(6), FUND, ev(s), D.chainFor(s, s.dateET), false, { stopPct: 50 }, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, offset) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN, stop: n ? 100 * f.filter((t) => /stop/.test(t.exitReason ?? "")).length / n : NaN }; };
const wexp = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  MOMO STRIKE SWEEP · live momo-shape spec (range_break+strong_trend, ride −50% stop) · ${D.real.length} SPY sessions`);
  console.log(`  ${p("strike", 6)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}${p("stop%", 6)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
  const rows = OFFSETS.map((o) => ({ o, z: run(D, o) }));
  const base = stat(rows.find((r) => r.o === 0)!.z).exp;
  for (const { o, z } of rows) {
    const s = stat(z);
    const wins = WINDOWS.map((w) => p(f1(wexp(z, w.name)), 8)).join("");
    console.log(`  ${p(label(o), 6)}${p(s.n, 5)}${p(f1(s.exp), 8)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}${p(Math.round(s.stop), 6)}   ${wins}${o !== 0 && s.exp > base ? " *" : ""}`);
  }
  const cand = rows.filter((r) => r.o !== 0).map((r) => {
    const wd = WINDOWS.map((w) => wexp(r.z, w.name) - wexp(rows.find((x) => x.o === 0)!.z, w.name)).filter((d) => !Number.isNaN(d));
    return { o: r.o, dExp: stat(r.z).exp - base, helps: wd.filter((d) => d > 0).length, of: wd.length, dropBest: wd.length ? wd.reduce((a, b) => a + b, 0) - Math.max(...wd) : NaN };
  }).sort((a, b) => b.dExp - a.dExp);
  const b = cand[0];
  console.log(`\n  baseline (ATM, live) = ${f1(base)}/t. best offset ${label(b.o)}: Δexp ${f1(b.dExp)}/t · helps ${b.helps}/${b.of} · drop-best ${f1(b.dropBest)}  ⇒ ${b.dExp > 0 && b.helps >= Math.ceil(b.of * 0.8) && b.dropBest > 0 ? "ITM transfers — worth a closer look" : "ITM does NOT clearly transfer to MOMO's shape"}`);
  console.log(`  ⚠ gate ON (live-realistic; strike re-selects). Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
