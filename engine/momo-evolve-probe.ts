// ============================================================================
//  momo-evolve-probe (MOVE 4) — the COMPILER as a SEARCH OPERATOR. LLM-proposed
//  momo-shape variants (data/move4-variants.json), each backtested on the faithful
//  5-window harness, judged by the ANTI-OVERFIT bar the desk warns about: base momo
//  is 3/5 and "sweeping maxWidthPct to force 4/5 = overfitting." So a variant only
//  counts as REAL if it (a) passes ≥4/5 windows, (b) BEATS base momo, and (c) its
//  gain is SPREAD (no single window > 55% of positive Σ) — the leave-one-out /
//  concentration guard. A 4/5 that's one-window-carried is the mirage (fingerprint #1).
//
//  This tests the "machine as discovery engine" thesis. Expected, per the desk's own
//  conclusion (directional frontier mined + chop wall): mostly refutes — a clean
//  confirmation completing the MOVE 0 (edge real-but-thin) + MOVE 3 (generalizes)
//  trilogy. A survivor that clears the concentration bar would be a genuine find.
//
//  npm run momo-evolve-probe
// ============================================================================

import { readFileSync } from "node:fs";
import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO,
  WINDOWS, winOf, usd, maxDD, bootP5, type Channel,
} from "./roster-faithful";
import type { RealSession } from "./realsource";
import type { Bar, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

interface Variant {
  name: string; rationale: string; rangeBars: number; maxWidthPct: number;
  strongTrend: boolean; curl: boolean; gapMin: number; timeBeforeET: string;
  confluence: "all" | "anyOf2of3"; exit: "ride" | "compound30";
}

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];

function buildSpec(v: Variant): StrategySpec {
  const legOf = (dir: "up" | "down"): StrategySpec["entries"][number] => {
    const rb: any = { kind: "range_break", dir, bars: v.rangeBars, maxWidthPct: v.maxWidthPct };
    const st: any = { kind: "strong_trend", dir };
    const cu: any = { kind: "curl", dir };
    const vw: any = { kind: "vwap_side", side: dir === "up" ? "above" : "below" };
    const gm: any = v.gapMin > 0 ? { kind: "gap_min", pct: v.gapMin } : null;
    const tb: any = { kind: "time_before", et: v.timeBeforeET };
    const direction = dir === "up" ? "call" : "put";
    if (v.confluence === "anyOf2of3") {
      return { direction, reason: dir, all: [rb, ...(gm ? [gm] : []), tb], anyOf: { atLeast: 2, of: [st, cu, vw] } } as any;
    }
    return { direction, reason: dir, all: [rb, ...(v.strongTrend ? [st] : []), ...(v.curl ? [cu] : []), vw, ...(gm ? [gm] : []), tb] } as any;
  };
  return { meta, exits: [{ timeET: "15:25" }], sizing: {}, entries: [legOf("up"), legOf("down")] };
}

const chOf = (v: Variant): Channel => {
  const def = specToStrategyDef(buildSpec(v));
  return {
    name: v.name, slug: "momo-ev", symbol: "SPY", dte: 0, maxC: 6, oos: true,
    mk: (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }),
    premiumExit: v.exit === "compound30" ? { profitPct: 30, stopPct: 50 } : { stopPct: 50 },
  };
};

function run(ch: Channel, real: RealSession[], chainFor: (s: RealSession) => any) {
  let total = 0, n = 0; const series: number[] = []; const byWin: Record<string, number> = {};
  for (const s of real) {
    const ts: Trade[] = simulateSession(s.bars, cfgOf(ch.maxC), FUND, ch.mk(s), chainFor(s), false, ch.premiumExit, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE });
    const pnl = ts.reduce((a, x) => a + x.pnl, 0);
    total += pnl; n += ts.length; series.push(pnl);
    const w = winOf(s.dateET); if (w) byWin[w] = (byWin[w] ?? 0) + pnl;
  }
  const wins = WINDOWS.filter((w) => (byWin[w.name] ?? 0) > 0).length;
  const cov = WINDOWS.filter((w) => byWin[w.name] != null).length;
  const posWins = WINDOWS.map((w) => byWin[w.name] ?? 0).filter((x) => x > 0);
  const posSum = posWins.reduce((a, x) => a + x, 0);
  const conc = posSum > 0 ? Math.max(...posWins) / posSum : 1; // top-window share of positive Σ
  return { total, n, series, byWin, wins, cov, conc, tail: bootP5(series) };
}

async function main() {
  const variants: Variant[] = JSON.parse(readFileSync("data/move4-variants.json", "utf8"));
  const { channels, corpusOf } = await loadFaithfulRoster();
  const corpus = corpusOf("SPY");

  // base momo (range+strong_trend+gap0.25, strict-AND, ride, 14:00) for the bar
  const base = chOf({ name: "BASE momo", rationale: "", rangeBars: 8, maxWidthPct: 0.5, strongTrend: true, curl: false, gapMin: 0.25, timeBeforeET: "14:00", confluence: "all", exit: "ride" });
  const bSess = sessionsFor(base, corpus);
  const bOut = run(base, bSess.real, bSess.chainFor);

  console.log(`\n  MOMO EVOLVE (MOVE 4) · ${variants.length} LLM-proposed variants · faithful 5-window OOS · anti-overfit: ≥4/5 AND beat base AND conc<55%`);
  console.log(`  BASE momo: Σ ${usd(bOut.total)} · ${bOut.wins}/${bOut.cov} windows · top-window ${Math.round(bOut.conc * 100)}% of +Σ · tail ${usd(bOut.tail)}\n`);
  console.log(`  variant                                Σ            wins   conc   tail       verdict`);

  const real: { v: Variant; o: ReturnType<typeof run> }[] = [];
  for (const v of variants) {
    const ch = chOf(v);
    const { real: rs, chainFor } = sessionsFor(ch, corpus);
    if (!rs.length) { console.log(`  ${v.name.slice(0, 36).padEnd(36)} no data`); continue; }
    const o = run(ch, rs, chainFor);
    const beatsBase = o.total > bOut.total;
    const survivor = o.wins >= 4 && beatsBase && o.conc < 0.55;
    const verdict = survivor ? "★ SURVIVOR (≥4/5, beats base, spread)" : o.wins >= 4 ? (o.conc >= 0.55 ? "4/5 but ONE-WINDOW-CARRIED (overfit)" : "4/5 but ≤ base") : o.total <= 0 ? "−EV" : `${o.wins}/5`;
    real.push({ v, o });
    console.log(`  ${v.name.slice(0, 36).padEnd(36)} ${usd(o.total).padStart(9)} (${String(o.n).padStart(3)}t) ${o.wins}/${o.cov}  ${String(Math.round(o.conc * 100)).padStart(3)}%  ${usd(o.tail).padStart(8)}  ${verdict}`);
  }

  const survivors = real.filter((r) => r.o.wins >= 4 && r.o.total > bOut.total && r.o.conc < 0.55).sort((a, b) => b.o.total - a.o.total);
  console.log(`\n  ${survivors.length ? `★ ${survivors.length} SURVIVOR(S) cleared the anti-overfit bar:` : "NO survivor cleared the bar — the directional-shape frontier is confirmed MINED (LLM search incl.)."}`);
  for (const s of survivors.slice(0, 3)) {
    console.log(`    ${s.v.name} · Σ ${usd(s.o.total)} · ${s.o.wins}/5 · ${WINDOWS.map((w) => `${w.name.split(" ")[0]} ${usd(s.o.byWin[w.name] ?? 0)}`).join(" ")}`);
    console.log(`      rationale: ${s.v.rationale}`);
    console.log(`      ⚠ a survivor here is a PAPER-LAB candidate, NOT an arm — it still owes a held-out window backfill (never-probed) + forward observation.`);
  }
  console.log(`  READ: MOVE 0 (edge real-but-thin) + MOVE 3 (generalizes to IWM) + MOVE 4 (can the compiler discover a NEW`);
  console.log(`  shape?) — if MOVE 4 refutes, the trilogy is clean: the edge is V3/ALT-family + cross-index, not new shapes. [[desk-doctrine]]\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
