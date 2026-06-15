// ============================================================================
//  pbride-exit-probe — is pb-ride a RIDE channel or a PROTECT channel?
//  (operator challenge 06-15: "bank winners, or at least don't let them turn
//  into losers.") The exit-scheme-probe answered this for the breakout family —
//  convex channels (BREAK ALT/V3) RIDE; tail-less bleeders (QQQ-Break) PROTECT —
//  but never tested pb-ride, the channel the operator overrode today.
//
//  Runs pb-ride @1DTE (next-expiry, mdte cache — cloned from pbride-invgate-probe,
//  the wiring SANITY-anchored to the one-dte-verdict +$4,632) through the SAME
//  schemes, with RE-ENTRY modeled (simulateSession re-enters when flat, backtest.ts:325):
//    ride       — hold to flatten + −50% stop (the live config)
//    BE+30      — once +30% in profit, ratchet the stop to entry (don't let a winner
//                 turn into a loser) — ride the rest
//    scale·g35  — sell HALF at +50% → trail (give back 35% of peak) + breakeven floor
//    scale·g20  — same, tighter (give back 20%)
//
//  scale/BE WINS only if total$ beats ride AND holds across windows → pb-ride is a
//  protect channel (the override was right, wire it). ride wins → it's a convex
//  channel (protecting caps the tail; today's +$748 manual close left money on the
//  table over a month). Real Databento NBBO, cost gate 3.0.
//
//    npm run pbride-exit-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { makeEval as pbEval, precompute as pbPre } from "./ema-pullback-probe";
import type { ChainProvider } from "./optionsource";
import type { Management } from "../lib/desk/strategySpec";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const EOD = 35; // manage flatten min-to-close — pb-ride flattens same-day (~15:25)

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

const baseMgmt = (): Pick<Management, "risk" | "trail" | "eodFlattenMinToClose" | "costGate"> => ({
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  eodFlattenMinToClose: EOD,
  costGate: { minMoveToCostRatio: 3.0 },
});
const scaleMgmt = (gb: number): Management => ({ ...baseMgmt(), scaleOut: [{ atR: 1.0, fraction: 0.5, then: "engage_trail" }], trail: { mode: "premium_giveback", premiumGivebackPct: gb } });

interface SchemeOpts { premiumExit?: { profitPct?: number; stopPct?: number }; breakevenExit?: { engagePct: number; lockPct?: number }; management?: Management }
const SCHEMES: Array<{ key: string; opts: SchemeOpts }> = [
  { key: "ride", opts: { premiumExit: { stopPct: 50 } } },
  { key: "BE+30", opts: { premiumExit: { stopPct: 50 }, breakevenExit: { engagePct: 30, lockPct: 0 } } },
  { key: "scale·g35", opts: { management: scaleMgmt(35) } },
  { key: "scale·g20", opts: { management: scaleMgmt(20) } },
];

// one position = one (entryTs|strike|optType); a scaled position nets its tranches.
function posStats(tr: Trade[]) {
  const byPos = new Map<string, number>();
  for (const t of tr) { const k = `${t.entryTs}|${t.strike}|${t.optType}`; byPos.set(k, (byPos.get(k) ?? 0) + t.pnl); }
  const pnls = [...byPos.values()];
  const total = tr.reduce((a, t) => a + t.pnl, 0);
  return { total, pos: pnls.length, winPct: pnls.length ? (100 * pnls.filter((p) => p > 0).length) / pnls.length : 0 };
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);

  const mdte = loadMultiDteByDay(dates);
  const real = sessions.filter((s) => {
    const c = mdte.get(s.dateET); const nx = nextOf.get(s.dateET);
    return !!c && !!nx && c.some((q) => q.expiration === nx) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;
  // 1DTE chain: next-session expiry only (pb-ride buys time value).
  const chain1 = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); const nx = nextOf.get(s.dateET)!; return (_sp, _mtc, ts) => all(ts).filter((q) => q.expiration === nx); };
  const preBy = new Map<string, ReturnType<typeof pbPre>>();
  const mkPb = (s: RealSession): Evaluate => { let p = preBy.get(s.dateET); if (!p) { p = pbPre(s); preBy.set(s.dateET, p); } return pbEval(p, false, false); };

  const run = (set: RealSession[], opts: SchemeOpts): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mkPb(s), chain1(s), false, opts.premiumExit, NBBO, opts.management, undefined, opts.breakevenExit, undefined, 0, opts.management ? undefined : GATE));

  console.log(`\n  PB-RIDE EXIT-SCHEME · @1DTE (next-expiry, mdte) · ${real.length} sessions · real NBBO · cost gate 3.0`);
  console.log(`  ride = live config · BE+30 = don't-let-a-winner-turn-loser · scale·gNN = half off @+50% → trail (give back NN%)\n`);

  // sanity: ride pooled must reproduce the one-dte anchor (+$4,632, ~250 trades)
  const ridePooled = posStats(run(real, SCHEMES[0].opts));
  const sane = Math.abs(ridePooled.total - 4632) < 1500;
  console.log(`  ══ SANITY — ride pooled $ vs one-dte-verdict anchor (+$4,632) ══`);
  console.log(`  ride pooled ${sgn(ridePooled.total)}$${Math.round(ridePooled.total)} (${ridePooled.pos} pos) → ${sane ? "OK, 1DTE wiring trusted" : "⚠ MISMATCH — wiring suspect, numbers unreliable"}\n`);

  console.log("  " + "window".padEnd(16) + SCHEMES.map((s) => s.key.padStart(12)).join(""));
  const pooled = SCHEMES.map((s) => posStats(run(real, s.opts)));
  console.log("  " + "POOLED total$".padEnd(16) + pooled.map((p) => `${sgn(p.total)}${Math.round(p.total)}`.padStart(12)).join(""));
  console.log("  " + "  win% · pos".padEnd(16) + pooled.map((p) => `${p.winPct.toFixed(0)}w·${p.pos}`.padStart(12)).join(""));
  for (const w of WINDOWS) {
    const set = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
    if (!set.length) continue;
    const cells = SCHEMES.map((s) => posStats(run(set, s.opts)).total);
    console.log("  " + w.name.padEnd(16) + cells.map((v) => `${sgn(v)}${Math.round(v)}`.padStart(12)).join(""));
  }

  console.log(`\n  READ: if BE+30 / scale beats ride AND holds across windows → pb-ride is a PROTECT channel (wire it,`);
  console.log(`  the override was right). If ride wins (esp. the CHOP-MIX / trend windows carry it) → it's CONVEX like`);
  console.log(`  BREAK ALT/V3: protecting caps the tail, and banking is a per-trade comfort that costs over a month.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
