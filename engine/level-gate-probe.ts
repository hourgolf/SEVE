// ============================================================================
//  level-gate-probe — does LEVEL CONTEXT improve the keep-list entries?
//  (probe queue item, 2026-06-11 — the "Nakamoto's lever = the levels rewrite"
//   follow-through, pointed at OUR channels instead of his entries.)
//
//  Level sets come from the validated port (engine/nakamoto/levels.ts
//  warmupLevels: 180d daily swings + $5 grid ± $25 + 5m intraday pivots, all
//  computed STRICTLY pre-session — no look-ahead). Two PRE-REGISTERED gates,
//  fixed before the run (no post-hoc threshold shopping):
//
//   G1 room-to-run: BLOCK an entry when the nearest level AHEAD in the trade
//      direction is closer than 0.10% (G1a) / 0.20% (G1b) of spot. Mechanism:
//      the ride exit's payoff is runway; a wall just ahead caps the convex tail
//      the same way the 15:25 flatten caps a 14:xx entry.
//   G2 at-level break: REQUIRE the entry bar to sit within ±0.05% of a level
//      (breaking THROUGH structure) — the Nakamoto-flavored confirmation.
//
//  READ (same bar as every entry/exit study): a gate earns interest only if it
//  helps/neutral in ≥4 of 5 regime windows AND lifts pooled exp$/t. Known
//  caveat from the port: the $5 grid makes "near a level" common — expect G2
//  to pass a large share of entries; the blocked-count column keeps it honest.
//
//    npm run level-gate-probe
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { warmupLevels } from "./nakamoto/levels";
import { resample5m } from "./nakamoto/data";
import type { Bar as NakaBar } from "./nakamoto/data";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, Features, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "lvl", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

// Live spec entries — identical to entry-window-probe (the validated shapes).
// V3/ALT carry the ARMED →14:00 entry window (post 2026-06-11); ORB as-live →15:00.
const ENTRIES_ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ENTRIES_ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const ENTRIES_V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const mkSpec = (id: string, entries: StrategySpec["entries"], timeET: string): StrategySpec => ({
  meta: { name: id, regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: id } as StrategySpec["meta"],
  exits: [{ timeET }], entries, sizing: {},
});
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};

// ---- gates (pre-registered) ----------------------------------------------------
type GateFn = (f: Features, dir: "call" | "put", levels: number[]) => boolean; // true = entry allowed
const roomToRun = (limPct: number): GateFn => (f, dir, lv) => {
  let ahead = Infinity;
  for (const L of lv) {
    if (dir === "call" && L > f.close) ahead = Math.min(ahead, L - f.close);
    if (dir === "put" && L < f.close) ahead = Math.min(ahead, f.close - L);
  }
  if (!isFinite(ahead)) return true; // no level ahead = open runway
  return (100 * ahead) / f.close > limPct;
};
const atLevel = (tolPct: number): GateFn => (f, _dir, lv) =>
  lv.some((L) => (100 * Math.abs(L - f.close)) / f.close <= tolPct);

interface Variant { name: string; gate: GateFn | null }
const VARIANTS: Variant[] = [
  { name: "baseline (as-live)    ", gate: null },
  { name: "G1a room-to-run 0.10% ", gate: roomToRun(0.10) },
  { name: "G1b room-to-run 0.20% ", gate: roomToRun(0.20) },
  { name: "G2 at-level ±0.05%    ", gate: atLevel(0.05) },
];
const CHANNELS = [
  { ch: "V3 ", makeEval: specEval(mkSpec("v3", ENTRIES_V3, "15:25")) },
  { ch: "ALT", makeEval: specEval(mkSpec("alt", ENTRIES_ALT, "15:25")) },
  { ch: "ORB", makeEval: specEval(mkSpec("orb", ENTRIES_ORB, "15:30")) },
];
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const withNbbo = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);

  // Level inputs from the SAME session corpus (engine bars are structurally
  // nakamoto Bars; warmupLevels slices strictly < tradeDay internally).
  const dailyAll: NakaBar[] = sessions.map((s) => ({
    ts: s.bars[s.bars.length - 1].ts,
    open: s.bars[0].open,
    high: Math.max(...s.bars.map((b) => b.high)),
    low: Math.min(...s.bars.map((b) => b.low)),
    close: s.bars[s.bars.length - 1].close,
    volume: s.bars.reduce((a, b) => a + b.volume, 0),
  }));
  const bars5mAll: NakaBar[] = resample5m(sessions.flatMap((s) => s.bars as unknown as NakaBar[]));
  const levelsByDay = new Map<string, number[] | null>();
  for (const s of withNbbo) {
    try { levelsByDay.set(s.dateET, warmupLevels(dailyAll, bars5mAll, s.dateET).levels); }
    catch { levelsByDay.set(s.dateET, null); } // <30 prior dailies (corpus head) — session excluded
  }
  const real = withNbbo.filter((s) => levelsByDay.get(s.dateET) != null);
  const skipped = withNbbo.length - real.length;

  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const blocked = new Map<string, number>();
  const gatedEval = (mk: (s: RealSession) => Evaluate, gate: GateFn | null, key: string) => (s: RealSession): Evaluate => {
    const e = mk(s);
    const lv = levelsByDay.get(s.dateET)!;
    return (f, pos) => {
      const it = e(f, pos);
      if (!gate || it?.kind !== "enter") return it;
      if (gate(f, it.direction, lv)) return it;
      blocked.set(key, (blocked.get(key) ?? 0) + 1);
      return null;
    };
  };
  const run = (mkEval: (s: RealSession) => Evaluate, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mkEval(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  console.log(`\n  LEVEL-GATE probe · nakamoto warmup levels (pre-session, no look-ahead) · real NBBO · ride −50% stop · cost gate 3.0`);
  console.log(`  ${real.length} sessions levelled (${skipped} skipped: <30 prior dailies at the corpus head) · V3/ALT carry the ARMED →14:00 window`);
  console.log(`  ARM BAR: helps/neutral in ≥4 of 5 windows AND lifts pooled exp$/t.\n`);
  console.log("  channel·variant                exp$/t   n   blk     pooled$" + WINDOWS.map((w) => w.name.slice(0, 12).padStart(14)).join(""));
  for (const c of CHANNELS) {
    for (const v of VARIANTS) {
      const key = `${c.ch}|${v.name}`;
      blocked.set(key, 0);
      const mk = gatedEval(c.makeEval, v.gate, key);
      const all = run(mk, real);
      const blkAll = blocked.get(key) ?? 0;
      const m = metrics(all, real.length);
      const exp = all.length ? m.totalPnl / all.length : 0;
      const per = WINDOWS.map((w) => {
        const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
        blocked.set(key, 0); // per-window recount not reported; reset to keep pooled blk meaningful
        return Math.round(metrics(run(mk, win), win.length).totalPnl);
      });
      console.log(`  ${c.ch} ${v.name}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)} ${String(blkAll).padStart(5)}  ${`${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(14)).join(""));
    }
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
