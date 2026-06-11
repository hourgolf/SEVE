// ============================================================================
//  confirm-delay-probe — can a CONFIRMATION DELAY fix adversely-selected entries?
//  (probe queue item, 2026-06-11 — the fill-lag verdict's open thread.)
//
//  fill-lag-probe found the bleeders IMPROVE with pure lag (power +$413,
//  QQQ-Break +$2.3k at 120s): their signals are adversely selected — the fill
//  lands right before an adverse move, so ANY delay cheapens it mechanically.
//  This probe tests whether making the delay a FILTER beats making it a lag:
//
//   persist-k:    enter only after the signal has fired on EVERY bar for k
//                 consecutive minutes (drop entries that fade) — a true filter.
//   delay-veto-k: enter k minutes after the FIRST signal regardless of whether
//                 it re-fires, unless an OPPOSITE signal appears first (reset).
//                 The pure-lag mechanism with a reversal veto.
//
//  Channels = the two adversely-selected bleeders (live-faithful configs):
//  POWERHOUR(base) on SPY (ustop 0) and QQQ-Break builtin ORB (ustop 0.20).
//  Both signals are state-based (re-fire while flat), so persist-k is testable.
//
//  READ: both channels are structurally −EV (the cut list stands); the bar here
//  is NOT "flips to +EV" but "is the improvement a FILTER edge (persist beats
//  delay-veto at same k) or just lag again?" If delay-veto ≈ persist, the gain
//  is mechanical and the entry-fix thesis is refuted — don't wire either.
//
//    npm run confirm-delay-probe
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };

type MkEval = (s: RealSession) => Evaluate;
const ev = (e: Evaluate): MkEval => () => e;

// Signal must hold for k consecutive minutes (streak resets on a quiet or
// opposite bar; holding a position resets all pending state).
const persist = (mk: MkEval, k: number): MkEval => (s) => {
  const e = mk(s);
  let dir: "call" | "put" | null = null, since = -1;
  return (f, pos) => {
    const it = e(f, pos);
    if (pos) { dir = null; return it; }
    if (it?.kind !== "enter") { dir = null; return it ?? null; }
    if (dir !== it.direction) { dir = it.direction; since = f.minute; return null; }
    return f.minute - since >= k ? it : null;
  };
};
// Enter k minutes after the FIRST signal; an opposite signal re-arms the timer.
const delayVeto = (mk: MkEval, k: number): MkEval => (s) => {
  const e = mk(s);
  let dir: "call" | "put" | null = null, since = -1;
  return (f, pos) => {
    const it = e(f, pos);
    if (pos) { dir = null; return it; }
    if (it?.kind === "enter" && it.direction !== dir) { dir = it.direction; since = f.minute; return null; }
    if (!dir) return null;
    return f.minute - since >= k ? { kind: "enter", direction: dir, reason: "confirm_delay" } : null;
  };
};

interface Channel { name: string; underlying: string; maxC: number; ustop: number; base: MkEval; windows: Array<{ name: string; from: string; to: string }> }
const SPY_WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const QQQ_WINDOWS = [
  { name: "Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "Jun26", from: "2026-06-01", to: "2026-06-10" },
];
const CHANNELS: Channel[] = [
  { name: "POWERHOUR(base) SPY", underlying: "SPY", maxC: 6, ustop: 0, base: ev((f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS)), windows: SPY_WINDOWS },
  { name: "QQQ-Break(builtin)", underlying: "QQQ", maxC: 4, ustop: 0.20, base: ev((f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS)), windows: QQQ_WINDOWS },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  console.log(`\n  CONFIRMATION-DELAY probe · adversely-selected entries · real NBBO · ride −50% stop · cost gate 3.0`);
  console.log(`  READ: persist ≫ delay-veto at same k = real filter edge; persist ≈ delay-veto = lag again (refuted).\n`);
  for (const ch of CHANNELS) {
    const sessions = await loadRealSessions({ symbol: ch.underlying, sinceDaysAgo: 900 });
    const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), ch.underlying) as unknown as Map<string, unknown[]>;
    const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
    const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
    const cfg: StrategistConfig = { slug: "cfm", capital_pct: 100, aggression: 100, max_contracts: ch.maxC, daily_stop_usd: 1e9, muted: false, soloed: false };
    const run = (mk: MkEval, set: RealSession[]): Trade[] =>
      set.flatMap((s) => simulateSession(s.bars, cfg, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, ch.ustop, GATE));

    const variants: Array<{ name: string; mk: MkEval }> = [
      { name: "baseline (k=0)   ", mk: ch.base },
      { name: "persist k=1      ", mk: persist(ch.base, 1) },
      { name: "persist k=2      ", mk: persist(ch.base, 2) },
      { name: "persist k=3      ", mk: persist(ch.base, 3) },
      { name: "delay-veto k=2   ", mk: delayVeto(ch.base, 2) },
    ];
    console.log(`  ${ch.name} — ${real.length} sessions`);
    console.log("    variant             exp$/t   n   win%     pooled$" + ch.windows.map((w) => w.name.slice(0, 12).padStart(14)).join(""));
    for (const v of variants) {
      const all = run(v.mk, real);
      const m = metrics(all, real.length);
      const exp = all.length ? m.totalPnl / all.length : 0;
      const winPct = all.length ? (100 * all.filter((t) => t.pnl > 0).length) / all.length : 0;
      const per = ch.windows.map((w) => {
        const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
        return Math.round(metrics(run(v.mk, win), win.length).totalPnl);
      });
      console.log(`    ${v.name}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%  ${`${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(14)).join(""));
    }
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
