// ============================================================================
//  roster-cost-audit — does the 1-tick-GATE flatter (found in pb-ride's validation)
//  inflate the OTHER armed channels too? (2026-06-16.) The pb-regime-mute probe proved
//  pb-ride's +$4,632 was a 1-tick-gate artifact: the validation's 3× cost gate used
//  DEFAULT_COST_MODEL slippage = 1 tick, but the LIVE worker's gate uses 0.25
//  (decide.ts:38). The inflated round-trip OVER-vetoes marginal entries → hides churn →
//  flatters the channel. This re-runs each armed SPY machine channel at its LIVE config
//  with the GATE slippage split from the FILL slippage (the new entryCostGate.gateCostModel),
//  isolating exactly how much each "edge" was flattered — and whether it survives the live gate.
//
//  Per channel, over the 308-session corpus (real Databento NBBO, each at its live DTE):
//   · FAITHFUL  = live sizing (RISK 500) + live gate 0.25 + audited 1-tick fills
//   · BRACKET   = same, optimistic 0.25-tick fills (the fill model is contested)
//   · FLATTERED = same sizing, but the 1-tick GATE the validations used → the inflation delta
//
//    npm run roster-cost-audit
//  NOTE: SPY machine channels only (V3/ALT/base-breakout/power/grind/PB). QQQ channels
//  (breakout-qqq, orb-qqq-trail, qqq-thrust-trail) need the QQQ corpus — a follow-on.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { getStrategy } from "./registry";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { powerEvaluate, DEFAULT_POWER_MOM60 } from "./strategies/power";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const cfgOf = (maxC: number): StrategistConfig => ({ slug: "ra", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const RATIO = 3.0;

const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };                              // audited 1-tick fill
const FILL_025: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // optimistic 0.25 fill
const GATE_LIVE: CostModel = FILL_025;  // live worker gate (decide.ts → 0.25)
const GATE_BLESSED: CostModel = FILL_1T; // 1-tick gate the validations used

// V3/ALT entry legs (the armed configs: gap_min 0.25 + entries→14:00, exit 15:25).
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
  { name: "BREAK(ALT V3)", dte: 0, maxC: 6, mk: specEval(V3, "15:25") },
  { name: "BREAK(ALT)", dte: 0, maxC: 6, mk: specEval(ALT, "15:25") },
  { name: "BREAK(base ORB)", dte: 0, maxC: 6, mk: (s) => getStrategy("breakout")!.build(s.bars, 1) },
  { name: "POWERHOUR", dte: 0, maxC: 6, mk: () => (f, p) => powerEvaluate(f, p, DEFAULT_POWER_MOM60) },
  { name: "GRIND v3", dte: 0, maxC: 4, mk: () => (f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS) },
  { name: "PB RIDER (1DTE)", dte: 1, maxC: 4, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS) },
];

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET); return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };

  console.log(`\n  ROSTER COST-AUDIT · ${real.length} SPY sessions (real NBBO) · each armed channel at LIVE config (RISK ${RISK}/stop ${DAILY_STOP})`);
  console.log(`  the question: does the 1-tick-GATE flatter (that inflated pb-ride's +$4,632) survive into the LIVE 0.25 gate?\n`);
  console.log(`  channel            FAITHFUL (gate 0.25, fill 1t)   bracket (fill 0.25)   FLATTERED (gate 1t)   gate-flatter   verdict`);

  for (const ch of CH) {
    const cfg = cfgOf(ch.maxC);
    const run = (fill: CostModel, gate: CostModel) => {
      let tot = 0, n = 0;
      for (const s of real) {
        const exp = ch.dte === 0 ? s.dateET : nextOf.get(s.dateET)!;
        const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), chainFor(s, exp), false, { stopPct: 50 }, fill, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: gate });
        tot += ts.reduce((a, x) => a + x.pnl, 0); n += ts.length;
      }
      return { tot, n };
    };
    const faithful = run(FILL_1T, GATE_LIVE);   // live gate + audited fills
    const bracket = run(FILL_025, GATE_LIVE);   // live gate + optimistic fills
    const flattered = run(FILL_1T, GATE_BLESSED); // 1-tick gate (validation) + audited fills
    const flat = flattered.tot - faithful.tot;  // how much the 1-tick gate inflated
    const lo = Math.min(faithful.tot, bracket.tot), hi = Math.max(faithful.tot, bracket.tot);
    const verdict = lo > 0 ? "+EV (survives)" : hi < 0 ? "−EV (bleeds)" : "mixed (bracket straddles 0)";
    console.log(`  ${ch.name.padEnd(16)} ${`${usd(faithful.tot)} (${faithful.n}t)`.padStart(22)}   ${usd(bracket.tot).padStart(12)}   ${usd(flattered.tot).padStart(14)}   ${usd(flat).padStart(10)}   ${verdict}`);
  }
  console.log(`\n  READ: FAITHFUL > 0 across the bracket = the edge survives the live gate. gate-flatter = the inflation the 1-tick`);
  console.log(`  validation gate added; a large positive flatter on a now-−EV channel = its "edge" was the cost-model artifact (pb-ride's disease).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
