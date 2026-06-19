// ============================================================================
//  grind-slippage-probe — how much of grind-v3's −EV faithful backtest is the
//  SLIPPAGE ASSUMPTION vs a real lack of edge? (2026-06-19.)
//
//  The pyramid-roster faithful backtest put grind-v3 at −$16.8k (RIDE, 1,399 trades over
//  311 sessions) — but that uses 1-tick/side slippage applied across a high-frequency
//  scalper (~4.5 trades/session), and the spread-capture probe showed it's STILL −$9.8k at
//  mid fills (spread fully captured) → the residual is SLIPPAGE, not spread. A scalper is
//  exactly where a flat 1-tick assumption is least trustworthy, and the desk's own doctrine
//  is that the grind/power family is UNRANKABLE on backtest → validate live. grind-v3 is
//  +$371 over 22 live trades (mildly +, tiny sample).
//
//  So this isolates the slippage: same roster, FULL spread crossed, GATE held fixed (live
//  0.25), FILL slippage swept {0, 0.25, 0.5, 1.0} tick/side. 0 = mid+spread only (no extra
//  adverse fill); 0.25 = the gate-level (≈ a tight live cross); 1.0 = the faithful default.
//  Reports Σ / exp$/t / win%. Compares the 0.25-tick (closest-to-live) number to the live
//  +$371/22. grind-manual entries shown for reference (same entries, operator exits live).
//
//    npm run grind-slippage-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadFaithfulRoster, sessionsFor, FILL_1T, FUND, cfgOf, ENTRY_GATE, WINDOWS, usd, type Channel } from "./roster-faithful";
import type { CostModel } from "./cost";
import type { Trade } from "./types";

const SLIP = [0, 0.25, 0.5, 1.0];
const fillFor = (ticks: number): CostModel => ({ ...FILL_1T, slippageTicksPerSide: ticks });
const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
const LIVE = { trades: 22, pnl: 371 }; // grind-v3 live realized (closed positions, DB 2026-06-19)

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();
  const grind = channels.find((c) => c.slug === "grind-v3")!;

  const run = (ch: Channel, ticks: number) => {
    const { real, chainFor } = sessionsFor(ch, corpusOf(ch.symbol));
    const fill = fillFor(ticks);
    let tot = 0, n = 0, wins = 0; const byWin = new Map<string, number>();
    for (const s of real) {
      const ts: Trade[] = simulateSession(s.bars, cfgOf(ch.maxC), FUND, ch.mk(s) as any, chainFor(s), false, ch.premiumExit, fill, undefined, undefined, undefined, undefined, 0, ENTRY_GATE);
      const d = ts.reduce((a, x) => a + x.pnl, 0); tot += d; n += ts.length;
      for (const t of ts) if (t.pnl > 0) wins++;
      const w = WINDOWS.find((W) => s.dateET >= W.from && s.dateET <= W.to)?.name; if (w) byWin.set(w, (byWin.get(w) ?? 0) + d);
    }
    return { tot, n, exp: n ? tot / n : 0, win: n ? wins / n : 0, byWin };
  };

  console.log(`\n  GRIND-v3 SLIPPAGE SENSITIVITY · FAITHFUL (live 0.25 gate FIXED / full spread crossed / real NBBO) · RISK 500 / stop 500`);
  console.log(`  how much of grind-v3's −EV is the SLIPPAGE assumption? FILL slippage swept; everything else held faithful.\n`);

  console.log(`  ${"slip/side".padEnd(11)}${"Σ P&L".padStart(11)}${"exp$/t".padStart(10)}${"win%".padStart(8)}${"trades".padStart(8)}   note`);
  const cells = SLIP.map((t) => ({ t, ...run(grind, t) }));
  for (const c of cells) {
    const note = c.t === 0.25 ? `← ≈ live cross (compare live +$${LIVE.pnl}/${LIVE.trades} = ${f1(LIVE.pnl / LIVE.trades)}/t)` : c.t === 1.0 ? "← faithful default (the −$16.8k)" : c.t === 0 ? "← mid+spread only (no adverse fill)" : "";
    console.log(`  ${(c.t.toFixed(2) + "t").padEnd(11)}${usd(c.tot).padStart(11)}${f1(c.exp).padStart(10)}${(c.win * 100).toFixed(0).padStart(7)}%${String(c.n).padStart(8)}   ${note}`);
  }

  // per-window at the gate-level slippage (0.25) — is it −EV everywhere or one bad window?
  const g025 = cells.find((c) => c.t === 0.25)!;
  console.log(`\n  ══ per-window at 0.25t (≈ live cross) — broad −EV or window-specific? ══`);
  for (const W of WINDOWS) console.log(`    ${W.name.padEnd(18)} ${usd(g025.byWin.get(W.name) ?? 0).padStart(9)}`);

  const exp0 = cells[0].exp, exp025 = cells[1].exp, exp1 = cells[3].exp;
  console.log(`\n  READ: grind-v3's per-trade edge moves ${f1(exp1)}/t (1.0t, the −$16.8k) → ${f1(exp025)}/t (0.25t) → ${f1(exp0)}/t (0t, no slippage).`);
  console.log(`  The slippage assumption is worth ~$${Math.abs(Math.round((exp0 - exp1) * cells[3].n))} over the corpus. Live (+$${LIVE.pnl}/${LIVE.trades} = ${f1(LIVE.pnl / LIVE.trades)}/t, n=22 = noise)`);
  console.log(`  ${exp025 < 0 ? "is ABOVE even the 0.25t backtest → either live fills beat 0.25t, or 22 trades is just a lucky draw on a ≈coin-flip." : "is consistent with the 0.25t backtest."} VERDICT: ${exp0 < 0 ? "−EV even at ZERO slippage → no real edge; live + is small-sample noise → grind-v3 is a CUT candidate, not a keeper." : "+EV at low slippage → the edge is execution-bound, not absent → keep as a live experiment, prioritize fills."}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
