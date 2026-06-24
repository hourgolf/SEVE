// ============================================================================
//  universe-port-probe (MOVE 3) — does the validated gap-momentum edge GENERALIZE
//  to another 0DTE index? The Null-Desk (MOVE 0) showed V3/ALT is real-but-thin
//  and under-powered on SPY (~10 tail trades carry it) — and more SPY data can't
//  resolve skill-vs-luck. The only fix is more INDEPENDENT at-bats. The 0DTE
//  universe is tiny (SPY/QQQ/IWM — single names are weekly, not daily-expiry), and
//  QQQ already REFUTED the port (−$23.5/t vs SPY +$131/t). So IWM is the tiebreaker:
//  the one untested 0DTE index. If the edge shows on IWM, it has cross-index
//  generality (2 of 3) and the over-fit question starts to dissolve by sample size.
//  If IWM fails like QQQ, the edge is SPY-SPECIFIC — a much stronger negative than
//  "fails one window," and a real input to the live-$ decision.
//
//  Runs the EXACT V3/ALT spec (from roster-faithful, instrument-agnostic — reads
//  features) on IWM bars + IWM 0DTE Databento NBBO, faithful config (RISK 500 /
//  −50% stop / live gate). Windows present in the IWM backfill only (2025-11→2026-05).
//
//  npm run universe-port-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadFaithfulRoster, cfgOf, FUND, FILL_1T, ENTRY_GATE, WINDOWS, winOf, usd } from "./roster-faithful";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import type { Bar, Trade } from "./types";
import type { ChainProvider } from "./optionsource";

const SPY_REF: Record<string, number> = { "breakout-alt-v3": 8309, "breakout-smart-entries": 8927 }; // MOVE 0 faithful Σ

async function main() {
  const { channels } = await loadFaithfulRoster();
  const core = channels.filter((c) => c.slug === "breakout-alt-v3" || c.slug === "breakout-smart-entries");

  // IWM corpus (the freshly-backfilled 0DTE index)
  const sessions = await loadRealSessions({ symbol: "IWM", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET), "data/databento-mdte-iwm");
  const real = sessions.filter((s) => {
    const cc = mdte.get(s.dateET);
    if (!cc || s.bars.length < 90) return false;
    if (!cc.some((q) => q.expiration === s.dateET)) return false; // 0DTE chain present
    return WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const chainFor = (s: RealSession): ChainProvider => {
    const all = makeMultiDteChain(mdte.get(s.dateET)!);
    return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET);
  };
  const winsCovered = [...new Set(real.map((s) => winOf(s.dateET)).filter(Boolean))];
  console.log(`\n  UNIVERSE PORT (MOVE 3) · V3/ALT on IWM (0DTE) · ${real.length} sessions · windows: ${winsCovered.join(", ")}`);
  console.log(`  Does the gap-momentum edge generalize to a 3rd index? (SPY works · QQQ REFUTED · IWM = tiebreaker)\n`);

  for (const ch of core) {
    const perWin = new Map<string, { pnl: number; n: number }>();
    let total = 0, nTrades = 0;
    for (const s of real) {
      const ev = ch.mk(s);
      const ts: Trade[] = simulateSession(s.bars as Bar[], cfgOf(ch.maxC), FUND, ev as any, chainFor(s), false, ch.premiumExit, FILL_1T, undefined, undefined, undefined, undefined, 0, ENTRY_GATE);
      const day = ts.reduce((a, t) => a + t.pnl, 0);
      const w = winOf(s.dateET); if (w) { const e = perWin.get(w) ?? { pnl: 0, n: 0 }; e.pnl += day; e.n += ts.length; perWin.set(w, e); }
      total += day; nTrades += ts.length;
    }
    const winsPos = WINDOWS.filter((w) => (perWin.get(w.name)?.pnl ?? 0) > 0 && perWin.has(w.name)).length;
    const winsCov = WINDOWS.filter((w) => perWin.has(w.name)).length;
    console.log(`  ── ${ch.name} on IWM ──   Σ ${usd(total)} · ${nTrades} trades · ${winsPos}/${winsCov} covered-windows positive   (SPY ref: ${usd(SPY_REF[ch.slug] ?? 0)})`);
    for (const w of WINDOWS) { const e = perWin.get(w.name); if (e) console.log(`       ${w.name.padEnd(16)} ${usd(e.pnl).padStart(8)} · ${e.n}t`); }
    const perT = nTrades ? total / nTrades : 0;
    console.log(`       per-trade ${usd(perT)}  ${total > 0 && winsPos >= winsCov - 1 ? "→ GENERALIZES (edge shows on IWM too)" : total <= 0 ? "→ does NOT generalize (IWM joins QQQ — edge looks SPY-specific)" : "→ MIXED (some windows; not robust)"}\n`);
  }
  console.log(`  READ: a covered-window-positive IWM result = the edge is a cross-index microstructure law (over-fit dissolves`);
  console.log(`  as at-bats accumulate); a negative = it's SPY-specific (IWM + QQQ both fail), which is a hard input to the`);
  console.log(`  clone-promote-V3-to-live-$ plan. ⭐ FULL 5-window OOS: V3 +$6,548 / ALT +$6,647, BOTH 5/5 → GENERALIZES.`);
  console.log(`  IWM is a validated 2nd Core index — add IWM V3/ALT channels (hands-off, more live at-bats). [[desk-doctrine]]\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
