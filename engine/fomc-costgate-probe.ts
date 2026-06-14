// ============================================================================
//  fomc-costgate-probe — the ultracode adversarial kill-lanes for the FOMC
//  resolution edge (2026-06-13). The headline FOLLOW @14:30 |move|≥0.10% prints
//  +$678/t, but the slate flagged two threats the base probe doesn't isolate:
//
//   (b) COST-GATE SENSITIVITY — at the live gate 3.0, 5 of 10 meaningful-move days
//       are blocked (the move isn't 3× the round-trip cost). Does relaxing the gate
//       (more trades) FLIP the verdict, or does it just dilute expectancy with the
//       marginal coin-flip days the gate is designed to filter?
//   (a) LEAVE-ONE-OUT — 2024-12-18 alone is ~71% of the P&L. Drop it: does the edge
//       survive, and at what n?
//
//  Pure analysis of the SAME pre-registered headline variant — no new strategy, no
//  arming. Mirrors fomc-resolution-probe.ts mechanics verbatim (mkEval / ride exits /
//  real NBBO), varying only the cost gate. ANECDOTE-GRADE by construction (N≈10).
//
//    npm run fomc-costgate-probe
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
const CFG: StrategistConfig = { slug: "fomc", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FOMC = new Set<string>(MARKET_EVENTS.filter((e) => e.kind === "fomc").map((e) => e.date));

// headline variant: FOLLOW the 14:00→14:30 resolution, enter 14:30, |move| ≥ 0.10%
const ENTRY = 870, THRESH = 0.10;
const GATES = [0, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
const sgn = (v: number) => (v >= 0 ? "+" : "");
const usd = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(Math.round(v))}`;
const closeAt = (bars: Bar[], m: number): number | null => {
  let c: number | null = null;
  for (const b of bars) { if (etMinOf(b.ts) <= m) c = b.close; else break; }
  return c;
};
const mkEval = (bars: Bar[], entryMinET: number, dir: OptType): Evaluate => {
  let attempted = false;
  return (f, pos) => {
    const m = etMinOf(bars[f.minute].ts);
    if (pos) return m >= 925 ? { kind: "exit", reason: "flatten_1525" } : null;
    if (attempted || m < entryMinET) return null;
    attempted = true;
    return { kind: "enter", direction: dir, reason: "fomc_follow" };
  };
};

interface DayRow { date: string; movePct: number; pnl: number | null; filled: boolean; exit: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const corpus = sessions.filter((s) => s.bars.length >= 300);
  const fomcDays = corpus.filter((s) => FOMC.has(s.dateET));
  const byDay = loadDatabentoByDay(fomcDays.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const tradable = fomcDays.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  // the meaningful-move day set (|14:00→14:30| ≥ 0.10%), gate-independent
  const meaningful = tradable.filter((s) => {
    const c1400 = closeAt(s.bars, 840), c1430 = closeAt(s.bars, 870);
    return c1400 != null && c1430 != null && Math.abs(((c1430 - c1400) / c1400) * 100) >= THRESH;
  });

  console.log(`\n  FOMC COST-GATE + LEAVE-ONE-OUT · headline = FOLLOW @14:30, |move| ≥ ${THRESH.toFixed(2)}%`);
  console.log(`  ${tradable.length} FOMC days w/ NBBO · ${meaningful.length} meaningful-move days · real NBBO · −50% stop · 15:25 flatten\n`);

  // run the headline at one gate → per-day rows (only meaningful-move days attempt)
  const runAtGate = (ratio: number): DayRow[] => {
    const rows: DayRow[] = [];
    for (const s of meaningful) {
      const c1400 = closeAt(s.bars, 840), c1430 = closeAt(s.bars, 870);
      if (c1400 == null || c1430 == null) continue;
      const movePct = ((c1430 - c1400) / c1400) * 100;
      const dir: OptType = movePct > 0 ? "call" : "put";
      const ev = mkEval(s.bars, ENTRY, dir);
      const trades: Trade[] = simulateSession(s.bars, CFG, FUND, ev, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: ratio });
      const t = trades[0];
      rows.push({ date: s.dateET, movePct, pnl: t ? t.pnl : null, filled: !!t, exit: t?.exitReason ?? "gate/no-fill" });
    }
    return rows;
  };

  const summarize = (rows: DayRow[]) => {
    const f = rows.filter((r) => r.filled && r.pnl != null) as Array<DayRow & { pnl: number }>;
    const n = f.length, tot = f.reduce((a, r) => a + r.pnl, 0);
    const wins = f.filter((r) => r.pnl > 0).length;
    const stops = f.filter((r) => /stop/.test(r.exit)).length;
    const topAbs = f.length ? f.reduce((m, r) => (Math.abs(r.pnl) > Math.abs(m.pnl) ? r : m)) : null;
    const topShare = topAbs && tot !== 0 ? (topAbs.pnl / tot) * 100 : NaN;
    return { n, tot, wins, stops, avg: n ? tot / n : NaN, win: n ? (wins / n) * 100 : NaN, stopPct: n ? (stops / n) * 100 : NaN, topAbs, topShare };
  };

  // ---- (b) COST-GATE SWEEP ----
  console.log(`  ══ (b) COST-GATE SWEEP — does relaxing the gate flip the verdict or just dilute? ══`);
  console.log(`  gate    n   win%   avg$/t    total$    stop%   topDay$  topShare%`);
  for (const g of GATES) {
    const s = summarize(runAtGate(g));
    const top = s.topAbs ? `${usd(s.topAbs.pnl)} (${s.topAbs.date})` : "—";
    console.log(`  ${g.toFixed(1).padStart(4)} ${String(s.n).padStart(4)} ${s.n ? `${Math.round(s.win)}%`.padStart(6) : "    —"} ${s.n ? usd(s.avg).padStart(8) : "       —"} ${s.n ? usd(s.tot).padStart(9) : "        —"} ${s.n ? `${Math.round(s.stopPct)}%`.padStart(7) : "      —"}   ${top.padEnd(20)} ${Number.isFinite(s.topShare) ? `${Math.round(s.topShare)}%`.padStart(6) : "—"}`);
  }

  // ---- (a) LEAVE-ONE-OUT at the live gate 3.0 and at the most-inclusive gate 0 ----
  console.log(`\n  ══ (a) LEAVE-ONE-OUT — drop the single dominant day, recompute ══`);
  for (const g of [3.0, 0]) {
    const rows = runAtGate(g);
    const full = summarize(rows);
    if (!full.topAbs) { console.log(`  gate ${g.toFixed(1)}: no fills`); continue; }
    const dropped = full.topAbs.date;
    const loo = summarize(rows.filter((r) => r.date !== dropped));
    console.log(`  gate ${g.toFixed(1)}:  full  n=${full.n}  avg ${usd(full.avg)}/t  win ${Math.round(full.win)}%  Σ ${usd(full.tot)}`);
    console.log(`           −${dropped} (${usd(full.topAbs.pnl)}):  n=${loo.n}  avg ${usd(loo.avg)}/t  win ${Math.round(loo.win)}%  Σ ${usd(loo.tot)}  ${loo.avg > 0 ? "→ EDGE SURVIVES" : "→ EDGE COLLAPSES"}`);
  }

  // ---- per-day receipts at gate 0 (every meaningful day, fills + the marginal adds) ----
  console.log(`\n  ══ per-day @ gate 0 (every meaningful-move day — the marginal adds the gate filters) ══`);
  console.log(`  date         move%    pnl$    exit`);
  for (const r of runAtGate(0)) {
    console.log(`  ${r.date}  ${sgn(r.movePct)}${r.movePct.toFixed(2).padStart(5)}  ${r.pnl != null ? usd(r.pnl).padStart(6) : "    —"}   ${r.exit}`);
  }

  console.log(`\n  READ: gate that maximizes avg$/t = the live filter working. If lower gates ADD trades but DROP`);
  console.log(`  avg$/t, the marginal days are coin-flips (gate validated). LOO survival (avg>0 ex-top-day) = the`);
  console.log(`  edge isn't one day; still N≈${meaningful.length} = anecdote-grade, re-run after each live FOMC.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
