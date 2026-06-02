// ============================================================================
//  mdte-probe — does holding the credit-spread fade/ORB at 1–2DTE (instead of
//  0DTE) give it edge on REAL NBBO? Runs the spec credit spreads through the
//  multi-session driver (engine/multidte.ts) at entryDte ∈ {0,1,2} and prints an
//  R-unit scorecard. Needs the multi-DTE cache:
//
//    npm run backfill:databento -- --dte 2 --window 16 --from 2026-03-01 --to 2026-06-01
//    npm run mdte-probe -- --days 95
// ============================================================================

import { simulateMultiDay, type MdteSession } from "./multidte";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { loadRealSessions } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { SMART_SPECS, MULTILEG_SPECS } from "./smart-specs";
import type { FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "mdte", capital_pct: 30, aggression: 40, max_contracts: 6, daily_stop_usd: 90, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

function rMetrics(trades: Trade[]) {
  const byPos = new Map<string, { pnl: number; risk: number }>();
  for (const t of trades) { const k = String(t.entryTs); const g = byPos.get(k) ?? { pnl: 0, risk: 0 }; g.pnl += t.pnl; g.risk += t.riskUsd ?? 0; byPos.set(k, g); }
  const pos = [...byPos.values()];
  const n = pos.length;
  const Rof = (p: { pnl: number; risk: number }) => (p.risk > 0 ? p.pnl / p.risk : 0);
  const Rs = pos.map(Rof);
  const wins = pos.filter((p) => p.pnl > 0), losses = pos.filter((p) => p.pnl <= 0);
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of Rs) { eq += r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); }
  return {
    n, winRate: n ? wins.length / n : 0,
    expR: n ? Rs.reduce((a, r) => a + r, 0) / n : 0,
    avgWinR: wins.length ? wins.map(Rof).reduce((a, r) => a + r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.map(Rof).reduce((a, r) => a + r, 0) / losses.length : 0,
    maxDD, totalPnl: pos.reduce((a, p) => a + p.pnl, 0),
  };
}

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 95;
  const sessions = await loadRealSessions({ sinceDaysAgo });
  const byDay = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const cached: MdteSession[] = sessions
    .filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0)
    .map((s) => ({ dateET: s.dateET, bars: s.bars, pdh: s.pdh, pdl: s.pdl }));
  if (!cached.length) { console.log("\n  No multi-DTE cache — run `npm run backfill:databento -- --dte 2 --window 16` first.\n"); return; }
  console.log(`\n  mdte-probe · ${cached.length} real-NBBO sessions (${cached[0].dateET} → ${cached[cached.length - 1].dateET}) · post-cost`);
  const expCount = (() => { const e = new Set<string>(); for (const c of byDay.get(cached[0].dateET) ?? []) e.add((c as { expiration: string }).expiration); return e.size; })();
  console.log(`  (day-1 file carries ${expCount} expiries — entryDte up to ${Math.max(0, expCount - 1)} resolvable)\n`);

  const f2 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
  const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
  console.log(`  spec                          dte    n   winRate   expR    avgWinR  avgLossR  maxDD     P&L`);
  console.log("  " + "─".repeat(84));

  const specs = ["orb-credit-anchored", "orb-credit", "fade-spread"];
  for (const key of specs) {
    const spec = SMART_SPECS[key] ?? MULTILEG_SPECS[key];
    if (!spec) { console.log(`  (skip ${key} — not found)`); continue; }
    const def = specToStrategyDef(spec);
    const px = specPremiumExit(spec);
    for (const dte of [0, 1, 2]) {
      const trades = simulateMultiDay(
        cached, CFG, FUND,
        (bars, levels) => def.build(bars as Parameters<typeof def.build>[0], 1, levels),
        (s) => makeMultiDteChain(byDay.get(s.dateET) as Parameters<typeof makeMultiDteChain>[0]),
        REAL_NBBO_COST, px, dte,
      );
      const m = rMetrics(trades);
      console.log(`  ${key.padEnd(28)}  ${dte}   ${String(m.n).padStart(3)}   ${(m.winRate * 100).toFixed(1).padStart(5)}%   ${f2(m.expR).padStart(6)}   ${f2(m.avgWinR).padStart(6)}   ${f2(m.avgLossR).padStart(7)}   ${m.maxDD.toFixed(1).padStart(4)}   ${usd(m.totalPnl).padStart(7)}`);
    }
    console.log("");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
