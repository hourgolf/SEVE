// ============================================================================
//  momo-shape-probe — a GENERATIVE new-shape hunt (2026-06-22). The single-leg
//  directional space is largely mined, but the candle-shape vocab (range_break /
//  strong_trend / curl, built for nakamoto parity) has NEVER been composed into a
//  NEW momentum shape on our stack — only nakamoto's refuted REVERSALS used it.
//
//  CANDIDATE "MOMO": an intraday momentum-CONTINUATION entry triggered by a break
//  of a COMPRESSED rolling prior-8-bar range (range_break) + a strong momentum
//  candle (strong_trend) — NOT anchored to the hardcoded 30-min opening range that
//  V3/ALT use. THESIS: trend days produce multiple momentum legs; the ORB catches
//  the first, a range_break continuation could catch later legs V3/ALT miss → a
//  DIVERSIFIER, not a duplicate. Built per the settled fingerprints: gap-gated
//  (gap_min — flat opens bleed), ride exit (15:25 + −50% stop; scalp exits are
//  cost-walled), no 1-min volume confirm (it subtracts).
//
//  Faithful gauntlet (== roster-cost-audit / roster-faithful): RISK 500 / stop 500,
//  live 0.25 gate split from the 1-tick fill, real Databento NBBO, 5-window OOS.
//  Reports pooled + per-window + tail + the KEY decorrelation metric: what % of
//  MOMO trade-days are NOT V3 trade-days (new edge vs re-discovering V3).
//
//    npm run momo-shape-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO,
  WINDOWS, winOf, usd, maxDD, bootP5, type Channel,
} from "./roster-faithful";
import type { RealSession } from "./realsource";
import type { Bar, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"]) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries });
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};

type Opts = { gap: boolean; trend: boolean; curl: boolean };
const leg = (dir: "up" | "down", o: Opts): StrategySpec["entries"][number]["all"] => [
  { kind: "range_break", dir, bars: 8 } as any,
  ...(o.trend ? [{ kind: "strong_trend", dir } as any] : []),
  ...(o.curl ? [{ kind: "curl", dir } as any] : []),
  { kind: "vwap_side", side: dir === "up" ? "above" : "below" },
  ...(o.gap ? [{ kind: "gap_min", pct: 0.25 } as any] : []),
  { kind: "time_before", et: "14:00" } as any,
];
const shape = (o: Opts): StrategySpec["entries"] => [
  { direction: "call", reason: "u", all: leg("up", o) },
  { direction: "put", reason: "d", all: leg("down", o) },
];

const chOf = (name: string, o: Opts): Channel =>
  ({ name, slug: "momo", symbol: "SPY", dte: 0, maxC: 6, oos: true, mk: specEval(shape(o)), premiumExit: { stopPct: 50 } });

const CANDIDATES: Channel[] = [
  chOf("MOMO range+trend+gap", { gap: true, trend: true, curl: false }),
  chOf("MOMO range+trend (NO gap)", { gap: false, trend: true, curl: false }),
  chOf("MOMO range+gap (NO trend)", { gap: true, trend: false, curl: false }),
  chOf("MOMO range+curl+gap", { gap: true, trend: false, curl: true }),
];

interface Out { total: number; n: number; series: number[]; byWin: Record<string, number>; days: Set<string> }
function run(ch: Channel, real: RealSession[], chainFor: (s: RealSession) => any, fillSlip: number): Out {
  const fill = fillSlip === 1 ? FILL_1T : GATE_LIVE; // 1-tick (faithful) vs 0.25 (bracket)
  let total = 0, n = 0; const series: number[] = []; const byWin: Record<string, number> = {}; const days = new Set<string>();
  for (const s of real) {
    const ts: Trade[] = simulateSession(s.bars, cfgOf(ch.maxC), FUND, ch.mk(s), chainFor(s), false, ch.premiumExit, fill,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE });
    const pnl = ts.reduce((a, x) => a + x.pnl, 0);
    total += pnl; n += ts.length; series.push(pnl);
    const w = winOf(s.dateET); if (w) byWin[w] = (byWin[w] ?? 0) + pnl;
    if (ts.length) days.add(s.dateET);
  }
  return { total, n, series, byWin, days };
}

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();
  const corpus = corpusOf("SPY");
  const v3 = channels.find((c) => c.slug === "breakout-alt-v3")!;
  const v3Sess = sessionsFor(v3, corpus);
  const v3Out = run(v3, v3Sess.real, v3Sess.chainFor, 1);

  console.log(`\n  MOMO SHAPE PROBE · new-vocab momentum-continuation (range_break + strong_trend, gap-gated, ride exit)`);
  console.log(`  faithful: RISK 500 / live 0.25 gate / 1-tick fill, real NBBO, 5-window OOS. V3 baseline for context + decorrelation.\n`);
  console.log(`  V3 baseline:  ${usd(v3Out.total)} (${v3Out.n}t, ${v3Out.days.size} trade-days)  4/5-window validated convex core\n`);
  console.log(`  candidate                      faithful          bracket(.25)   OOS wins   tail p5    new-days (not V3)   verdict`);

  for (const ch of CANDIDATES) {
    const { real, chainFor } = sessionsFor(ch, corpus);
    if (!real.length) { console.log(`  ${ch.name.padEnd(28)} no data`); continue; }
    const f = run(ch, real, chainFor, 1);
    const b = run(ch, real, chainFor, 0.25);
    const winsPos = WINDOWS.filter((w) => (f.byWin[w.name] ?? 0) > 0).length;
    const winsCov = WINDOWS.filter((w) => f.byWin[w.name] != null).length;
    const tail = bootP5(f.series);
    const lo = Math.min(f.total, b.total), hi = Math.max(f.total, b.total);
    const verdict = hi < 0 ? "−EV bleeds" : lo > 0 ? "+EV survives" : "mixed (straddles 0)";
    // decorrelation: trade-days NOT shared with V3
    const newDays = [...f.days].filter((d) => !v3Out.days.has(d)).length;
    const newPct = f.days.size ? Math.round((100 * newDays) / f.days.size) : 0;
    console.log(`  ${ch.name.padEnd(28)} ${`${usd(f.total)} (${f.n}t)`.padStart(16)}   ${usd(b.total).padStart(12)}   ${`${winsPos}/${winsCov}`.padStart(7)}   ${usd(tail).padStart(8)}   ${`${newDays}d (${newPct}%)`.padStart(12)}   ${verdict}`);
    const cells = WINDOWS.map((w) => `${w.name.split(" ")[0]} ${usd(f.byWin[w.name] ?? 0)}`).join("  ");
    console.log(`     per-window: ${cells}   maxDD ${usd(maxDD(f.series))}`);
  }
  console.log(`\n  READ: a NEW edge = +EV survives the bracket, ≥4/5 windows, AND high new-days% (fires when V3 doesn't = real`);
  console.log(`  diversification). High overlap + similar P&L = just re-discovering V3. CHOP-MIX-only profit = the mirage (fingerprint #1).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
