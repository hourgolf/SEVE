// ============================================================================
//  chop-router-probe — is the Nakamoto reversal book CHOP-NATIVE, and can the
//  10:30 morning gate ROUTE to it?
//
//  Brainstorm follow-through (2026-06-11): the desk's books are trend/breakout
//  rides — chop days (like 06-10's 20-leg whipsaw) flummox them. Two pieces were
//  each REFUTED alone: the morning regime gate (real but modest as an on/off
//  switch — memory regime-gate-validated) and the Nakamoto level-reversal port
//  (NO EDGE always-on, but one green regime: CHOPMIX-25-26 +$7.8k — memory
//  nakamoto-backtest-kit-assessment). This probe tests the COMPOSITION: does the
//  reversal book's P&L concentrate on the days the gate would call no-go?
//
//  Join 1 (ORACLE, upper bound): phase2 per-day P&L vs the REALIZED day shape —
//    reversal-leg count (≥0.3% legs on SPY 1-min closes, the day-report whipsaw
//    metric). Answers: is the edge chop-conditional AT ALL? Uses end-of-day
//    knowledge — a ceiling, not a strategy.
//  Join 2 (EX-ANTE): the 10:30 morning score = mean percentile of |open→10:30
//    net drift| and first-hour VWAP-persistence (the validated gate features).
//    no-go = score < 0.5 (low drift + low persistence = predicted chop).
//    Answers: can we ROUTE by 10:30? CAVEAT: percentiles ranked over the full
//    corpus = mildly in-sample. HYPOTHESIS-GENERATOR, not an arm ticket — an arm
//    would need the per-window OOS threshold fit the original gate work used.
//
//    npm run chop-router-probe
// ============================================================================

import { readFileSync } from "node:fs";
import { loadRealSessions } from "./realsource";

interface Day { date: string; window: string; pnl: number; trades: number }

function pctRank(values: number[], v: number): number {
  let below = 0;
  for (const x of values) if (x < v) below++;
  return below / values.length;
}

async function main() {
  // ---- phase2 per-day P&L (Nakamoto port, real NBBO, 313 sessions) ----
  const rows = readFileSync("data/handoff-verify/phase2/daily_pnl.csv", "utf8").trim().split("\n").slice(1);
  const days = new Map<string, Day>();
  for (const r of rows) {
    const [date, window, pnl, , trades] = r.split(",");
    days.set(date, { date, window, pnl: Number(pnl), trades: Number(trades) });
  }

  // ---- SPY session bars → realized shape + morning features ----
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  interface Feat { legs: number; drift: number; persist: number }
  const feats = new Map<string, Feat>();
  for (const s of sessions) {
    if (!days.has(s.dateET) || s.bars.length < 90) continue;
    // realized whipsaw legs (day-report metric): direction flips of ≥0.30% moves
    let legs = 0, anchor = s.bars[0].close, dir = 0;
    for (const b of s.bars) {
      const move = (b.close - anchor) / anchor;
      if (Math.abs(move) >= 0.003) {
        const d = Math.sign(move);
        if (d !== dir && dir !== 0) legs++;
        if (d !== dir) dir = d;
        anchor = b.close;
      }
    }
    // morning features, knowable by 10:30 ET (first 60 session minutes)
    const first = s.bars.slice(0, 60);
    const open = first[0].open;
    const drift = Math.abs(first[first.length - 1].close - open) / open;
    const above = first.filter((b) => b.close > b.vwap).length / first.length;
    const persist = Math.max(above, 1 - above);
    feats.set(s.dateET, { legs, drift, persist });
  }
  const joined = [...days.values()].filter((d) => feats.has(d.date));

  // ---- ex-ante score (full-corpus percentile — see header caveat) ----
  const drifts = joined.map((d) => feats.get(d.date)!.drift);
  const persists = joined.map((d) => feats.get(d.date)!.persist);
  const score = (d: Day) => (pctRank(drifts, feats.get(d.date)!.drift) + pctRank(persists, feats.get(d.date)!.persist)) / 2;

  const fmt = (set: Day[], label: string) => {
    const pnl = set.reduce((a, d) => a + d.pnl, 0);
    const t = set.reduce((a, d) => a + d.trades, 0);
    const perDay = set.length ? pnl / set.length : 0;
    return `${label.padEnd(26)} ${String(set.length).padStart(4)}d  ${String(t).padStart(5)}t  $${Math.round(pnl).toString().padStart(7)}  ${perDay >= 0 ? "+" : ""}${perDay.toFixed(1)}/day`;
  };
  const windows = [...new Set(joined.map((d) => d.window))];

  console.log(`\n  CHOP-ROUTER probe · Nakamoto reversal book (phase2, real NBBO) × day-shape · ${joined.length} joined sessions`);
  console.log(`  Always-on verdict stands (NO EDGE pooled). Question: is the P&L CHOP-CONDITIONAL, and is 10:30 routing enough?\n`);

  console.log(`  JOIN 1 — ORACLE (realized whipsaw legs; end-of-day knowledge = ceiling):`);
  for (const [lo, hi, lbl] of [[0, 2, "trendy (≤2 legs)"], [3, 4, "mixed (3-4 legs)"], [5, 99, "choppy (≥5 legs)"]] as Array<[number, number, string]>) {
    const set = joined.filter((d) => { const L = feats.get(d.date)!.legs; return L >= lo && L <= hi; });
    console.log(`    ${fmt(set, lbl)}`);
  }

  console.log(`\n  JOIN 2 — EX-ANTE 10:30 gate score (no-go <0.5 = predicted chop; in-sample percentiles — hypothesis only):`);
  const nogo = joined.filter((d) => score(d) < 0.5);
  const go = joined.filter((d) => score(d) >= 0.5);
  console.log(`    ${fmt(nogo, "no-go days (route HERE)")}`);
  console.log(`    ${fmt(go, "go days (trend book runs)")}`);
  console.log(`\n    per window (no-go vs go $):`);
  for (const w of windows) {
    const wd = joined.filter((d) => d.window === w);
    const n = wd.filter((d) => score(d) < 0.5), g = wd.filter((d) => score(d) >= 0.5);
    const s1 = Math.round(n.reduce((a, d) => a + d.pnl, 0)), s2 = Math.round(g.reduce((a, d) => a + d.pnl, 0));
    console.log(`      ${w.padEnd(16)} no-go ${String(n.length).padStart(3)}d $${String(s1).padStart(6)}   go ${String(g.length).padStart(3)}d $${String(s2).padStart(6)}`);
  }

  // router hit rate: of the realized-choppy days, how many does 10:30 catch?
  const choppy = joined.filter((d) => feats.get(d.date)!.legs >= 5);
  const caught = choppy.filter((d) => score(d) < 0.5).length;
  console.log(`\n  ROUTER HIT RATE: 10:30 no-go catches ${caught}/${choppy.length} realized-choppy days (${Math.round((100 * caught) / Math.max(1, choppy.length))}%).`);
  console.log(`  READ: interest = choppy-day $/day ≫ trendy-day $/day (Join 1) AND no-go $/day > 0 (Join 2).`);
  console.log(`  Next step if it prints: per-window OOS threshold fit (the original gate protocol) before any build.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
