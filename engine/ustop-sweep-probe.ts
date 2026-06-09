// ============================================================================
//  ustop-sweep-probe — (#1) what underlying-initial-stop level helps each channel, and
//  (#2) does breakout-qqq's dormant SPEC entry beat the builtin bare ORB it runs live?
//
//  The exit-scheme study found the 0.20% underlying stop is the desk's best risk control
//  — loss-only, cuts losers WITHOUT capping the convex tail (unlike a target/scale/trail).
//  But several channels run ustop=0 (POWERHOUR base+ALT, power-final30, BREAK base, grind).
//  This sweeps ustop {0 / 0.15 / 0.20 / 0.25} on the RIDE exit (−50% stop, no take-profit
//  — the recommended exit) under LIVE conditions (cost gate 3.0, faithful max_contracts,
//  slug `power` gate-exempt as live) and reports per-channel exp$/t + per-window EV.
//
//    npm run ustop-sweep
//
//  READ #1: a ustop level is a KEEPER if exp$/t RISES (pooled AND across windows) vs 0.
//  On the convex-edge channels it must NOT cut exp$/t (loss-only → tail intact); the best
//  level is where loss-reduction peaks before it starts shaking out dipped winners.
//  READ #2: compare QQQ-Break(builtin) vs QQQ-Break(spec) at matched ustop — if the gated
//  spec entry is less −EV / higher win%, rename breakout-qqq off the base-slug so the
//  worker runs the spec, not the bare ORB.
//
//  Faithful entries: 4 SPY compiled channels + breakout-qqq spec embed the live
//  strategists.spec_json (2026-06-09); builtins (power/power-final30/breakout/grind-v3)
//  match the worker REGISTRY. Real Databento NBBO. Sizing = max_contracts (6; QQQ 4).
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { powerEvaluate, DEFAULT_POWER_PARAMS, DEFAULT_POWER_FINAL30 } from "./strategies/power";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const USTOPS = [0, 0.15, 0.20, 0.25];

// ── LIVE spec_json entries (strategists.spec_json, Supabase 2026-06-09) ──────────────
const ENTRIES_ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ENTRIES_QQQ_SPEC: StrategySpec["entries"] = [
  { direction: "call", reason: "qbreak_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.3 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.4, lookback: 3 }, { kind: "rel_vol", min: 1.5 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "qbreak_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.3 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.4, lookback: 3 }, { kind: "rel_vol", min: 1.5 }, { kind: "time_before", et: "15:25" }] },
];
const ENTRIES_POWER: StrategySpec["entries"] = [
  { direction: "call", reason: "power_long", all: [{ kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
  { direction: "put", reason: "power_short", all: [{ kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
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

type Channel = { name: string; tag: string; underlying: string; maxC: number; gated: boolean; liveUstop: number; makeEval: (s: RealSession) => Evaluate };
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
const ev = (e: Evaluate) => () => e;
const CHANNELS: Channel[] = [
  { name: "ORB(base)",        tag: "SPY·spec",     underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0.20, makeEval: specEval(mkSpec("orb", ENTRIES_ORB, "15:30")) },
  { name: "QQQ-Break(BUILTIN)", tag: "QQQ·bareORB", underlying: "QQQ", maxC: 4, gated: true, liveUstop: 0.20, makeEval: ev((f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS)) },
  { name: "QQQ-Break(SPEC)",  tag: "QQQ·spec",     underlying: "QQQ", maxC: 4, gated: true,  liveUstop: 0.20, makeEval: specEval(mkSpec("qqqb", ENTRIES_QQQ_SPEC, "15:30")) },
  { name: "POWERHOUR(ALT)",   tag: "SPY·spec",     underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0,    makeEval: specEval(mkSpec("pwr", ENTRIES_POWER, "15:55")) },
  { name: "POWERHOUR(base)",  tag: "SPY·builtin",  underlying: "SPY", maxC: 6, gated: false, liveUstop: 0,    makeEval: ev((f, p) => powerEvaluate(f, p, DEFAULT_POWER_PARAMS)) },
  { name: "Power-Final30",    tag: "SPY·builtin",  underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0,    makeEval: ev((f, p) => powerEvaluate(f, p, DEFAULT_POWER_FINAL30)) },
  { name: "BREAK(ALT)",       tag: "SPY·spec",     underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0.20, makeEval: specEval(mkSpec("alt", ENTRIES_ALT, "15:25")) },
  { name: "BREAK(ALT-V3)",    tag: "SPY·spec",     underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0.20, makeEval: specEval(mkSpec("v3", ENTRIES_ALT_V3, "15:25")) },
  { name: "BREAK(base)",      tag: "SPY·builtin",  underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0,    makeEval: ev((f, p) => breakoutEvaluate(f, p, DEFAULT_BREAKOUT_PARAMS)) },
  { name: "GRIND-v3",         tag: "SPY·builtin",  underlying: "SPY", maxC: 6, gated: true,  liveUstop: 0,    makeEval: ev((f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS)) },
];

const cfgFor = (ch: Channel): StrategistConfig => ({ slug: "us", capital_pct: 100, aggression: 100, max_contracts: ch.maxC, daily_stop_usd: 1e9, muted: false, soloed: false });
// RIDE exit (−50% stop, no take-profit) + cost gate (live) + swept underlying stop.
const run = (ch: Channel, set: RealSession[], chainOf: (s: RealSession) => ChainProvider, ustop: number): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, cfgFor(ch), FUND, ch.makeEval(s), chainOf(s), false,
    { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, ustop, ch.gated ? GATE : undefined));

interface Loaded { real: RealSession[]; chainOf: (s: RealSession) => ChainProvider }
async function loadFor(u: string, sinceDaysAgo: number): Promise<Loaded> {
  const sessions = await loadRealSessions({ symbol: u, sinceDaysAgo });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), u) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
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
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const spy = await loadFor("SPY", sinceDaysAgo);
  const qqq = await loadFor("QQQ", sinceDaysAgo);
  const loadedOf = (u: string) => (u === "QQQ" ? qqq : spy);

  console.log(`\n  UNDERLYING-STOP sweep · RIDE exit (−50% stop, no take-profit) · cost gate 3.0 (live) · real NBBO`);
  console.log(`  SPY ${spy.real.length} sessions · QQQ ${qqq.real.length} sessions · sizing = max_contracts (6; QQQ 4)`);
  console.log(`  #2: compare QQQ-Break(BUILTIN) vs QQQ-Break(SPEC) at matched ustop\n`);
  const hdr = "  " + "".padEnd(16) + USTOPS.map((u) => (u === 0 ? "ustop 0" : `${u.toFixed(2)}%`).padStart(14)).join("");

  for (const ch of CHANNELS) {
    const ld = loadedOf(ch.underlying);
    const liveTag = USTOPS.map((u) => (u === ch.liveUstop ? "↑live" : "")).map((x) => x.padStart(14)).join("");
    console.log(`  ══ ${ch.name}  [${ch.tag}${ch.gated ? "" : " · gate-EXEMPT"}] ══`);
    console.log("  " + "".padEnd(16) + liveTag);
    console.log(hdr);
    const cells = USTOPS.map((u) => { const tr = run(ch, ld.real, ld.chainOf, u); const m = metrics(tr, ld.real.length); return { exp: tr.length ? m.totalPnl / tr.length : 0, win: m.winRate * 100, n: tr.length, total: m.totalPnl }; });
    console.log("  " + "exp$/t".padEnd(16) + cells.map((c) => `${sgn(c.exp)}${c.exp.toFixed(1)}`.padStart(14)).join(""));
    console.log("  " + "win% · n".padEnd(16) + cells.map((c) => `${c.win.toFixed(0)}w·${c.n}`.padStart(14)).join(""));
    console.log("  " + "total$".padEnd(16) + cells.map((c) => `${sgn(c.total)}${Math.round(c.total)}`.padStart(14)).join(""));
    console.log("  ── per-window total$ ──");
    for (const w of WINDOWS) {
      const win = ld.real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const tots = USTOPS.map((u) => Math.round(metrics(run(ch, win, ld.chainOf, u), win.length).totalPnl));
      console.log("  " + w.name.padEnd(16) + tots.map((v) => `${sgn(v)}${v}`.padStart(14)).join(""));
    }
    console.log("");
  }
  console.log("  READ #1: pick the ustop where pooled exp$/t peaks AND per-window total$ improves broadly. On the");
  console.log("  +EV edge channels (BREAK ALT/V3) the ustop must not DROP exp$/t (loss-only → tail intact).");
  console.log("  READ #2: if QQQ-Break(SPEC) beats (BUILTIN) at matched ustop, rename breakout-qqq off the base-slug.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
