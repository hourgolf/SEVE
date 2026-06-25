// orb-combined-probe — the live ORB channels (orb-trend-rider / orb-spy-trail = orbEntries spec) under
// the three levers TOGETHER: band (tighten the trigger toward the OR midpoint), strike (ATM vs ITM1),
// and the EXIT STOP (the −50% premium stop is up for debate). Faithful harness (lever-shared: RISK 500,
// cost gate 3.0 @0.25, 1-tick fills, 5 OOS windows, re-entry-aware, gate ON = the live-realistic test).
// Thesis chain: tightening enters earlier (more runway) but DIED on option fills because the −50% stop
// re-anchored to the cheaper entry; ITM + a better stop should let the runway survive.
//   npx tsx --env-file=.env.local engine/orb-combined-probe.ts
import { simulateSession } from "./backtest";
import { specEval, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, type Prepped } from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Trade } from "./types";

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: any, w: number) => String(s).padStart(w);

// the LIVE orb-trend-rider / orb-spy-trail entries, with the opening_range `band` parameterized
const orbLegs = (band: number): StrategySpec["entries"] => [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30, band }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30, band }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];

type Stop = { name: string; px: { profitPct?: number; stopPct?: number }; uStop?: number };
const STOPS: Record<string, Stop> = {
  prem50: { name: "prem50", px: { stopPct: 50 } },                 // the live −50% premium stop
  prem70: { name: "prem70", px: { stopPct: 70 } },                 // looser premium stop
  ride: { name: "ride", px: {} },                                  // no stop — ride to the 15:25 flatten
  uStop30: { name: "uStop30", px: {}, uStop: 0.30 },               // underlying-anchored stop (decoupled from premium)
  uStop20: { name: "uStop20", px: {}, uStop: 0.20 },
};

type Cell = { band: number; off: number; stop: string };
function run(D: Prepped, c: Cell): { date: string; ts: Trade[] }[] {
  const ev = specEval(orbLegs(c.band), "15:25"), cfg = cfgOf(6), st = STOPS[c.stop];
  const out: { date: string; ts: Trade[] }[] = [];
  for (const s of D.real) {
    const ts = simulateSession(s.bars, cfg, FUND, ev(s), D.chainFor(s, s.dateET), false, st.px, FILL_1T,
      undefined, undefined, undefined, undefined, st.uStop ?? 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, undefined, c.off);
    out.push({ date: s.dateET, ts });
  }
  return out;
}
const stat = (sess: { date: string; ts: Trade[] }[]) => {
  const f = sess.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0);
  return { n, tot, exp: n ? tot / n : NaN, win: n ? (100 * f.filter((t) => t.pnl > 0).length) / n : NaN, stop: n ? (100 * f.filter((t) => /stop/.test(t.exitReason ?? "")).length) / n : NaN };
};
const winExp = (sess: { date: string; ts: Trade[] }[], w: string) => { const f = sess.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };
const label = (c: Cell) => `b${c.band.toFixed(2)} ${c.off === 0 ? "ATM" : c.off < 0 ? "ITM" + -c.off : "OTM" + c.off} ${c.stop}`;

function row(D: Prepped, c: Cell, base: number) {
  const sess = run(D, c), s = stat(sess);
  const wins = WINDOWS.map((w) => p(f1(winExp(sess, w.name)), 8)).join("");
  const beats = s.exp > base ? " *" : "";
  console.log(`  ${p(label(c), 22)}${p(s.n, 5)}${p(f1(s.exp), 8)}${p(usd(s.tot), 9)}${p(Math.round(s.win), 5)}${p(Math.round(s.stop), 6)}   ${wins}${beats}`);
  return s.exp;
}

async function main() {
  const D = await prep("SPY", "data/databento-mdte");
  console.log(`\n  ORB COMBINED · live orb spec (band × strike × stop) · faithful RISK-500 harness, real NBBO · ${D.real.length} SPY sessions`);
  console.log(`  ${p("config", 22)}${p("n", 5)}${p("exp/t", 8)}${p("total", 9)}${p("win", 5)}${p("stop%", 6)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}`);
  const liveExp = run(D, { band: 1.0, off: 0, stop: "prem50" });
  const base = stat(liveExp).exp;
  console.log(`  ── A. band × strike (at the live −50% stop) ──`);
  for (const c of [{ band: 1.0, off: 0 }, { band: 0.5, off: 0 }, { band: 1.0, off: -1 }, { band: 0.5, off: -1 }].map((x) => ({ ...x, stop: "prem50" }))) row(D, c, base);
  console.log(`  ── B. stop design (at band 1.0) — the −50% stop is up for debate ──`);
  for (const off of [0, -1]) for (const stop of ["prem50", "prem70", "ride", "uStop30", "uStop20"]) row(D, { band: 1.0, off, stop }, base);
  console.log(`  ── C. the full combo ──`);
  for (const c of [{ band: 0.5, off: -1, stop: "ride" }, { band: 0.5, off: -1, stop: "uStop30" }, { band: 1.0, off: -1, stop: "uStop30" }]) row(D, c, base);
  console.log(`\n  baseline (live) = b1.00 ATM prem50 = ${f1(base)}/t. * = beats live pooled. stop% = % exited on a stop.`);
  console.log(`  ⚠ gate ON (live-realistic; strike re-selects the set — the pure-structure isolation is strike-isolation-probe). Modeled options → forward-test.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
