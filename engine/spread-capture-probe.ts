// ============================================================================
//  spread-capture-probe — TASK 1 / lever #4 (LOWER THE COST). (2026-06-19.)
//
//  The binding constraint all session = the 0DTE bid/ask SPREAD. Every structure pays it;
//  new-instrument games are refuted/blocked. The cheapest "better game" lever = limit-order
//  EXECUTION that CAPTURES part of the spread instead of crossing it — and it helps EVERY
//  channel, armed or benched, no model change.
//
//  This runs the FULL faithful roster (engine/roster-faithful.ts) at a CAPTURE fraction
//  ∈ {0 (cross the spread = today), 0.25, 0.5, 0.75, 1.0 (mid = no-fill-risk best case)}.
//  captureFrac = 1 − spreadCrossFrac: 0 pays the whole half-spread (today's marketable
//  order), 0.5 pays half of it (a marketable-limit ladder working the NBBO), 1.0 fills at
//  mid. Reports each channel's Σ P&L and exp$/trade at every level → how much does the book
//  lift as you recapture the spread, and does capturing HALF flip any marginal channel +EV?
//
//  FAITHFUL & CONSERVATIVE: the GATE (live 0.25-tick full-cross, ratio 3.0) is held FIXED —
//  only the FILL improves. So the roster of taken trades is IDENTICAL at every capture level;
//  the lift is PURELY execution quality (no selection confound). Slippage stays 1 tick/side
//  (capture models the SPREAD only, not slippage) — the conservative bound. Real NBBO, RISK
//  500 / stop 500, 5-window SPY OOS + single-regime QQQ.
//
//    npm run spread-capture-probe
//
//  READ: this is the CEILING (symmetric entry+exit capture, no fill-risk). A real marketable-
//  limit ladder captures LESS and misses some fills → build the worker ladder SHADOW-FIRST and
//  measure REAL capture before flipping spreadCrossFrac (the Nakamoto fill-at-trigger receipt).
// ============================================================================

import { simulateSession } from "./backtest";
import { loadFaithfulRoster, sessionsFor, FILL_1T, FUND, cfgOf, ENTRY_GATE, WINDOWS, winOf, usd, type Channel } from "./roster-faithful";
import type { CostModel } from "./cost";
import type { Bar, Trade } from "./types";

// captureFrac → the FILL cost model. spreadCrossFrac = 1 − capture (held within [0,1]).
const CAPTURES = [0, 0.25, 0.5, 0.75, 1.0];
const fillFor = (capture: number): CostModel => ({ ...FILL_1T, spreadCrossFrac: Math.max(0, Math.min(1, 1 - capture)) });

const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);

async function main() {
  const { channels, corpusOf } = await loadFaithfulRoster();

  // run one channel at one capture level → pooled Σ, trade count, per-window Σ, daily series
  const run = (ch: Channel, capture: number) => {
    const { real, chainFor } = sessionsFor(ch, corpusOf(ch.symbol));
    const fill = fillFor(capture);
    let tot = 0, n = 0; const byWin = new Map<string, number>();
    for (const s of real) {
      const ts: Trade[] = simulateSession(
        s.bars, cfgOf(ch.maxC), FUND, ch.mk(s) as any, chainFor(s), false, ch.premiumExit,
        fill, undefined, undefined, undefined, undefined, 0, ENTRY_GATE
      );
      const d = ts.reduce((a, x) => a + x.pnl, 0); tot += d; n += ts.length;
      const w = winOf(s.dateET); if (w) byWin.set(w, (byWin.get(w) ?? 0) + d);
    }
    return { tot, n, exp: n ? tot / n : 0, byWin, sessions: real.length };
  };

  console.log(`\n  SPREAD-CAPTURE SENSITIVITY · #4 LOWER THE COST · FAITHFUL (live 0.25 gate held FIXED / 1-tick slippage) · RISK 500 / stop 500`);
  console.log(`  capture part of the spread via limit execution vs cross it (= today). captureFrac 0=cross/today · 0.5=half · 1.0=mid (ceiling).`);
  console.log(`  GATE FIXED → identical roster at every level → the lift is PURELY execution. real NBBO · SPY 5-window OOS · QQQ single-regime\n`);

  const capHdr = CAPTURES.map((c) => `cap${c.toFixed(2)}`.padStart(11)).join("");
  console.log(`  ══ Σ P&L by capture fraction ══`);
  console.log(`  ${"channel".padEnd(18)}${"tr/sess".padStart(8)}${capHdr}   Δ(cap.5−today)`);

  const rows: { ch: Channel; cells: ReturnType<typeof run>[] }[] = [];
  for (const ch of channels) {
    const cells = CAPTURES.map((c) => run(ch, c));
    rows.push({ ch, cells });
    const today = cells[0].tot, half = cells[2].tot; // capture 0 and 0.5
    const trPerSess = cells[0].sessions ? cells[0].n / cells[0].sessions : 0;
    const flip = today <= 0 && half > 0 ? "  ⇧+EV" : "";
    console.log(`  ${ch.name.padEnd(18)}${trPerSess.toFixed(1).padStart(8)}${cells.map((c) => usd(c.tot).padStart(11)).join("")}   ${usd(half - today).padStart(8)}${flip}${ch.oos ? "" : "  ·QQQ"}`);
  }

  console.log(`\n  ══ exp$/trade by capture fraction (the per-trade lift — channel-size-independent) ══`);
  console.log(`  ${"channel".padEnd(18)}${"trades".padStart(8)}${CAPTURES.map((c) => `cap${c.toFixed(2)}`.padStart(11)).join("")}   be-cap`);
  for (const { ch, cells } of rows) {
    const exps = cells.map((c) => c.exp);
    // linear-interp the capture where exp$/t crosses 0 (sign change between bracketing levels)
    let be: string = exps[exps.length - 1] > 0 ? (exps[0] > 0 ? "≤0 (always+)" : "?") : ">1 (never+)";
    for (let i = 0; i < CAPTURES.length - 1; i++) { const a = exps[i], b = exps[i + 1]; if ((a <= 0 && b > 0) || (a > 0 && b <= 0)) { const t = a / (a - b); be = (CAPTURES[i] + t * (CAPTURES[i + 1] - CAPTURES[i])).toFixed(2); break; } }
    console.log(`  ${ch.name.padEnd(18)}${cells[0].n.toString().padStart(8)}${exps.map((e) => f1(e).padStart(11)).join("")}   ${be}`);
  }

  // ── the roster-decision headline: does capturing HALF the spread flip any −EV channel +EV?
  //    (a channel close enough to zero that the half-capture lift could cross it) ──
  const flips = rows.filter(({ cells }) => cells[0].tot <= 0 && cells[2].tot > 0);
  const couldMatter = rows.filter(({ cells }) => cells[0].tot <= 0 && cells[0].tot + (cells[2].tot - cells[0].tot) * 2 > 0); // even DOUBLE the half-lift
  console.log(`\n  ══ roster decision: does capture flip a benched channel +EV? ══`);
  if (!flips.length) console.log(`  NO channel flips +EV at half-capture (cap.5); ${couldMatter.length ? couldMatter.map((r) => r.ch.name).join(", ") + " would need >2× the half-lift" : "not one −EV channel is even within 2× the half-capture lift of zero"} → capture changes NO roster decision.`);
  else console.log(`  FLIPS +EV at half-capture: ${flips.map((r) => r.ch.name).join(", ")} → capture RESCUES these (a roster lever).`);

  // ── per-window for the BIGGEST-lift channels — is the Σ lift regime-broad or one window? ──
  const topLift = [...rows].sort((a, b) => (b.cells[2].tot - b.cells[0].tot) - (a.cells[2].tot - a.cells[0].tot)).slice(0, 3);
  console.log(`\n  ══ per-window Σ for the 3 biggest-lift channels — today (cap0) → capture-half (cap.5) — broad or one-window? ══`);
  for (const { ch, cells } of topLift) {
    console.log(`  ${ch.name}  (Σ lift ${usd(cells[2].tot - cells[0].tot)})${ch.oos ? "" : "  ·QQQ single-regime"}`);
    const wins = ch.oos ? WINDOWS.map((w) => w.name) : [...new Set([...cells[0].byWin.keys(), ...cells[2].byWin.keys()])];
    for (const w of wins) {
      const t0 = cells[0].byWin.get(w) ?? 0, t5 = cells[2].byWin.get(w) ?? 0;
      if (t0 === 0 && t5 === 0) continue;
      console.log(`    ${w.padEnd(18)} ${usd(t0).padStart(9)} → ${usd(t5).padStart(9)}   ${usd(t5 - t0).padStart(8)}`);
    }
  }

  console.log(`\n  READ: a big Σ lift on a channel already +EV today = free money the desk leaves on the table by crossing. A ⇧+EV flip on`);
  console.log(`  a marginal/benched channel = capture RESCUES it (a roster lever). exp$/t lift ≈ captureFrac × ½-spread × round-trips — so the`);
  console.log(`  scalpers (many round-trips) lift most in Σ. NEXT (if material): worker marketable-limit ladder SHADOW-FIRST, measure REAL`);
  console.log(`  capture, THEN flip spreadCrossFrac — never trust the ceiling (Nakamoto fill-at-trigger optimism = the cautionary receipt).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
