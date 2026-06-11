// ============================================================================
//  fill-lag-probe — what is execution LATENCY worth, per channel, in dollars?
//
//  Context (the Phase-B/Railway question): bars are stamped at their START, so
//  a chain fill at ts+60s is the NBBO at the instant the bar's CLOSE is knowable
//  — i.e. lag 60s = a ZERO-added-latency fill (the tick-worker ideal; anything
//  below would be look-ahead). The live cron's real fill lands later: the bar
//  must land in the DB, the minute cron must fire, the market order must fill —
//  somewhere in the ts+90..120s band on a good cycle, ts+180s on a missed one.
//
//  This sweeps fillLag {60 / 90 / 120 / 180}s on live-faithful channel configs
//  (real Databento NBBO, cost gate 3.0, live ustops, RIDE exit −50% stop) and
//  reports the LATENCY TAX: P&L at each lag vs the 60s tick-ideal baseline.
//  The (90..120 − 60) delta bounds what Phase-B buys on ENTRY/EXIT fill timing
//  for bar-close strategies. NOTE: minute NBBO cannot see intrabar stop/target
//  overshoot — the 5s-exit-poll prize is measured separately from LIVE fills
//  (see the positions-table overshoot audit in the session notes).
//
//    npm run fill-lag-probe
//
//  READ: a channel whose P&L is flat across lags is latency-insensitive (edge
//  is selection, not speed); a steep lag→loss slope = Phase-B recovers real
//  dollars there. Expect the convex riders to be least sensitive (few trades,
//  held to close) and the high-frequency leans (power) most sensitive per trade
//  — but speed cannot flip a −EV book, only cheapen it.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const LAGS_S = [60, 90, 120, 180]; // 60 = tick-ideal (decision-instant fill)

// ── LIVE spec_json entries (strategists.spec_json, 2026-06-09) ────────────────
const ENTRIES_ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ENTRIES_ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const ENTRIES_ALT_V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const mkSpec = (id: string, entries: StrategySpec["entries"], timeET: string): StrategySpec => ({
  meta: { name: id, regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: id } as StrategySpec["meta"],
  exits: [{ timeET }], entries, sizing: {},
});

type Channel = { name: string; underlying: string; maxC: number; ustop: number; makeEval: (s: RealSession) => Evaluate };
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
const ev = (e: Evaluate) => () => e;
// Live-faithful: ustop 0 on the ride channels (zeroed 06-09), 0.20 on QQQ-Break;
// ALL channels cost-gated (worker 2026-06-09a removed the power exemption).
const CHANNELS: Channel[] = [
  { name: "BREAK(ALT)",      underlying: "SPY", maxC: 6, ustop: 0,    makeEval: specEval(mkSpec("alt", ENTRIES_ALT, "15:25")) },
  { name: "BREAK(ALT-V3)",   underlying: "SPY", maxC: 6, ustop: 0,    makeEval: specEval(mkSpec("v3", ENTRIES_ALT_V3, "15:25")) },
  { name: "ORB(trend-rider)", underlying: "SPY", maxC: 6, ustop: 0,   makeEval: specEval(mkSpec("orb", ENTRIES_ORB, "15:30")) },
  { name: "POWERHOUR(base)", underlying: "SPY", maxC: 6, ustop: 0,    makeEval: ev((f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS)) },
  { name: "QQQ-Break(builtin)", underlying: "QQQ", maxC: 4, ustop: 0.20, makeEval: ev((f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS)) },
];

const cfgFor = (ch: Channel): StrategistConfig => ({ slug: "lag", capital_pct: 100, aggression: 100, max_contracts: ch.maxC, daily_stop_usd: 1e9, muted: false, soloed: false });
const run = (ch: Channel, set: RealSession[], chainOf: (s: RealSession, lagMs: number) => ChainProvider, lagMs: number): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, cfgFor(ch), FUND, ch.makeEval(s), chainOf(s, lagMs), false,
    { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, ch.ustop, GATE));

interface Loaded { real: RealSession[]; chainOf: (s: RealSession, lagMs: number) => ChainProvider }
async function loadFor(u: string, sinceDaysAgo: number): Promise<Loaded> {
  const sessions = await loadRealSessions({ symbol: u, sinceDaysAgo });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), u) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession, lagMs: number): ChainProvider => {
    const c = byDay.get(s.dateET)!;
    return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0], lagMs);
  };
  return { real, chainOf };
}

const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",       from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const spy = await loadFor("SPY", 800);
  const qqq = await loadFor("QQQ", 800);
  const loadedOf = (u: string) => (u === "QQQ" ? qqq : spy);

  console.log(`\n  FILL-LAG sweep · real NBBO · RIDE exit (−50% stop) · cost gate 3.0 · live ustops`);
  console.log(`  lag 60s = tick-ideal (fill at the decision instant) · 90-120s ≈ today's cron band · 180s = missed cycle`);
  console.log(`  SPY ${spy.real.length} sessions · QQQ ${qqq.real.length} sessions\n`);

  const hdr = "  " + "".padEnd(18) + LAGS_S.map((l) => `${l}s${l === 60 ? " (ideal)" : ""}`.padStart(13)).join("") + "   tax 90/120/180 vs ideal";

  for (const ch of CHANNELS) {
    const ld = loadedOf(ch.underlying);
    console.log(`  ══ ${ch.name}  [${ch.underlying} · ustop ${ch.ustop}] ══`);
    console.log(hdr);
    const cells = LAGS_S.map((l) => {
      const tr = run(ch, ld.real, ld.chainOf, l * 1000);
      const m = metrics(tr, ld.real.length);
      return { exp: tr.length ? m.totalPnl / tr.length : 0, win: m.winRate * 100, n: tr.length, total: m.totalPnl };
    });
    const base = cells[0].total;
    const tax = LAGS_S.slice(1).map((_, i) => Math.round(cells[i + 1].total - base));
    console.log("  " + "total$".padEnd(18) + cells.map((c) => `${sgn(c.total)}${Math.round(c.total)}`.padStart(13)).join("") + `   ${tax.map((t) => `${sgn(t)}${t}`).join(" / ")}`);
    console.log("  " + "exp$/t".padEnd(18) + cells.map((c) => `${sgn(c.exp)}${c.exp.toFixed(1)}`.padStart(13)).join(""));
    console.log("  " + "win% · n".padEnd(18) + cells.map((c) => `${c.win.toFixed(0)}w·${c.n}`.padStart(13)).join(""));
    console.log("  ── per-window total$ (lag 60 → 120) ──");
    for (const w of WINDOWS) {
      const win = ld.real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const t60 = Math.round(metrics(run(ch, win, ld.chainOf, 60_000), win.length).totalPnl);
      const t120 = Math.round(metrics(run(ch, win, ld.chainOf, 120_000), win.length).totalPnl);
      console.log("  " + w.name.padEnd(18) + `${sgn(t60)}${t60}`.padStart(10) + " → " + `${sgn(t120)}${t120}`.padStart(10) + `   (Δ ${sgn(t120 - t60)}${t120 - t60})`);
    }
    console.log("");
  }
  console.log("  READ: 'tax' = what slower fills cost vs the tick-ideal. Phase-B's ENTRY-side prize per");
  console.log("  channel ≈ the 90..120s tax (today's cron band). Flat rows = latency-insensitive edge.");
  console.log("  The intrabar 5s-exit-poll prize is NOT visible at minute NBBO — see the live overshoot audit.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
