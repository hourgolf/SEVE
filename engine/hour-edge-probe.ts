// ============================================================================
//  hour-edge-probe — WHEN do our channels' entries have edge?
//
//  Motivated by 06-10/06-11: morning first-leg momentum entries got steamrolled
//  (orb 738C twins −$960 at 10:26; the 11:12 P731 cluster gave back the V-bounce)
//  while AFTERNOON entries paid (+$384/+$294/+$318 at 14:43–14:51). Nakamoto's
//  313-session audit found time-of-day was HIS only real discriminator — we've
//  never run the same decomposition on OUR book.
//
//    npm run hour-edge-probe
//
//  Method: live-faithful ride configs (cost gate 3.0, −50% stop, live ustops,
//  real Databento NBBO), one run per channel over all sessions; trades bucketed
//  by ET ENTRY hour → exp$/t · win% · n per bucket, plus AM (≤12:59) vs PM
//  (≥13:00) rollup. READ: a channel whose edge concentrates in specific hours
//  gets an entry-WINDOW config change (armable as a spec/time gate — entry
//  selection, not exit engineering); uniform bleed across hours = entry has no
//  edge at any hour → cut-list confirmation.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };

// Live spec entries (strategists.spec_json, 2026-06-09 — same as ustop/fill-lag probes)
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
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
const ev = (e: Evaluate) => () => e;

type Channel = { name: string; underlying: string; maxC: number; ustop: number; makeEval: (s: RealSession) => Evaluate };
const CHANNELS: Channel[] = [
  { name: "BREAK(ALT-V3)", underlying: "SPY", maxC: 6, ustop: 0, makeEval: specEval(mkSpec("v3", ENTRIES_ALT_V3, "15:25")) },
  { name: "BREAK(ALT)", underlying: "SPY", maxC: 6, ustop: 0, makeEval: specEval(mkSpec("alt", ENTRIES_ALT, "15:25")) },
  { name: "ORB(trend-rider)", underlying: "SPY", maxC: 6, ustop: 0, makeEval: specEval(mkSpec("orb", ENTRIES_ORB, "15:30")) },
  { name: "POWERHOUR(base)", underlying: "SPY", maxC: 6, ustop: 0, makeEval: ev((f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS)) },
  { name: "GRIND-v3", underlying: "SPY", maxC: 6, ustop: 0, makeEval: ev((f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS)) },
  { name: "QQQ-Break(builtin)", underlying: "QQQ", maxC: 4, ustop: 0.20, makeEval: ev((f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS)) },
];

const cfgFor = (ch: Channel): StrategistConfig => ({ slug: "hod", capital_pct: 100, aggression: 100, max_contracts: ch.maxC, daily_stop_usd: 1e9, muted: false, soloed: false });

const ET_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false });
const hourOf = (ms: number) => Number(ET_HOUR.format(new Date(ms)));
const sgn = (v: number) => (v >= 0 ? "+" : "");

interface Loaded { real: RealSession[]; chainOf: (s: RealSession) => ChainProvider }
async function loadFor(u: string): Promise<Loaded> {
  const sessions = await loadRealSessions({ symbol: u, sinceDaysAgo: 800 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), u) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  return { real, chainOf: (s) => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]) };
}

async function main() {
  const spy = await loadFor("SPY");
  const qqq = await loadFor("QQQ");
  const loadedOf = (u: string) => (u === "QQQ" ? qqq : spy);
  const HOURS = [9, 10, 11, 12, 13, 14, 15];

  console.log(`\n  HOUR-OF-DAY EDGE decomposition · ride exits (−50% stop) · cost gate · real NBBO`);
  console.log(`  SPY ${spy.real.length} sessions · QQQ ${qqq.real.length} sessions · buckets by ET ENTRY hour\n`);

  for (const ch of CHANNELS) {
    const ld = loadedOf(ch.underlying);
    const trades: Trade[] = ld.real.flatMap((s) => simulateSession(
      s.bars, cfgFor(ch), FUND, ch.makeEval(s), ld.chainOf(s), false,
      { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, ch.ustop, GATE,
    ));
    const m = metrics(trades, ld.real.length);
    console.log(`  ══ ${ch.name}  [${ch.underlying}] — pooled ${sgn(m.totalPnl)}${Math.round(m.totalPnl)} · ${trades.length}t · ${(m.winRate * 100).toFixed(0)}% ══`);
    console.log(`     hour    exp$/t   win%      n     total$`);
    for (const h of HOURS) {
      const ts = trades.filter((t) => hourOf(t.entryTs) === h);
      if (!ts.length) continue;
      const tot = ts.reduce((a, t) => a + t.pnl, 0);
      const w = ts.filter((t) => t.pnl > 0).length;
      console.log(`     ${String(h).padStart(2)}:xx  ${`${sgn(tot / ts.length)}${(tot / ts.length).toFixed(1)}`.padStart(8)}  ${`${Math.round((100 * w) / ts.length)}%`.padStart(5)}  ${String(ts.length).padStart(5)}  ${`${sgn(tot)}${Math.round(tot)}`.padStart(9)}`);
    }
    const am = trades.filter((t) => hourOf(t.entryTs) <= 12);
    const pm = trades.filter((t) => hourOf(t.entryTs) >= 13);
    const amT = am.reduce((a, t) => a + t.pnl, 0), pmT = pm.reduce((a, t) => a + t.pnl, 0);
    console.log(`     AM ≤12:59: ${sgn(amT)}${Math.round(amT)} (${am.length}t, ${am.length ? sgn(amT / am.length) + (amT / am.length).toFixed(1) : "—"}/t) · PM ≥13:00: ${sgn(pmT)}${Math.round(pmT)} (${pm.length}t, ${pm.length ? sgn(pmT / pm.length) + (pmT / pm.length).toFixed(1) : "—"}/t)\n`);
  }
  console.log(`  READ: hour-concentrated edge → an entry-WINDOW config (armable, entry-selection not exit`);
  console.log(`  engineering — the one lever every probe endorses). Uniform bleed → cut-list confirmation.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
