// ============================================================================
//  null-desk-probe — the FALSIFICATION test the machine never ran (MOVE 0).
//
//  66 probes, never one that could return a clean "NO." Every probe selected a
//  survivor against the 5 windows. This asks the opposite: does the REAL V3/ALT
//  signal beat its own NULL CLONES — same gap-gate, same entry TIMING, same
//  +100/−50/15:25 bracket, but DIRECTION randomized (coin flip)? If real V3/ALT
//  ranks low in the distribution of random-direction clones, the "edge" is the
//  GAP REGIME + the bracket structure, not the breakout DIRECTION signal — and
//  the project should say so. Pre-registered verdict + a stopping rule.
//
//  Three nulls, all faithful (real Databento NBBO, live 0.25-gate vs 1-tick fill,
//  RISK 500 / −50% stop, 5-window OOS — the EXACT roster-faithful harness):
//   • COIN-FLIP CLONES (N): real's entry timing, direction flipped 50/50 (seeded,
//     reproducible) → the distribution real V3/ALT must beat to be a real signal.
//   • ANTI-SIGNAL: always the OPPOSITE direction (a symmetry sanity check).
//   • GAP-FOLLOW BENCHMARK: be long the gap direction on EVERY gap day at ~10:00,
//     same bracket — "does the OR-break selection beat just following the catalyst?"
//     If it ties real, gap_min is the alpha and the breakout filter is decoration.
//
//  npm run null-desk-probe  [-- --clones 100]
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, ENTRY_GATE,
  WINDOWS, winOf, usd, type Channel,
} from "./roster-faithful";
import type { Evaluate, Trade } from "./types";
import type { RealSession } from "./realsource";

const CLONES = (() => { const i = process.argv.indexOf("--clones"); return i >= 0 ? Number(process.argv[i + 1]) : 100; })();
const GAP = 0.25;

// Per-clone, per-session deterministic PRNG (no Math.random — reproducible).
function flipEval(mk: (s: RealSession) => Evaluate, s: RealSession, seedBase: number, sIdx: number): Evaluate {
  let st = (seedBase * 2654435761 + sIdx * 40503 + 1) >>> 0;
  const rnd = () => { st = (st * 1103515245 + 12345) >>> 0; return st / 0xffffffff; };
  const real = mk(s);
  return (f, pos) => {
    const intent = real(f, pos);
    if (intent && intent.kind === "enter" && intent.direction) return { ...intent, direction: rnd() < 0.5 ? "call" : "put" };
    return intent;
  };
}
function antiEval(mk: (s: RealSession) => Evaluate, s: RealSession): Evaluate {
  const real = mk(s);
  return (f, pos) => {
    const intent = real(f, pos);
    if (intent && intent.kind === "enter" && intent.direction) return { ...intent, direction: intent.direction === "call" ? "put" : "call" };
    return intent;
  };
}
// Naive catalyst-follow: long the gap direction at ~10:00 on every gap day, same bracket + 15:25 flatten.
function gapFollowEval(s: RealSession): Evaluate {
  const g = s.gap ?? 0;
  return (f, pos) => {
    if (pos) return f.minutesToClose <= 35 ? { kind: "exit", reason: "eod_flatten" } : null;
    if (Math.abs(g) >= GAP && f.minutesToClose <= 360 && f.minutesToClose > 40)
      return { kind: "enter", direction: g >= 0 ? "call" : "put", reason: "gap_follow" };
    return null;
  };
}

function runEval(ch: Channel, real: RealSession[], chainFor: (s: RealSession) => any, evalFor: (s: RealSession, i: number) => Evaluate) {
  const perWin = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < real.length; i++) {
    const s = real[i];
    const ts: Trade[] = simulateSession(s.bars, cfgOf(ch.maxC), FUND, evalFor(s, i) as any, chainFor(s), false, ch.premiumExit, FILL_1T, undefined, undefined, undefined, undefined, 0, ENTRY_GATE);
    const day = ts.reduce((a, t) => a + t.pnl, 0);
    const w = winOf(s.dateET); if (w) perWin.set(w, (perWin.get(w) ?? 0) + day);
    total += day;
  }
  return { total, perWin };
}

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();
  const core = channels.filter((c) => c.slug === "breakout-alt-v3" || c.slug === "breakout-smart-entries");
  console.log(`\n  NULL-DESK FALSIFICATION · V3 + ALT vs ${CLONES} coin-flip-direction clones · faithful real-NBBO 5-window OOS`);
  console.log(`  Pre-registered: real <90th pct of clones = the "edge" is gap+bracket, NOT direction (STOP/simplify) · >99th = robust (double down).\n`);

  for (const ch of core) {
    const corpus = corpusOf(ch.symbol);
    const { real, chainFor } = sessionsFor(ch, corpus);
    const realRun = runEval(ch, real, chainFor, (s) => ch.mk(s));
    const anti = runEval(ch, real, chainFor, (s) => antiEval(ch.mk, s));
    const gapF = runEval(ch, real, chainFor, gapFollowEval);

    // clone distribution (pooled Σ)
    const cloneTotals: number[] = [];
    const cloneWin: number[][] = WINDOWS.map(() => []);
    for (let c = 0; c < CLONES; c++) {
      const r = runEval(ch, real, chainFor, (s, i) => flipEval(ch.mk, s, c + 1, i));
      cloneTotals.push(r.total);
      WINDOWS.forEach((w, wi) => cloneWin[wi].push(r.perWin.get(w.name) ?? 0));
    }
    const sorted = [...cloneTotals].sort((a, b) => a - b);
    const pct = (v: number, arr: number[]) => { const s = [...arr].sort((a, b) => a - b); let k = 0; while (k < s.length && s[k] < v) k++; return Math.round((100 * k) / s.length); };
    const q = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
    const realPct = pct(realRun.total, cloneTotals);
    const winPct = WINDOWS.map((w, wi) => pct(realRun.perWin.get(w.name) ?? 0, cloneWin[wi]));

    console.log(`  ── ${ch.name} (${ch.slug}) · ${real.length} sessions ──`);
    console.log(`     REAL Σ ${usd(realRun.total)}   ·  per-window: ${WINDOWS.map((w, wi) => `${w.name.split(" ")[0]} ${usd(realRun.perWin.get(w.name) ?? 0)}(${winPct[wi]}pct)`).join(" · ")}`);
    console.log(`     CLONE Σ dist (${CLONES} coin-flip): p5 ${usd(q(sorted, 0.05))} · p50 ${usd(q(sorted, 0.5))} · p95 ${usd(q(sorted, 0.95))} · max ${usd(sorted[sorted.length - 1])}`);
    console.log(`     ► REAL ranks at the ${realPct}th PERCENTILE of its own coin-flip clones  ${realPct >= 99 ? "✓ ROBUST" : realPct < 90 ? "✗ INDISTINGUISHABLE FROM RANDOM DIRECTION" : "⚠ AMBIGUOUS"}`);
    console.log(`     ANTI-signal (always opposite) Σ ${usd(anti.total)}  ·  GAP-FOLLOW benchmark (long the gap, no OR-break) Σ ${usd(gapF.total)}`);
    const orDecor = gapF.total >= realRun.total - 1;
    console.log(`     ${orDecor ? "⚠ GAP-FOLLOW ≥ REAL → the breakout/ORB filter is DECORATION; gap_min is the alpha." : "the OR-break filter beats naive gap-follow by " + usd(realRun.total - gapF.total) + " (the selection adds value over the gap alone)."}\n`);
  }
  console.log(`  READ: this is the experiment with a STOPPING RULE. A real signal sits in the right tail of its random-direction`);
  console.log(`  clones. If it sits in the bulk, "+\$17k / 4-of-5 windows" is the gap regime wearing a breakout costume — which`);
  console.log(`  doesn't mean stop trading, it means trade the GAP (simpler, more robust) and drop the false precision. [[desk-doctrine]]\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
