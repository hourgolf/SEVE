// ============================================================================
//  regime-attribution-probe — the feasibility test for the "dynamic regime router"
//  vision. Before building a router you must know: ARE the channels regime-separable?
//  (Does PB own trends, V3/ALT own gaps, grind/power lose everywhere?) If each channel
//  has a regime where it clearly wins and one where it clearly loses, a router has
//  something to route to. If they blur, a router is hopeless. Classifies each session's
//  REALIZED regime (trend/chop/drift × gap/flat) and cross-tabs per-channel P&L by it,
//  real Databento NBBO, the 5-window corpus, each channel at its LIVE DTE.
//
//    npm run regime-attribution-probe
//  This measures separability on REALIZED regime (hindsight) — it does NOT solve the
//  ex-ante detection problem (that's the binding constraint; gap_min is the one armed
//  signal, gamma-open is collecting). Separable here = a router is WORTH pursuing IF an
//  ex-ante classifier can be found; non-separable = the router is moot regardless.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { powerEvaluate, DEFAULT_POWER_MOM60 } from "./strategies/power";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "ra", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
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

const CH: Array<{ name: string; dte: 0 | 1; mk: (s: RealSession) => Evaluate }> = [
  { name: "PB-ride", dte: 1, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS) },
  { name: "BREAK-V3", dte: 0, mk: specEval(V3, "15:25") },
  { name: "BREAK-ALT", dte: 0, mk: specEval(ALT, "15:25") },
  { name: "grind-v3", dte: 0, mk: () => (f, p) => grindV2Evaluate(f, p, DEFAULT_GRIND_V3_PARAMS) },
  { name: "power", dte: 0, mk: () => (f, p) => powerEvaluate(f, p, DEFAULT_POWER_MOM60) },
];

// realized regime from the session bars (RTH 1-min)
function regimeOf(s: RealSession): { dir: "TREND" | "CHOP" | "DRIFT"; gap: "GAP" | "FLAT" } {
  const b = s.bars, o = b[0].close, c = b[b.length - 1].close;
  const move = Math.abs((c - o) / o) * 100;
  let legs = 0, anchor = o, dir = 0;
  for (const x of b) { const m = (x.close - anchor) / anchor; if (Math.abs(m) >= 0.003) { const d = Math.sign(m); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = x.close; } }
  const r: "TREND" | "CHOP" | "DRIFT" = legs >= 3 ? "CHOP" : move >= 0.45 ? "TREND" : "DRIFT";
  return { dir: r, gap: Math.abs(s.gap ?? 0) >= 0.25 ? "GAP" : "FLAT" };
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET); return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };
  const reg = new Map(real.map((s) => [s.dateET, regimeOf(s)]));

  const dirBuckets = ["TREND", "CHOP", "DRIFT"] as const;
  const counts = { TREND: 0, CHOP: 0, DRIFT: 0, GAP: 0, FLAT: 0 } as Record<string, number>;
  for (const s of real) { const r = reg.get(s.dateET)!; counts[r.dir]++; counts[r.gap]++; }
  console.log(`\n  REGIME ATTRIBUTION · ${real.length} SPY sessions (real NBBO) · channel P&L by REALIZED regime`);
  console.log(`  regime mix:  TREND ${counts.TREND}  CHOP ${counts.CHOP}  DRIFT ${counts.DRIFT}  ·  GAP ${counts.GAP}  FLAT ${counts.FLAT}\n`);

  const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);
  // per channel: total P&L by dir-regime + by gap (mean $/session)
  console.log(`  ${"channel".padEnd(11)}` + dirBuckets.map((d) => `${d}/sess`.padStart(14)).join("") + `${"GAP/sess".padStart(14)}${"FLAT/sess".padStart(14)}`);
  for (const ch of CH) {
    const day = new Map<string, number>();
    for (const s of real) {
      const t: Trade[] = simulateSession(s.bars, CFG, FUND, ch.mk(s), chainFor(s, ch.dte === 0 ? s.dateET : nextOf.get(s.dateET)!), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
      day.set(s.dateET, t.reduce((a, x) => a + x.pnl, 0));
    }
    const agg = (pred: (r: { dir: string; gap: string }) => boolean) => {
      const ds = real.filter((s) => pred(reg.get(s.dateET)!)); const tot = ds.reduce((a, s) => a + (day.get(s.dateET) ?? 0), 0);
      return ds.length ? `${sgn(tot / ds.length)}` : "—";
    };
    console.log(`  ${ch.name.padEnd(11)}` + dirBuckets.map((d) => `${agg((r) => r.dir === d)}`.padStart(14)).join("") + `${agg((r) => r.gap === "GAP").padStart(14)}${agg((r) => r.gap === "FLAT").padStart(14)}`);
  }
  console.log(`\n  READ: a channel that wins one regime and loses another = SEPARABLE (a router has signal to route to).`);
  console.log(`  If channels blur (similar across regimes), a router is moot. Separability here is NECESSARY but not SUFFICIENT —`);
  console.log(`  it still needs an EX-ANTE classifier (gap_min works; gamma-open collecting; drift/implied FAILED OOS).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
