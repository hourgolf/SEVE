// ============================================================================
//  pb-selftest — golden check: the pb-ride REGISTRY builtin must reproduce the
//  ema-pullback-probe evaluator TRADE-FOR-TRADE on the 1DTE chain (the
//  gap-min-selftest pattern: the port that arms must equal the probe that won).
//
//    npm run pb-selftest
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { getStrategy } from "./registry";
import { makeEval as pbEval, precompute as pbPre } from "./ema-pullback-probe";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => {
    const c = mdte.get(s.dateET); const nx = nextOf.get(s.dateET);
    return !!c && !!nx && c.some((q) => q.expiration === nx) && s.bars.length >= 90;
  });
  const chain1 = (s: RealSession): ChainProvider => {
    const all = makeMultiDteChain(mdte.get(s.dateET)!);
    const nx = nextOf.get(s.dateET)!;
    return (_sp, _mtc, ts) => all(ts).filter((q) => q.expiration === nx);
  };
  const def = getStrategy("pb-ride")!;
  const run = (mk: (s: RealSession) => Evaluate): Trade[] =>
    real.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chain1(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  const probe = run((s) => pbEval(pbPre(s), false, false));
  const builtin = run((s) => def.build(s.bars, def.timeframeMin));

  const tot = (ts: Trade[]) => Math.round(ts.reduce((a, t) => a + t.pnl, 0));
  const sameCount = probe.length === builtin.length;
  let sameTrades = sameCount;
  if (sameCount) for (let i = 0; i < probe.length; i++) {
    if (probe[i].entryTs !== builtin[i].entryTs || Math.abs(probe[i].pnl - builtin[i].pnl) > 1e-6) { sameTrades = false; break; }
  }
  console.log(`\n  pb-selftest · ${real.length} sessions · 1DTE chain`);
  console.log(`  probe evaluator : ${probe.length} trades · $${tot(probe)}`);
  console.log(`  registry builtin: ${builtin.length} trades · $${tot(builtin)}`);
  console.log(`  ${sameTrades ? "PASS ✓ — builtin is trade-identical to the probe" : "FAIL ✗ — port drift, do NOT arm"}\n`);
  if (!sameTrades) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
