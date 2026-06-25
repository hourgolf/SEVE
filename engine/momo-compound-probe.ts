// momo-compound-probe — the operator's challenge: MOMO "dumbly rides" a morning ATM 0DTE to EOD, so a
// winner that round-trips (today: +34%→−50%) both gives the gain back AND blocks the reversal signal
// (slot occupied). Test COMPOUNDING: add a take-profit so it BANKS the winner, frees the one-at-a-time
// slot, and RE-ENTERS the next signal (incl. the opposite-direction leg) — "profitable twice". The
// engine is re-entry-aware (re-enters when flat), so sweeping the profit target IS the compound test.
// Faithful lever-shared harness (RISK 500, gate 3.0@0.25, 1-tick fills, 5 OOS windows), ATM (MOMO's best
// strike). Key lens = TOTAL (compounding adds at-bats) + trade count (the re-entries) + exp/t (quality).
//   npx tsx --env-file=.env.local engine/momo-compound-probe.ts
import { simulateSession } from "./backtest";
import { prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, specEval, type Prepped } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Trade } from "./types";

const momoLegs: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 } as any, { kind: "strong_trend", dir: "up" } as any, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 } as any, { kind: "strong_trend", dir: "down" } as any, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const TARGETS = [0, 30, 40, 50, 75, 100]; // 0 = ride (no target, the live config); >0 = bank at +pct% then re-enter
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);

const ev = specEval(momoLegs, "15:25");
function run(D: Prepped, profitPct: number): { date: string; ts: Trade[] }[] {
  const px = profitPct > 0 ? { profitPct, stopPct: 50 } : { stopPct: 50 };
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfgOf(6), FUND, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN, reentr: z.filter((x) => x.ts.length > 1).length }; };
const wtot = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) : NaN; };

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  MOMO COMPOUND PROBE · ride (no target) vs bank-and-re-enter · ATM · re-entry-aware · ${D.real.length} SPY sessions`);
  console.log(`  ${p("target", 8)}${p("n", 5)}${p("exp/t", 7)}${p("TOTAL", 9)}${p("win", 5)}${p("multiDay", 9)}   ${WINDOWS.map((w) => p(w.short, 9)).join("")}`);
  const rideTot = stat(run(D, 0)).tot;
  for (const tp of TARGETS) {
    const z = run(D, tp), s = stat(z);
    const wins = WINDOWS.map((w) => p(usd(wtot(z, w.name)), 9)).join("");
    const tag = tp === 0 ? " RIDE" : s.tot > rideTot ? " *" : "";
    console.log(`  ${p(tp === 0 ? "ride" : "+" + tp + "%", 8)}${p(s.n, 5)}${p(f1(s.exp), 7)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}${p(s.reentr + "d", 9)}   ${wins}${tag}`);
  }
  console.log(`\n  multiDay = # of days with >1 trade (the compounding re-entries — banked the 1st, caught another). * = TOTAL beats the ride.`);
  console.log(`  thesis (operator): banking frees the slot to catch the 2nd leg → more profitable at-bats. Refuted if no target beats the ride TOTAL (the tail the ride keeps > the at-bats compounding adds). Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
