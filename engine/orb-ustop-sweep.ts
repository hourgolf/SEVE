// orb-ustop-sweep — pin the underlying-move stop level for the live ORB spec (band 1.0, ATM, NO premium
// stop). Sweep underlyingStopPct ∈ {0.20..0.40} vs the live −50% premium stop. Faithful RISK harness.
//   npx tsx --env-file=.env.local engine/orb-ustop-sweep.ts
import { simulateSession } from "./backtest";
import { specEval, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, type Prepped } from "./lever-shared";
import type { StrategySpec, Trade } from "./types";

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);
const orbLegs = (): StrategySpec["entries"] => [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
function run(D: Prepped, uStop: number, premStop: number): { date: string; ts: Trade[] }[] {
  const ev = specEval(orbLegs(), "15:25"), cfg = cfgOf(6);
  const px = premStop > 0 ? { stopPct: premStop } : {};
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfg, FUND, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, undefined, undefined, undefined, uStop, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0) }));
}
const stat = (z: { date: string; ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? 100 * f.filter((t) => t.pnl > 0).length / n : NaN, stop: n ? 100 * f.filter((t) => /stop/.test(t.exitReason ?? "")).length / n : NaN }; };
const wexp = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  ORB uStop SWEEP · live orb spec · band 1.0 ATM · ${D.real.length} SPY sessions (faithful RISK, real NBBO)`);
  console.log(`  ${p("stop", 16)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}${p("stop%", 6)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}${p("dropBest", 9)}`);
  const cells = [{ k: "prem50 (LIVE)", u: 0, ps: 50 }, { k: "uStop0.20", u: 0.20, ps: 0 }, { k: "uStop0.25", u: 0.25, ps: 0 }, { k: "uStop0.30", u: 0.30, ps: 0 }, { k: "uStop0.35", u: 0.35, ps: 0 }, { k: "uStop0.40", u: 0.40, ps: 0 }];
  for (const c of cells) {
    const z = run(D, c.u, c.ps), s = stat(z);
    const wv = WINDOWS.map((w) => wexp(z, w.name));
    const dropBest = wv.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b).slice(0, -1).reduce((a, b) => a + b, 0); // sum excl. best window
    console.log(`  ${p(c.k, 16)}${p(s.n, 5)}${p(f1(s.exp), 8)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}${p(Math.round(s.stop), 6)}   ${wv.map((v) => p(f1(v), 8)).join("")}${p(f1(dropBest), 9)}`);
  }
  console.log(`\n  dropBest = Σ per-window exp/t excluding the single best window (overfit guard). Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
