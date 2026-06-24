// ============================================================================
//  stall-exit-probe — STRAND-4 stall-exit across the FULL faithful roster
//  (desk-doctrine.md). The stall-exit cuts a NON-MOVER (held ≥ minMinutes, peak
//  mark never popped past maxFavorPct above entry) to free the one-at-a-time slot.
//
//  This tests it on EVERY channel — the doctrine's per-channel prediction is:
//   • TAIL channels (V3/ALT, QQQ-ORB) → stall should HURT (amputates the convex tail) → OFF
//   • no-tail BLEEDERS (orb-trend-rider, pb-ride, pb-ride-2, power) → should HELP (free dead slots)
//   • fast SCALPERS (grind) → ~neutral (self-recycle in ~3 min; nothing to cut)
//  A surprise (stall helping a tail channel, or hurting a bleeder) is a finding.
//
//  FAITHFUL: real Databento NBBO, live 0.25-tick gate vs 1-tick fills, RISK 500 / −50% stop,
//  each channel's live spec + native target, 5-window OOS (SPY) / single-regime (QQQ).
//  Per channel: baseline vs a focused PATIENT grid (the orb-trend-rider calibration found the
//  shape is patient — long N, generous X; short/tight OVERCUTS = mini-amputation). Reports each
//  channel's best stall + Δ + windows-hold + the verdict. `--deep <slug>` = full 20-config sweep.
//
//  npm run stall-exit-probe  [--deep orb-trend-rider]
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, ENTRY_GATE,
  WINDOWS, winOf, usd, type Channel,
} from "./roster-faithful";
import type { Trade } from "./types";

type Stall = { minMinutes: number; maxFavorPct: number };
const holdMin = (t: Trade) => ((t.exitTs ?? 0) - (t.entryTs ?? 0)) / 60000;

// Focused PATIENT grid (+ a couple shorter, to catch a 0DTE channel that resolves faster).
const GRID: Stall[] = [
  { minMinutes: 45, maxFavorPct: 15 }, { minMinutes: 60, maxFavorPct: 25 },
  { minMinutes: 90, maxFavorPct: 20 }, { minMinutes: 120, maxFavorPct: 20 },
  { minMinutes: 120, maxFavorPct: 25 }, { minMinutes: 150, maxFavorPct: 25 },
];
const DEEP_NS = [30, 45, 60, 90, 120, 150], DEEP_XS = [10, 15, 20, 25];

async function main() {
  const deepSlug = (() => { const i = process.argv.indexOf("--deep"); return i >= 0 ? process.argv[i + 1] : null; })();
  const { channels, corpusOf } = await loadFaithfulRoster();

  const runChannel = (ch: Channel, stall: Stall | undefined) => {
    const corpus = corpusOf(ch.symbol);
    const { real, chainFor } = sessionsFor(ch, corpus);
    const perWin = new Map<string, number>();
    const trades: Trade[] = [];
    for (const s of real) {
      const ts = simulateSession(
        s.bars, cfgOf(ch.maxC), FUND, ch.mk(s) as any, chainFor(s), false, ch.premiumExit,
        FILL_1T, undefined, undefined, undefined, undefined, 0, ENTRY_GATE, undefined, undefined,
        undefined, stall, // addGate (17th) = undefined · stallExit (18th)
      );
      const w = winOf(s.dateET); const day = ts.reduce((a, t) => a + t.pnl, 0);
      if (w) perWin.set(w, (perWin.get(w) ?? 0) + day);
      trades.push(...ts);
    }
    return { total: trades.reduce((a, t) => a + t.pnl, 0), perWin, trades, n: real.length };
  };

  if (deepSlug) { // full sweep on one channel
    const ch = channels.find((c) => c.slug === deepSlug)!;
    const base = runChannel(ch, undefined);
    const baseWin = WINDOWS.map((w) => base.perWin.get(w.name) ?? 0);
    console.log(`\n  DEEP SWEEP · ${ch.name} (${ch.slug}) · ${base.n} sessions\n  baseline Σ ${usd(base.total)} · ${base.trades.length}t · median hold ${pctile(base.trades.map(holdMin), 0.5).toFixed(0)}min\n`);
    const rows: any[] = [];
    for (const N of DEEP_NS) for (const X of DEEP_XS) {
      const r = runChannel(ch, { minMinutes: N, maxFavorPct: X });
      const wins = WINDOWS.filter((w, i) => (r.perWin.get(w.name) ?? 0) >= baseWin[i] - 1).length;
      const st = r.trades.filter((t) => t.exitReason === "stall_exit");
      rows.push({ N, X, total: r.total, d: r.total - base.total, wins, stN: st.length });
    }
    rows.sort((a, b) => b.total - a.total);
    for (const r of rows) console.log(`    N${String(r.N).padStart(3)} X${String(r.X).padStart(2)}%  Σ ${usd(r.total).padStart(8)}  Δ ${usd(r.d).padStart(7)}  win${r.wins}/5  cuts ${r.stN}`);
    return;
  }

  // ── ALL-CHANNEL: baseline vs the best PATIENT-grid stall, per channel ──
  console.log(`\n  STALL-EXIT ACROSS THE FULL ROSTER · faithful real-NBBO · patient grid ${GRID.length} configs\n`);
  console.log(`  channel              tail?  baseΣ      best-stallΣ  Δ        config      win   cuts  VERDICT`);
  const tailSet = new Set(["breakout-alt-v3", "breakout-smart-entries", "orb-qqq-trail"]); // doctrine tail channels
  for (const ch of channels) {
    const base = runChannel(ch, undefined);
    const baseWin = WINDOWS.map((w) => base.perWin.get(w.name) ?? 0);
    let best = { total: base.total, cfg: null as Stall | null, wins: ch.oos ? 5 : 1, cuts: 0 };
    for (const g of GRID) {
      const r = runChannel(ch, g);
      if (r.total > best.total) {
        const wins = ch.oos ? WINDOWS.filter((w, i) => (r.perWin.get(w.name) ?? 0) >= baseWin[i] - 1).length : 1;
        best = { total: r.total, cfg: g, wins, cuts: r.trades.filter((t) => t.exitReason === "stall_exit").length };
      }
    }
    const d = best.total - base.total;
    const isTail = tailSet.has(ch.slug);
    // VERDICT: a tail channel where ANY stall helps = a surprise to investigate; where best==baseline = OFF confirmed.
    const verdict = best.cfg == null
      ? (isTail ? "OFF ✓ (no stall beats baseline — tail intact)" : "no help (stall never beats baseline)")
      : isTail
        ? `⚠ stall HELPS a tail ch — investigate amputation read`
        : d > 200 && best.wins >= 4 ? `HELP — field candidate` : `marginal`;
    const cfgStr = best.cfg ? `N${best.cfg.minMinutes}/X${best.cfg.maxFavorPct}` : "—";
    console.log(`  ${ch.name.padEnd(20)} ${(isTail ? "TAIL" : ch.oos ? "spy" : "qqq").padEnd(5)}  ${usd(base.total).padStart(8)}  ${usd(best.total).padStart(9)}  ${usd(d).padStart(7)}  ${cfgStr.padEnd(10)} ${ch.oos ? best.wins + "/5" : " — "}  ${String(best.cuts).padStart(4)}  ${verdict}`);
  }
  console.log(`\n  READ: stall-exit is a FREE-THE-STUCK-SLOT lever — it should HELP no-tail bleeders that DWELL`);
  console.log(`  (orb-trend-rider, pb-ride) and be OFF/neutral elsewhere. A tail channel it "helps" = a false-positive`);
  console.log(`  to investigate (likely amputating its convex tail in a flat window). Fast scalpers (grind) + fast-`);
  console.log(`  resolving 0DTE have little dwell to cut. The LIVE field-test target is pb-ride (1DTE, longest dwell).`);
  console.log(`  ⚠ faithful spec channels model the −50% stop + native target, NOT their live chandelier (roster-faithful`);
  console.log(`  caveat) — the stall DELTA is valid within-channel; absolute Σ is the pyramid-ext simplification. [[desk-doctrine]]\n`);
}

function pctile(xs: number[], p: number): number { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; }

main().catch((e) => { console.error(e); process.exit(1); });
