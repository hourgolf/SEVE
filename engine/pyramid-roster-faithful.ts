// ============================================================================
//  pyramid-roster-faithful — TASK 2 / lever #2 (SIZING breadth). (2026-06-19.)
//
//  pyramid-faithful proved cap12 is the sweet spot for V3/ALT (the validated convex core).
//  This extends that EXACT structure — RIDE vs +3@30% at maxStack {6, 12, ∞} + per-window OOS
//  + tail (block-bootstrap p5 + maxDD) — to the FULL faithful roster (engine/roster-faithful.ts):
//  ORB(trend-rider) + the base-ORB builtin, POWERHOUR base/ALT, PB 0/1DTE, GRIND v3, and the
//  QQQ trio. THE QUESTION: which channels BEYOND V3/ALT have a real convex tail that pyramiding
//  amplifies ROBUSTLY (Σ up AND tail intact AND ≥4/5 windows)?
//
//  PRIOR (the channel-shape synthesis): only convex-tail channels benefit — PB has no tail
//  (compound, don't pyramid), grind is a scalper, power is a final-hour lean, ORB is a drift
//  bleeder. So EXPECT V3/ALT to stay the only candidates. This CONFIRMS that across the
//  validated set + SIZES the cap12 decision — and would flag any surprise tail.
//
//  FAITHFUL: live 0.25 gate (ratio 3.0) distinct from the audited 1-tick fill, RISK 500 /
//  stop 500, each channel at its live DTE + max_contracts. SPY = 5-window OOS; QQQ = single
//  regime (2026-03→now), hypothesis-grade, NOT an OOS verdict.
//
//    npm run pyramid-roster
//
//  ⚠ a pyramid config "wins" only if Σ is higher AND the tail (maxDD/boot-p5) doesn't blow out
//  AND it holds across windows — pyramiding fattens the loser when the add bar marks the top.
// ============================================================================

import { simulateSession } from "./backtest";
import { loadFaithfulRoster, sessionsFor, FILL_1T, FUND, cfgOf, ENTRY_GATE, WINDOWS, winOf, usd, maxDD, bootP5, type Channel } from "./roster-faithful";
import type { Trade } from "./types";

type Pyr = { maxAdds: number; minProfitPct: number; maxStack?: number } | null;
const CONFIGS: Array<{ lbl: string; pyr: Pyr }> = [
  { lbl: "RIDE (no pyr)", pyr: null },
  { lbl: "+3@30% cap6", pyr: { maxAdds: 3, minProfitPct: 30, maxStack: 6 } },
  { lbl: "+3@30% cap12", pyr: { maxAdds: 3, minProfitPct: 30, maxStack: 12 } },
  { lbl: "+3@30% UNCAP", pyr: { maxAdds: 3, minProfitPct: 30 } },
];

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();

  const run = (ch: Channel, pyr: Pyr) => {
    const { real, chainFor } = sessionsFor(ch, corpusOf(ch.symbol));
    const daily: number[] = []; const byWin = new Map<string, number>();
    let tot = 0, n = 0, maxStack = 0;
    for (const s of real) {
      const ts: Trade[] = simulateSession(
        s.bars, cfgOf(ch.maxC), FUND, ch.mk(s) as any, chainFor(s), false, ch.premiumExit,
        FILL_1T, undefined, undefined, undefined, undefined, 0, ENTRY_GATE, undefined, pyr ?? undefined
      );
      const d = ts.reduce((a, x) => a + x.pnl, 0); daily.push(d); tot += d; n += ts.length;
      const w = winOf(s.dateET); if (w) byWin.set(w, (byWin.get(w) ?? 0) + d);
      for (const t of ts) maxStack = Math.max(maxStack, t.qty ?? 0);
    }
    return { tot, n, maxStack, dd: maxDD(daily), p5: bootP5(daily), byWin, sessions: real.length };
  };

  console.log(`\n  PYRAMID-ROSTER · TASK 2 / #2 SIZING breadth · FAITHFUL (live 0.25 gate + 1-tick fills) · RISK 500 / stop 500`);
  console.log(`  RIDE vs +3@30% at maxStack {6=cap, 12=2×, ∞=uncapped}. Which channels BEYOND V3/ALT have a pyramidable convex tail?`);
  console.log(`  win/W = windows where the config's per-window Σ ≥ RIDE's (SPY=5-window OOS; QQQ=single regime, /W covered)\n`);

  const summary: { ch: Channel; best: string; verdict: string }[] = [];

  for (const ch of channels) {
    // windows that have ≥1 session for this channel (QQQ covers only Mar/AprMay)
    const rideForWins = run(ch, null);
    const coveredWins = WINDOWS.map((w) => w.name).filter((wn) => ch.oos || rideForWins.byWin.has(wn));
    const W = coveredWins.length;
    console.log(`  ${ch.name}  [${ch.symbol}, ${ch.dte}DTE, ${rideForWins.sessions} sessions${ch.oos ? "" : " — single regime, NOT OOS"}]`);
    console.log(`    config           Σ P&L (trades)     maxStack   maxDD      boot-p5    vs RIDE     win/${W}`);
    let rideTot = 0; let rideWin = new Map<string, number>(); let rideP5 = rideForWins.p5;
    const stars: { lbl: string; tot: number }[] = [];
    for (const C of CONFIGS) {
      const r = C.lbl.startsWith("RIDE") ? rideForWins : run(ch, C.pyr);
      if (C.lbl.startsWith("RIDE")) { rideTot = r.tot; rideWin = r.byWin; rideP5 = r.p5; }
      const winCount = coveredWins.filter((wn) => r.byWin.get(wn)! >= (rideWin.get(wn) ?? -Infinity)).length;
      const gain = r.tot - rideTot;
      // A real pyramidable tail requires: (a) the channel is +EV under RIDE (Σ>0) — pyramiding a
      // structural loser just makes a less-bad loser; (b) Σ beats RIDE; (c) ≥80% windows; (d) the
      // Σ-gain DWARFS any boot-p5 worsening (the convex signature — V3 cap12: +$9.4k mean for a $0.3k
      // worse p5). "Tail intact" ≠ p5 ≥ RIDE; it = the tail didn't BLOW OUT relative to the gain.
      const tailOk = gain > Math.max(0, rideP5 - r.p5);
      const robust = rideTot > 0 && gain > 0 && winCount >= Math.ceil(0.8 * W) && tailOk;
      if (!C.lbl.startsWith("RIDE") && robust) stars.push({ lbl: C.lbl.replace("+3@30% ", ""), tot: r.tot });
      const vs = C.lbl.startsWith("RIDE") ? "" : `${usd(gain)}${gain > 0 ? " ✓" : ""}`;
      console.log(`    ${C.lbl.padEnd(14)} ${`${usd(r.tot)} (${r.n}t)`.padStart(18)}   ${String(r.maxStack).padStart(4)}     ${usd(r.dd).padStart(8)}   ${usd(r.p5).padStart(8)}   ${vs.padStart(9)}   ${C.lbl.startsWith("RIDE") ? "—" : `${winCount}/${W}`}${robust ? "  ★" : ""}`);
    }
    const bestStar = stars.length ? stars.reduce((a, b) => (b.tot > a.tot ? b : a)) : null;
    const verdict = rideTot <= 0 ? "−EV under RIDE — no tail to amplify (pyramiding a loser)"
      : stars.length === 0 ? "RIDE (+EV but no robust pyramid lift)"
      : `★ PYRAMIDABLE — robust at ${stars.map((s) => s.lbl).join(", ")} (best Σ ${usd(bestStar!.tot)} at ${bestStar!.lbl})`;
    summary.push({ ch, best: stars.length ? stars.map((s) => s.lbl).join("/") : "RIDE", verdict });
    console.log(`    → ${verdict}\n`);
  }

  console.log(`  ══ SUMMARY — pyramidable channels (★ = beats RIDE + tail intact + ≥80% windows) ══`);
  for (const s of summary) console.log(`    ${s.ch.name.padEnd(20)} ${s.ch.oos ? "    " : "QQQ "} ${s.verdict}`);
  console.log(`\n  READ: PRIOR expects only V3/ALT (real convex tail) to clear the bar; PB→compound (no tail), grind→scalper, power→lean,`);
  console.log(`  ORB→drift bleeder should NOT. Any OTHER ★ is a surprise tail worth a second look. cap12 is the established V3/ALT sweet`);
  console.log(`  spot — confirm it holds; uncap only adds risk-appetite $ at the worst DD. QQQ ★ is hypothesis-grade (single regime).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
