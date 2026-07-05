// ============================================================================
//  vb-fleet-probe — backtest PRIOR for the virtual bench fleet (59_virtual_bench_fleet).
//  Runs each vb-* spec (entries verbatim from the migration, its LIVE tp/−30 stop)
//  through the faithful harness (lever-shared: RISK $500, cost gate 3.0/0.25-tick,
//  real NBBO multi-DTE chains, 1-tick fills) over the 5 OOS regime windows.
//
//  PURPOSE: bank the historical prior BEFORE the fleet's forward virtual data
//  accrues, so forward-vs-prior divergence is itself a finding. ⚠ Modeled options
//  where the NBBO cache thins + 10 specs = a multiple-comparisons farm — nothing
//  here is an edge claim or an arm basis (registry A8). Paper research only.
//    npx tsx --env-file=.env.local engine/vb-fleet-probe.ts [--underlying QQQ|IWM]
//  CROSS-INDEX (2026-07-05, the 63_vb_cross_index clones): --underlying picks the
//  NBBO cache. Coverage differs — SPY/IWM span the full 5 windows (~312d); QQQ has
//  NO pre-2026 history (71d, ~2 windows — the known un-OOS-able caveat): label reads.
// ============================================================================
import { simulateSession } from "./backtest";
import { specEval, prep, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO, WINDOWS, winOf, type Prepped } from "./lever-shared";
import type { Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

type Entries = StrategySpec["entries"];
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f1 = (v: number) => (Number.isNaN(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1));
const p = (s: unknown, w: number) => String(s).padStart(w);

// entries VERBATIM from 59_virtual_bench_fleet.sql; tp = the channel's live take_profit_pct.
const FLEET: Array<{ slug: string; tp: number; entries: Entries }> = [
  { slug: "vb-vwap-revert", tp: 15, entries: [
    { direction: "put", reason: "s", all: [{ kind: "vwap_dev", atr: 2, cmp: ">" }, { kind: "time_between", startET: "10:00", endET: "14:45" }] },
    { direction: "call", reason: "s", all: [{ kind: "vwap_dev", atr: 2, cmp: "<" }, { kind: "time_between", startET: "10:00", endET: "14:45" }] }] },
  { slug: "vb-rsi-revert", tp: 15, entries: [
    { direction: "put", reason: "h", all: [{ kind: "rsi", period: 14, cmp: ">", value: 72 }, { kind: "stale_extreme", dir: "up", sinceMin: 6 }, { kind: "time_between", startET: "10:00", endET: "14:45" }] },
    { direction: "call", reason: "l", all: [{ kind: "rsi", period: 14, cmp: "<", value: 28 }, { kind: "stale_extreme", dir: "down", sinceMin: 6 }, { kind: "time_between", startET: "10:00", endET: "14:45" }] }] },
  { slug: "vb-level-break", tp: 25, entries: [
    { direction: "call", reason: "u", all: [{ kind: "level", ref: "pdh", cmp: ">" }, { kind: "rel_vol", min: 1.3 }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "time_before", et: "15:00" }] },
    { direction: "put", reason: "d", all: [{ kind: "level", ref: "pdl", cmp: "<" }, { kind: "rel_vol", min: 1.3 }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "time_before", et: "15:00" }] }] },
  { slug: "vb-or-fail", tp: 15, entries: [
    { direction: "put", reason: "r", all: [{ kind: "level", ref: "orb_hi", cmp: "near", withinPct: 0.05 }, { kind: "engulfing", dir: "down" }, { kind: "time_between", startET: "10:00", endET: "14:00" }] },
    { direction: "call", reason: "r", all: [{ kind: "level", ref: "orb_lo", cmp: "near", withinPct: 0.05 }, { kind: "engulfing", dir: "up" }, { kind: "time_between", startET: "10:00", endET: "14:00" }] }] },
  { slug: "vb-macd-state", tp: 25, entries: [
    { direction: "call", reason: "b", all: [{ kind: "macd", fast: 12, slow: 26, signal: 9, cmp: "bull", mode: "state" }, { kind: "strong_trend", dir: "up" }, { kind: "rel_vol", min: 1.2 }, { kind: "time_before", et: "15:00" }] },
    { direction: "put", reason: "b", all: [{ kind: "macd", fast: 12, slow: 26, signal: 9, cmp: "bear", mode: "state" }, { kind: "strong_trend", dir: "down" }, { kind: "rel_vol", min: 1.2 }, { kind: "time_before", et: "15:00" }] }] },
  { slug: "vb-curl-reversal", tp: 20, entries: [
    { direction: "call", reason: "c", all: [{ kind: "stale_extreme", dir: "down", sinceMin: 8 }, { kind: "curl", dir: "up", bars: 7 }, { kind: "time_between", startET: "10:00", endET: "14:45" }] },
    { direction: "put", reason: "c", all: [{ kind: "stale_extreme", dir: "up", sinceMin: 8 }, { kind: "curl", dir: "down", bars: 7 }, { kind: "time_between", startET: "10:00", endET: "14:45" }] }] },
  { slug: "vb-squeeze-break", tp: 25, entries: [
    { direction: "call", reason: "q", all: [{ kind: "range_break", dir: "up", bars: 10, maxWidthPct: 0.0035 }, { kind: "rel_vol", min: 1.2 }, { kind: "time_between", startET: "10:30", endET: "15:00" }] },
    { direction: "put", reason: "q", all: [{ kind: "range_break", dir: "down", bars: 10, maxWidthPct: 0.0035 }, { kind: "rel_vol", min: 1.2 }, { kind: "time_between", startET: "10:30", endET: "15:00" }] }] },
  { slug: "vb-pm-trend", tp: 25, entries: [
    { direction: "call", reason: "p", all: [{ kind: "time_between", startET: "13:00", endET: "15:00" }, { kind: "trend_align", side: "up" }, { kind: "momentum_atr", op: ">=", value: 0.4, lookback: 5 }] },
    { direction: "put", reason: "p", all: [{ kind: "time_between", startET: "13:00", endET: "15:00" }, { kind: "trend_align", side: "down" }, { kind: "momentum_atr", op: "<=", value: -0.4, lookback: 5 }] }] },
  { slug: "vb-gap-drift", tp: 25, entries: [
    { direction: "call", reason: "g", all: [{ kind: "gap_min", pct: 0.35 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "time_before", et: "11:00" }] },
    { direction: "put", reason: "g", all: [{ kind: "gap_min", pct: 0.35 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "time_before", et: "11:00" }] }] },
  { slug: "vb-ribbon-cross", tp: 25, entries: [
    { direction: "call", reason: "x", all: [{ kind: "ma_cross", fast: 9, slow: 21, dir: "up" }, { kind: "rel_vol", min: 1.2 }, { kind: "time_before", et: "14:00" }] },
    { direction: "put", reason: "x", all: [{ kind: "ma_cross", fast: 9, slow: 21, dir: "down" }, { kind: "rel_vol", min: 1.2 }, { kind: "time_before", et: "14:00" }] }] },
] as Array<{ slug: string; tp: number; entries: Entries }>;

function run(D: Prepped, entries: Entries, tp: number): { date: string; ts: Trade[] }[] {
  const ev = specEval(entries, "15:25"), cfg = cfgOf(6);
  const px = { profitPct: tp, stopPct: 30 }; // the fleet's live LOCK pair (tp / −30)
  return D.real.map((s) => ({ date: s.dateET, ts: simulateSession(s.bars, cfg, FUND, ev(s), D.chainFor(s, s.dateET), false, px, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, undefined, undefined, undefined, undefined, 0) }));
}
const stat = (z: { ts: Trade[] }[]) => { const f = z.flatMap((x) => x.ts), n = f.length, tot = f.reduce((a, t) => a + t.pnl, 0); return { n, tot, exp: n ? tot / n : NaN, win: n ? (100 * f.filter((t) => t.pnl > 0).length) / n : NaN }; };
const wexp = (z: { date: string; ts: Trade[] }[], w: string) => { const f = z.filter((x) => winOf(x.date) === w).flatMap((x) => x.ts); return f.length ? f.reduce((a, t) => a + t.pnl, 0) / f.length : NaN; };

const UND = ((): "SPY" | "QQQ" | "IWM" => {
  const i = process.argv.indexOf("--underlying");
  const v = (i >= 0 ? process.argv[i + 1] : "SPY").toUpperCase();
  if (v !== "SPY" && v !== "QQQ" && v !== "IWM") throw new Error(`unknown underlying ${v}`);
  return v;
})();
const CACHE: Record<string, string> = { SPY: "data/databento-mdte", QQQ: "data/databento-mdte-qqq", IWM: "data/databento-mdte-iwm" };

async function main() {
  const D = await prep(UND, CACHE[UND]);
  console.log(`\n  VB-FLEET PRIOR · ${D.real.length} ${UND} sessions · faithful RISK/gate · tp/−30 LOCK · real NBBO`);
  console.log(`  ${p("spec", 18)}${p("n", 6)}${p("exp/t", 8)}${p("total", 10)}${p("win", 5)}   ${WINDOWS.map((w) => p(w.short, 8)).join("")}${p("+wins", 7)}`);
  for (const c of FLEET) {
    const z = run(D, c.entries, c.tp), s = stat(z);
    const wv = WINDOWS.map((w) => wexp(z, w.name));
    const wPos = wv.filter((v) => !Number.isNaN(v) && v > 0).length;
    console.log(`  ${p(c.slug.replace(/^vb-/, ""), 18)}${p(s.n, 6)}${p(f1(s.exp), 8)}${p(usd(s.tot), 10)}${p(Number.isNaN(s.win) ? "—" : Math.round(s.win), 5)}   ${wv.map((v) => p(f1(v), 8)).join("")}${p(`${wPos}/5`, 7)}`);
  }
  console.log(`\n  PRIOR ONLY — modeled fills where NBBO thins; 10 specs = multiple comparisons; nothing armable from this (registry A8).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
