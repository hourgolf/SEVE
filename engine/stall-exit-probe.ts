// ============================================================================
//  stall-exit-probe — STRAND-4 calibration on orb-trend-rider (desk-doctrine.md).
//
//  The stall-exit cuts a NON-MOVER (held ≥ minMinutes, peak mark never popped past
//  maxFavorPct above entry) to free the one-at-a-time slot. orb-trend-rider is the
//  CALIBRATION SUBSTRATE because pyramid-roster proved it has NO convex tail → ~ZERO
//  slow-builder-amputation risk (you can't amputate a tail that doesn't exist). So this
//  isolates the MECHANISM: on a no-tail bleeder, does cutting dead slots free +EV
//  re-entries? And what (minMinutes, maxFavorPct) shape works? The tuned shape then
//  transfers to the LIVE field-test on pb-ride (1DTE, longer dwell → its own N>90).
//
//  FAITHFUL: real Databento NBBO, the live 0.25-tick gate vs 1-tick fills, RISK 500 /
//  −50% stop, orb-trend-rider's live spec + its +75% native target, 5-window OOS.
//  Reads the doctrine's bar (Σ up AND ≥4/5 windows hold/improve) — NOT a mirage. If the
//  mechanism FAILS even here (no tail to confound it), the mechanical stall-exit is
//  likely unbuildable and strand-4 stays human-led.
//
//  npm run stall-exit-probe
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, ENTRY_GATE,
  WINDOWS, winOf, usd, maxDD,
} from "./roster-faithful";
import type { Trade } from "./types";

type Stall = { minMinutes: number; maxFavorPct: number };

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();
  const ch = channels.find((c) => c.slug === "orb-trend-rider");
  if (!ch) throw new Error("orb-trend-rider not in faithful roster");
  const corpus = corpusOf(ch.symbol);
  const { real, chainFor } = sessionsFor(ch, corpus);

  // Run orb-trend-rider over every session at a given stall config (undefined = baseline).
  const run = (stall?: Stall) => {
    const perWin = new Map<string, { pnl: number; n: number }>();
    const daily: number[] = [];
    const trades: Trade[] = [];
    for (const s of real) {
      const ts = simulateSession(
        s.bars, cfgOf(ch.maxC), FUND, ch.mk(s) as any, chainFor(s), false, ch.premiumExit,
        FILL_1T, undefined, undefined, undefined, undefined, 0, ENTRY_GATE, undefined, undefined,
        undefined, stall, // addGate (17th) = undefined · stallExit (18th)
      );
      const w = winOf(s.dateET);
      const dayPnl = ts.reduce((a, t) => a + t.pnl, 0);
      if (w) { const e = perWin.get(w) ?? { pnl: 0, n: 0 }; e.pnl += dayPnl; e.n += ts.length; perWin.set(w, e); }
      daily.push(dayPnl);
      trades.push(...ts);
    }
    const total = trades.reduce((a, t) => a + t.pnl, 0);
    return { trades, perWin, daily, total };
  };

  const base = run();
  const baseWin = WINDOWS.map((w) => base.perWin.get(w.name)?.pnl ?? 0);
  const holdMin = (t: Trade) => ((t.exitTs ?? 0) - (t.entryTs ?? 0)) / 60000; // entryTs/exitTs are epoch-ms numbers

  console.log(`\n  STALL-EXIT CALIBRATION · orb-trend-rider (no-tail substrate, ~zero amputation risk) · ${real.length} sessions · faithful 5-window OOS\n`);
  console.log(`  BASELINE (no stall): Σ ${usd(base.total)} · ${base.trades.length} trades · ${(100 * base.trades.filter((t) => t.pnl > 0).length / Math.max(1, base.trades.length)).toFixed(0)}% win · maxDD ${usd(maxDD(base.daily))}`);
  console.log(`    per-window: ${WINDOWS.map((w, i) => `${w.name.split(" ")[0]} ${usd(baseWin[i])}`).join(" · ")}`);
  console.log(`    baseline hold-time: median ${median(base.trades.map(holdMin)).toFixed(0)}min · p90 ${pctile(base.trades.map(holdMin), 0.9).toFixed(0)}min\n`);

  console.log(`  SWEEP (Σ · Δvs-base · windows≥base · stall-cuts: n/Σ/medHold) — ★ = Σ up AND ≥4/5 windows hold-or-improve:`);
  const Ns = [30, 45, 60, 90, 120];
  const Xs = [10, 15, 20, 25];
  const rows: { N: number; X: number; total: number; d: number; winsHold: number; stallN: number; stallPnl: number; medHold: number; star: boolean }[] = [];
  for (const N of Ns) for (const X of Xs) {
    const r = run({ minMinutes: N, maxFavorPct: X });
    const win = WINDOWS.map((w) => r.perWin.get(w.name)?.pnl ?? 0);
    const winsHold = win.filter((v, i) => v >= baseWin[i] - 1).length; // hold-or-improve vs baseline
    const stalls = r.trades.filter((t) => t.exitReason === "stall_exit");
    const star = r.total > base.total + 1 && winsHold >= 4;
    rows.push({ N, X, total: r.total, d: r.total - base.total, winsHold, stallN: stalls.length, stallPnl: stalls.reduce((a, t) => a + t.pnl, 0), medHold: stalls.length ? median(stalls.map(holdMin)) : 0, star });
  }
  rows.sort((a, b) => b.total - a.total);
  for (const r of rows) {
    console.log(
      `    ${r.star ? "★" : " "} N${String(r.N).padStart(3)} X${String(r.X).padStart(2)}%  Σ ${usd(r.total).padStart(8)}  Δ ${usd(r.d).padStart(7)}  win${r.winsHold}/5  stall ${String(r.stallN).padStart(3)}/${usd(r.stallPnl).padStart(7)} med ${r.medHold.toFixed(0)}min`,
    );
  }

  const best = rows[0];
  const stars = rows.filter((r) => r.star);
  console.log(`\n  READ: ${stars.length ? `${stars.length} config(s) clear the bar (Σ up + ≥4/5 windows) — the stall mechanism frees +EV slots on a no-tail bleeder.` : "NO config clears the bar — cutting stalls does NOT free +EV slots even on a no-tail channel → the mechanical stall-exit is likely unbuildable; strand-4 stays human-led."}`);
  console.log(`  Best Σ: N${best.N}/X${best.X}% → ${usd(best.total)} (Δ ${usd(best.d)} vs baseline ${usd(base.total)}); stall-cuts realized ${usd(best.stallPnl)} over ${best.stallN} dead slots at med ${best.medHold.toFixed(0)}min hold.`);
  console.log(`  ⚠ This is the MECHANISM + shape test on a zero-amputation substrate. A win here graduates to the LIVE pb-ride (1DTE) field-test with pb-ride's own dwell-tuned N (>90min); a real-NBBO slow-builder-amputation check is MANDATORY before any tail-channel ever sees it (OFF on V3/ALT/QQQ/momo). [[desk-doctrine]]\n`);
}

function median(xs: number[]): number { return pctile(xs, 0.5); }
function pctile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
}

main().catch((e) => { console.error(e); process.exit(1); });
