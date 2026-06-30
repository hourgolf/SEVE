// stop-sweep-probe — the DOWNSIDE counterpart to the give-back work. Holds each channel's
// recommended take-profit FIXED and sweeps the premium STOP (−30/−35/−40/−45/−50%), re-entry-
// aware, bar-by-bar (so dip-then-rally vs straight-down resolves correctly — order matters, which
// a pure MAE re-pricing can't do). Question: does a TIGHTER stop cut the straight-down losers more
// than it whipsaws the dip-and-recover winners? Reports pooled exp$/t + the 2 CHOP windows
// (Mar26, CMix) specifically, since chop is the desk's real regime. Modeled NBBO (databento-mdte).
//   npx tsx --env-file=.env.local engine/stop-sweep-probe.ts
import { prep, simChannel, specEval, V3, ALT, WINDOWS, byWindow, pool, exp$, type Ch, type Prepped } from "./lever-shared";
import { STRATEGY_REGISTRY } from "./registry";
import type { Bar } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const reg = (slug: string) => (s: { bars: unknown }) => STRATEGY_REGISTRY[slug].build(s.bars as Bar[], 1);
const MOMO: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 }, { kind: "strong_trend", dir: "up" }, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 }, { kind: "strong_trend", dir: "down" }, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
] as any;

// channel, its recommended take-profit (held fixed), DTE, max contracts
const CHANS: { name: string; mk: (s: any) => any; tp?: number; dte: 0 | 1; maxC: number }[] = [
  { name: "V3 (lock22)",   mk: specEval(V3 as any, "15:25"), tp: 22, dte: 0, maxC: 6 },
  { name: "ALT (lock22)",  mk: specEval(ALT as any, "15:25"), tp: 22, dte: 0, maxC: 6 },
  { name: "BREAK-base22",  mk: reg("breakout"), tp: 22, dte: 0, maxC: 6 },
  { name: "MOMO (ride)",   mk: specEval(MOMO, "15:25"), tp: undefined, dte: 0, maxC: 6 },
  { name: "GRIND (tp20)",  mk: reg("grind-v3"), tp: 20, dte: 0, maxC: 6 },
];
const STOPS = [30, 35, 40, 45, 50];
const CHOP = new Set(["CHOP Mar26", "CHOP-MIX 25-26"]);
const p = (s: any, w: number) => String(s).padStart(w);

function chopExp(rs: { date: string; win: string | null; pnl: number; n: number }[]) {
  const f = rs.filter((r) => r.win && CHOP.has(r.win));
  const tot = f.reduce((a, r) => a + r.pnl, 0), n = f.reduce((a, r) => a + r.n, 0);
  return n ? tot / n : NaN;
}
const f1 = (v: number) => (Number.isNaN(v) ? "   —" : (v >= 0 ? "+" : "") + v.toFixed(1));

async function main() {
  const D: Prepped = await prep("SPY", "data/databento-mdte");
  console.log(`\n  STOP-SWEEP · TP held at recommended, premium stop swept · ${D.real.length} SPY sessions · re-entry-aware, bar-by-bar`);
  console.log(`  pooled exp$/t (all 5 windows) | CHOP-only exp$/t (Mar26 + CMix — the real regime) · best pooled = *\n`);
  console.log(`  ${p("channel", 14)}${STOPS.map((s) => p(`stop${s}`, 9)).join("")}   |  ${STOPS.map((s) => p(`chop${s}`, 8)).join("")}`);
  for (const c of CHANS) {
    const rows = STOPS.map((stop) => {
      const ch: Ch = { name: c.name, sym: "SPY", dte: c.dte, maxC: c.maxC, mk: c.mk, px: { ...(c.tp ? { profitPct: c.tp } : {}), stopPct: stop } };
      const rs = simChannel(D, ch);
      return { stop, pooledExp: (pool(rs).n ? pool(rs).tot / pool(rs).n : NaN), chop: chopExp(rs), n: pool(rs).n };
    });
    const best = rows.reduce((a, b) => (Number.isNaN(b.pooledExp) ? a : b.pooledExp > a.pooledExp ? b : a), rows[0]);
    const pooledCells = rows.map((r) => p(f1(r.pooledExp) + (r.stop === best.stop ? "*" : " "), 9)).join("");
    const chopCells = rows.map((r) => p(f1(r.chop), 8)).join("");
    console.log(`  ${p(c.name, 14)}${pooledCells}   |  ${chopCells}`);
  }
  console.log(`\n  READ: for the find-and-surrender book (V3/ALT/BREAK) a tighter stop WINS if stop30/35 > stop50 on pooled AND chop.`);
  console.log(`  MOMO (ride) should PREFER a loose stop (it rides dips to its tail). ⚠ modeled options → directional; live MAE lens cross-checks.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
