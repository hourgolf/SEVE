// ============================================================================
//  compound-vs-ride-probe — the operator's "take profits and redeploy" style, modeled
//  FAITHFULLY against ride-to-close. (2026-06-16.) The operator's thesis: on a channel
//  that picks good entries but rides recklessly, taking profit early and RE-ENTERING the
//  next signal (compounding several realized winners) beats riding ONE position to its
//  (often non-existent) convex tail. The foul-out finding makes this measurable: the book
//  is one-at-a-time, so riding forecloses the re-entries — and the audit showed PB has no
//  real tail (ride = −EV at the live gate) while V3/ALT do (ride = +EV).
//
//  This sweeps a PROFIT TARGET (exit at +X% premium, then re-enter on the next qualifying
//  signal — the existing re-entry-when-flat loop does the compounding) vs RIDE (no target,
//  hold to −50% stop / 15:25 flatten), at the FAITHFUL cost model (live 0.25 gate, audited
//  1-tick fills) and LIVE sizing (RISK 500 / stop 500). Each channel at its live DTE.
//
//  PREDICTION (the channel-specific synthesis): V3/ALT (real convex tail) → RIDE wins,
//  tightening caps the tail. PB (no tail, good entries) → a TARGET wins = compounding beats
//  riding = the operator's instinct is right BECAUSE PB lacks the tail the desk assumed.
//
//    npm run compound-vs-ride-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const cfgOf = (maxC: number): StrategistConfig => ({ slug: "cr", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };               // audited 1-tick fill
const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // live worker gate

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"], timeET: string) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET }], sizing: {}, entries });
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
const V3 = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", false) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", false) }];
const ALT = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", true) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", true) }];

const CH: Array<{ name: string; dte: 0 | 1; maxC: number; mk: (s: RealSession) => Evaluate }> = [
  { name: "PB RIDER (1DTE)", dte: 1, maxC: 4, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS) },
  { name: "BREAK(ALT V3)", dte: 0, maxC: 6, mk: specEval(V3, "15:25") },
  { name: "BREAK(ALT)", dte: 0, maxC: 6, mk: specEval(ALT, "15:25") },
];
const TARGETS: Array<number | null> = [null, 30, 40, 50, 75, 100]; // null = RIDE (no target)

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET); return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };

  console.log(`\n  COMPOUND-vs-RIDE · ${real.length} SPY sessions (real NBBO) · FAITHFUL (live 0.25 gate + 1-tick fills) · RISK ${RISK}/stop ${DAILY_STOP}`);
  console.log(`  exit at +X% then RE-ENTER the next signal (compound) vs RIDE to −50%/15:25 flatten · Σ P&L (trades)\n`);
  const hdr = TARGETS.map((t) => (t == null ? "RIDE" : `+${t}%`).padStart(14)).join("");
  console.log(`  ${"channel".padEnd(17)}${hdr}   best`);

  for (const ch of CH) {
    const cfg = cfgOf(ch.maxC);
    const cells: Array<{ t: number | null; tot: number; n: number }> = [];
    for (const t of TARGETS) {
      let tot = 0, n = 0;
      for (const s of real) {
        const exp = ch.dte === 0 ? s.dateET : nextOf.get(s.dateET)!;
        const premiumExit = t == null ? { stopPct: 50 } : { profitPct: t, stopPct: 50 };
        const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), chainFor(s, exp), false, premiumExit, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE });
        tot += ts.reduce((a, x) => a + x.pnl, 0); n += ts.length;
      }
      cells.push({ t, tot, n });
    }
    const ride = cells[0].tot;
    const best = cells.reduce((a, c) => (c.tot > a.tot ? c : a));
    const bestLbl = best.t == null ? "RIDE" : `+${best.t}%`;
    const verdict = best.t == null ? "RIDE wins (real tail)" : `${bestLbl} beats RIDE by ${usd(best.tot - ride)} → COMPOUND wins`;
    console.log(`  ${ch.name.padEnd(17)}${cells.map((c) => `${usd(c.tot)}`.padStart(14)).join("")}   ${verdict}`);
    console.log(`  ${" ".repeat(17)}${cells.map((c) => `(${c.n}t)`.padStart(14)).join("")}`);
  }
  console.log(`\n  READ: a +X% target that BEATS the RIDE column = compounding (realize + redeploy) > riding the tail for that channel.`);
  console.log(`  Expect V3/ALT to prefer RIDE (the convex tail the audit confirmed) and PB to prefer a TARGET (no tail → compound the good entries).\n`);

  // ---- PER-WINDOW ROBUSTNESS for PB (the channel that flips) — is compound>ride a REGIME-WIDE
  //      result or a single-window mirage? (the tier2/scalp-edge cautionary pattern) ----
  const WINDOWS = [
    { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
    { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
    { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
    { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
    { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
  ];
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)?.name ?? null;
  const pb = CH[0], cfg = cfgOf(pb.maxC);
  const pbWin = (t: number | null) => {
    const by = new Map<string, number>();
    for (const s of real) {
      const w = winOf(s.dateET); if (!w) continue;
      const premiumExit = t == null ? { stopPct: 50 } : { profitPct: t, stopPct: 50 };
      const ts: Trade[] = simulateSession(s.bars, cfg, FUND, pb.mk(s), chainFor(s, nextOf.get(s.dateET)!), false, premiumExit, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE });
      by.set(w, (by.get(w) ?? 0) + ts.reduce((a, x) => a + x.pnl, 0));
    }
    return by;
  };
  const ride = pbWin(null), t30 = pbWin(30), t40 = pbWin(40);
  console.log(`  ══ PB per-window robustness — does COMPOUND beat RIDE across regimes, not one window? ══`);
  console.log(`  window               RIDE        +30%        +40%     +30 beats ride?`);
  let win30 = 0;
  for (const W of WINDOWS) {
    const r = ride.get(W.name) ?? 0, a = t30.get(W.name) ?? 0, b = t40.get(W.name) ?? 0;
    if (a > r) win30++;
    console.log(`  ${W.name.padEnd(18)} ${usd(r).padStart(8)}  ${usd(a).padStart(8)}  ${usd(b).padStart(8)}     ${a > r ? "✓" : "✗"}`);
  }
  console.log(`  → +30% beats RIDE on ${win30}/5 windows  ${win30 >= 4 ? "· ROBUST (compound is regime-wide for PB)" : "· check the misses before arming"}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
