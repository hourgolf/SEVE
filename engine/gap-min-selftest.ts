// gap-min-selftest — verify the engine's gap_min CONDITION reproduces the manual
// |gap| filter from gap-gate-probe (which gated outside the engine). If ALT with a
// gap_min:0.25 entry condition matches the probe's ≥0.25 row (+251.6/t, n=67), the
// feature is wired correctly end-to-end (realsource gap → build levels.gap → ctx.gap
// → the gap_min case).  npm run gap-min-selftest
import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec, Condition } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "gm", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const altAll = (gapMin?: number): Condition[][] => {
  const base: Condition[] = [{ kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }];
  const g: Condition[] = gapMin != null ? [{ kind: "gap_min", pct: gapMin }] : [];
  return [
    [{ kind: "opening_range", side: "break_above", minutes: 30 }, ...base, ...g],
    [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }, ...g],
  ];
};
const evalAlt = (gapMin?: number) => {
  const [callAll, putAll] = altAll(gapMin);
  const spec: StrategySpec = { meta: { name: "alt", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "alt" } as StrategySpec["meta"], exits: [{ timeET: "15:25" }], sizing: {}, entries: [{ direction: "call", reason: "u", all: callAll }, { direction: "put", reason: "d", all: putAll }] };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const run = (mk: (s: RealSession) => Evaluate): Trade[] => real.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));
  const show = (label: string, ts: Trade[]) => { const m = metrics(ts, real.length); console.log(`  ${label.padEnd(26)} n=${String(ts.length).padStart(4)}  exp$/t ${(ts.length ? m.totalPnl / ts.length : 0).toFixed(1).padStart(7)}  Σ ${Math.round(m.totalPnl)}`); };
  console.log(`\n  GAP_MIN engine self-test · ALT · ${real.length} SPY sessions (real NBBO)\n`);
  show("no gap_min (baseline)", run(evalAlt()));
  show("gap_min 0.25 (engine)", run(evalAlt(0.25)));
  show("gap_min 0.35 (engine)", run(evalAlt(0.35)));
  console.log(`\n  EXPECT (vs gap-gate-probe manual filter): baseline n=114 +115.3/t · ≥0.25 n=67 +251.6/t · ≥0.35 n=52 +297.9/t`);
  console.log(`  Match ⇒ the gap_min condition is wired correctly end-to-end.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
