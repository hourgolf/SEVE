// ============================================================================
//  scheme-gauntlet-probe — does the operator's exit scheme (−50% stop → +10% lock once
//  +30% is touched, +40% auto-flatten) help or cap the validated keepers (V3/ALT) across
//  the 5-window OOS? The one-day what-if (06-22) said it lost $2k on the cut bleeders, but
//  that's noise on channels we cut; this is the real test on the keepers.
//
//  RIDE   = current armed config: −50% premium stop, ride to 15:25 (no target, no lock).
//           [sanity anchor: should reproduce the gate-audit base — V3 ≈ +$8,309, ALT ≈ +$8,927]
//  SCHEME = premiumExit {stopPct 50, profitPct 40} + breakevenExit {engagePct 30, lockPct 10}.
//  Base edge (no pyramid) to isolate the EXIT scheme; faithful (real NBBO, live 0.25 gate,
//  RISK 500), 5-window OOS + boot-p5 tail + concentration (ex-top3) + win%.
//
//    npm run scheme-gauntlet-probe
// ============================================================================

import { simulateSession } from "./backtest";
import {
  loadFaithfulRoster, sessionsFor, cfgOf, FUND, FILL_1T, GATE_LIVE, RATIO,
  WINDOWS, winOf, usd, maxDD, bootP5, type Channel,
} from "./roster-faithful";
import type { RealSession } from "./realsource";
import type { Trade } from "./types";

interface Mode { name: string; premium: { stopPct?: number; profitPct?: number }; be?: { engagePct: number; lockPct?: number } }
const MODES: Mode[] = [
  { name: "RIDE (−50% stop, ride to 15:25)", premium: { stopPct: 50 } },
  { name: "SCHEME (+10% lock @+30%, +40% target)", premium: { stopPct: 50, profitPct: 40 }, be: { engagePct: 30, lockPct: 10 } },
];

interface Res { tot: number; n: number; wins: number; series: number[]; byWin: Record<string, number>; tr: number[] }
function run(ch: Channel, real: RealSession[], chainFor: (s: RealSession) => any, m: Mode): Res {
  let tot = 0, n = 0, wins = 0; const series: number[] = []; const byWin: Record<string, number> = {}; const tr: number[] = [];
  for (const s of real) {
    const ts: Trade[] = simulateSession(
      s.bars, cfgOf(ch.maxC), FUND, ch.mk(s), chainFor(s), false, m.premium, FILL_1T,
      undefined, undefined, m.be, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
    );
    let day = 0; for (const t of ts) { tot += t.pnl; day += t.pnl; n++; if (t.pnl > 0) wins++; tr.push(t.pnl); }
    series.push(day); const w = winOf(s.dateET); if (w) byWin[w] = (byWin[w] ?? 0) + day;
  }
  return { tot, n, wins, series, byWin, tr };
}

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();
  const spy = corpusOf("SPY");
  const targets = channels.filter((c) => c.slug === "breakout-alt-v3" || c.slug === "breakout-smart-entries");

  console.log(`\n  SCHEME GAUNTLET · V3/ALT base edge · RIDE vs SCHEME (+10% lock @+30%, +40% target) · faithful real-NBBO, 5-window OOS\n`);
  const combined: Record<string, Res[]> = {};
  for (const ch of targets) {
    const { real, chainFor } = sessionsFor(ch, spy);
    console.log(`  ══ ${ch.name} (${real.length} sessions) ══`);
    console.log(`  mode                                   pooled         win%   OOS wins   tail p5    Σ ex-top3`);
    for (const m of MODES) {
      const r = run(ch, real, chainFor, m);
      (combined[m.name] ??= []).push(r);
      const winsPos = WINDOWS.filter((w) => (r.byWin[w.name] ?? 0) > 0).length;
      const winsCov = WINDOWS.filter((w) => r.byWin[w.name] != null).length;
      const sorted = [...r.tr].sort((a, b) => b - a);
      const exTop3 = r.tot - sorted.slice(0, 3).reduce((a, x) => a + x, 0);
      const winPct = r.n ? Math.round((100 * r.wins) / r.n) : 0;
      console.log(`  ${m.name.padEnd(38)} ${`${usd(r.tot)} (${r.n}t)`.padStart(14)}   ${String(winPct).padStart(3)}%   ${`${winsPos}/${winsCov}`.padStart(7)}   ${usd(bootP5(r.series)).padStart(8)}   ${usd(exTop3).padStart(8)}`);
      const cells = WINDOWS.map((w) => `${w.name.split(" ")[0]} ${usd(r.byWin[w.name] ?? 0)}`).join("  ");
      console.log(`     per-window: ${cells}`);
    }
    console.log("");
  }
  console.log(`  ══ V3 + ALT combined ══`);
  for (const m of MODES) {
    const rs = combined[m.name];
    const tot = rs.reduce((a, r) => a + r.tot, 0);
    const byWin: Record<string, number> = {};
    for (const r of rs) for (const w of WINDOWS) byWin[w.name] = (byWin[w.name] ?? 0) + (r.byWin[w.name] ?? 0);
    const winsPos = WINDOWS.filter((w) => (byWin[w.name] ?? 0) > 0).length;
    console.log(`  ${m.name.padEnd(38)} ${usd(tot).padStart(10)}   ${winsPos}/5 windows   per-window: ${WINDOWS.map((w) => `${w.name.split(" ")[0]} ${usd(byWin[w.name] ?? 0)}`).join("  ")}`);
  }
  console.log(`\n  READ: SCHEME beats RIDE only if it lifts pooled AND tail AND holds ≥4/5 windows. Prior (breakeven-probe + ride-the-convex-`);
  console.log(`  tail) says the +40% target CAPS the trend windows (where V3/ALT's edge lives) → expect SCHEME to win chop, lose trend, net worse.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
