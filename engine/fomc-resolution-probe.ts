// ============================================================================
//  fomc-resolution-probe — is there a tradeable edge AFTER the 2pm binary
//  settles? (2026-06-12, the calendar-awareness verdict's #1 unprobed extension.)
//
//  The stand-down (live since worker `stream-2026-06-11d`) flattens 13:50 and
//  blocks entries until 14:30 — pure risk-OFF. The generative question: when the
//  desk RESUMES at 14:30, the statement's direction is now PUBLIC information
//  with 90 minutes of session left. Does following (or fading) the resolved
//  14:00→14:30 move pay at live-faithful costs?
//
//  PRE-REGISTERED before looking (mirage discipline):
//   - N ≈ 18 in-corpus FOMC days → ANECDOTE-GRADE by construction. There is no
//     5-window bar here (you can't window 8-events-a-year); the read is
//     direction-consistency + per-trade expectancy + the underlying MECHANISM
//     (does the 14:00→14:30 move continue 14:30→15:25 at all?).
//   - Verdict vocabulary: "paper-lab candidate" (mechanism + options P&L agree,
//     keep collecting live FOMC days) / "park" (mixed) / "dead" (anti-edge).
//     NOTHING arms off this probe.
//   - Variants fixed up front: FOLLOW @14:30 / @14:45 / @15:00, FADE @14:30;
//     resolution threshold |move| ≥ 0 and ≥ 0.10% (a real statement reaction).
//   - Exits: the ride-family default — −50% premium stop + 15:25 flatten, cost
//     gate 3.0, ustop 0, real NBBO. One attempt per day (the thesis is ONE
//     resolution bet, not a re-lean machine).
//
//    npm run fomc-resolution-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, OptType, StrategistConfig, Trade } from "./types";
import { MARKET_EVENTS } from "./market-events";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "fomc", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const FOMC = new Set<string>(MARKET_EVENTS.filter((e) => e.kind === "fomc").map((e) => e.date));

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const sgn = (v: number) => (v >= 0 ? "+" : "");

// Last close at-or-before an ET minute (null if the session hasn't reached it).
const closeAt = (bars: Bar[], m: number): number | null => {
  let c: number | null = null;
  for (const b of bars) { if (etMinOf(b.ts) <= m) c = b.close; else break; }
  return c;
};

// One-shot resolution evaluator: enter `dir` on the first bar at/after entryMinET,
// flatten 15:25 (m ≥ 925). The −50% premium stop rides via simulateSession.
const mkEval = (bars: Bar[], entryMinET: number, dir: OptType, reason: string): Evaluate => {
  let attempted = false;
  return (f, pos) => {
    const m = etMinOf(bars[f.minute].ts);
    if (pos) return m >= 925 ? { kind: "exit", reason: "flatten_1525" } : null;
    if (attempted || m < entryMinET) return null;
    attempted = true;
    return { kind: "enter", direction: dir, reason };
  };
};

interface DayRow { date: string; movePct: number; contPct: number; trades: Trade[] }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const corpus = sessions.filter((s) => s.bars.length >= 300);
  const fomcDays = corpus.filter((s) => FOMC.has(s.dateET));
  const byDay = loadDatabentoByDay(fomcDays.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const tradable = fomcDays.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  console.log(`\n  FOMC-RESOLUTION probe · ${corpus.length} SPY sessions · ${fomcDays.length} FOMC days in-corpus · ${tradable.length} with NBBO chains`);
  console.log(`  resolution = sign(14:00→14:30 move) · entries at the stand-down resume · ride exits (−50% stop · 15:25 flatten) · gate 3.0\n`);

  // ---- mechanism first (underlying only, ALL fomc days): does the statement move CONTINUE? ----
  const mech: { move: number; cont: number }[] = [];
  for (const s of fomcDays) {
    const c1400 = closeAt(s.bars, 840), c1430 = closeAt(s.bars, 870), c1525 = closeAt(s.bars, 925);
    if (c1400 == null || c1430 == null || c1525 == null) continue;
    mech.push({ move: ((c1430 - c1400) / c1400) * 100, cont: ((c1525 - c1430) / c1430) * 100 });
  }
  const agree = mech.filter((x) => x.move !== 0 && Math.sign(x.move) === Math.sign(x.cont));
  const meaningful = mech.filter((x) => Math.abs(x.move) >= 0.10);
  const agreeM = meaningful.filter((x) => Math.sign(x.move) === Math.sign(x.cont));
  console.log(`  ══ MECHANISM (underlying, n=${mech.length}) — does 14:00→14:30 continue into 14:30→15:25? ══`);
  console.log(`  all days:        continuation ${agree.length}/${mech.length} (${Math.round((agree.length / Math.max(1, mech.length)) * 100)}%) · avg |statement move| ${mean(mech.map((x) => Math.abs(x.move))).toFixed(2)}% · avg signed follow-through ${sgn(mean(mech.map((x) => Math.sign(x.move) * x.cont)))}${mean(mech.map((x) => Math.sign(x.move) * x.cont)).toFixed(3)}%`);
  console.log(`  |move| ≥ 0.10%:  continuation ${agreeM.length}/${meaningful.length} (${Math.round((agreeM.length / Math.max(1, meaningful.length)) * 100)}%) · avg signed follow-through ${sgn(mean(meaningful.map((x) => Math.sign(x.move) * x.cont)))}${mean(meaningful.map((x) => Math.sign(x.move) * x.cont)).toFixed(3)}%\n`);

  // ---- the option-P&L variants (pre-registered grid) ----
  const VARIANTS: Array<{ name: string; entry: number; fade: boolean }> = [
    { name: "FOLLOW @14:30", entry: 870, fade: false },
    { name: "FOLLOW @14:45", entry: 885, fade: false },
    { name: "FOLLOW @15:00", entry: 900, fade: false },
    { name: "FADE   @14:30", entry: 870, fade: true },
  ];
  const THRESH = [0, 0.10];

  console.log(`  ══ OPTION P&L (real NBBO, live-faithful) — per variant × resolution threshold ══`);
  console.log(`  variant          thr     n   win%   avg$/t    total$   stop%`);
  const detail = new Map<string, DayRow[]>();
  for (const v of VARIANTS) for (const thr of THRESH) {
    const rows: DayRow[] = [];
    for (const s of tradable) {
      const c1400 = closeAt(s.bars, 840), c1430 = closeAt(s.bars, 870), c1525 = closeAt(s.bars, 925);
      if (c1400 == null || c1430 == null) continue;
      const movePct = ((c1430 - c1400) / c1400) * 100;
      if (movePct === 0 || Math.abs(movePct) < thr) continue;
      let dir: OptType = movePct > 0 ? "call" : "put";
      if (v.fade) dir = dir === "call" ? "put" : "call";
      const ev = mkEval(s.bars, v.entry, dir, v.fade ? "fomc_fade" : "fomc_follow");
      const trades = simulateSession(s.bars, CFG, FUND, ev, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
      rows.push({ date: s.dateET, movePct, contPct: c1525 != null ? ((c1525 - c1430) / c1430) * 100 : NaN, trades });
    }
    const tr = rows.flatMap((r) => r.trades);
    const wins = tr.filter((t) => t.pnl > 0).length;
    const stops = tr.filter((t) => /stop/.test(t.exitReason ?? "")).length;
    const tot = tr.reduce((a, t) => a + t.pnl, 0);
    console.log(`  ${v.name.padEnd(15)} ${(thr === 0 ? "any" : `≥${thr.toFixed(2)}%`).padStart(6)} ${String(tr.length).padStart(5)} ${tr.length ? `${Math.round((wins / tr.length) * 100)}%`.padStart(6) : "    —"} ${tr.length ? `${sgn(tot / tr.length)}${(tot / tr.length).toFixed(0)}`.padStart(8) : "       —"} ${`${sgn(tot)}${tot.toFixed(0)}`.padStart(9)} ${tr.length ? `${Math.round((stops / tr.length) * 100)}%`.padStart(6) : "    —"}`);
    detail.set(`${v.name}|${thr}`, rows);
  }

  // ---- per-day receipts for the headline variant ----
  const head = detail.get("FOLLOW @14:30|0.1") ?? [];
  console.log(`\n  ══ PER-DAY RECEIPTS — FOLLOW @14:30, |move| ≥ 0.10% (the headline variant) ══`);
  console.log(`  date         move%    cont%   dir    pnl$   exit`);
  for (const r of head) {
    const t = r.trades[0];
    console.log(`  ${r.date}  ${sgn(r.movePct)}${r.movePct.toFixed(2).padStart(5)}  ${sgn(r.contPct)}${r.contPct.toFixed(2).padStart(5)}   ${r.movePct > 0 ? "call" : "put "}  ${t ? `${sgn(t.pnl)}${t.pnl.toFixed(0)}`.padStart(6) : "  gate"}  ${t?.exitReason ?? "blocked/no-fill"}`);
  }

  console.log(`\n  READ (pre-registered): N≈${tradable.length} = ANECDOTE-GRADE — no arm off this probe, ever.`);
  console.log(`  Paper-lab candidate IF: mechanism continuation ≥ ~60% on meaningful moves AND the headline`);
  console.log(`  variant is positive with win% above the 28.6% bracket-breakeven. Mixed = park (re-run after`);
  console.log(`  each live FOMC adds a day). Anti-edge (fade wins instead) = file the inversion, stay flat.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
