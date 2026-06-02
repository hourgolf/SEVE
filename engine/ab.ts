// ============================================================================
//  A/B comparator (Brief PR6) — runs a base channel and its `*-smart` variant
//  over the SAME real sessions + same modeled chains + same cost model, and
//  prints a side-by-side R-unit scorecard with a delta row. Deterministic.
//
//    npm run ab -- --pair breakout:breakout-smart [--days N]
//    npm run ab -- --all
//    npm run ab -- --pair grind:grind-smart --mgmt-only   # base entry + smart mgmt
//
//  R is each fill's defined risk (premium-stop for smart; 50%-premium proxy for
//  the base). All P&L post-cost. On modeled chains the absolute numbers aren't a
//  go/no-go — the RELATIVE (smart−base) delta is the signal.
// ============================================================================

import { simulateSession } from "./backtest";
import { STRATEGY_REGISTRY } from "./registry";
import { SMART_SPECS, MULTILEG_SPECS, basePairOf } from "./smart-specs";
import { specToStrategyDef, specPremiumExit } from "./specEvaluate";
import { loadRealSessions } from "./realsource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { Management } from "../lib/desk/strategySpec";

const CFG: StrategistConfig = { slug: "ab", capital_pct: 30, aggression: 40, max_contracts: 6, daily_stop_usd: 90, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };
// Databento gives REAL bid/ask → cross the ACTUAL spread, not the 3% model.
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

interface ABMetrics {
  positions: number; winRate: number; expectancyR: number; profitFactor: number;
  avgWinR: number; avgLossR: number; maxDrawdownR: number; tailCapture: number;
  costDrag: number | null; totalPnl: number;
}

// Group tranches into positions (all tranches of one position share entryTs),
// then compute R-unit metrics over positions.
function abMetrics(trades: Trade[]): ABMetrics {
  const byPos = new Map<string, { pnl: number; risk: number; cost: number }>();
  for (const t of trades) {
    const k = String(t.entryTs);
    const g = byPos.get(k) ?? { pnl: 0, risk: 0, cost: 0 };
    g.pnl += t.pnl; g.risk += t.riskUsd ?? 0; g.cost += t.cost ?? 0;
    byPos.set(k, g);
  }
  const pos = [...byPos.values()];
  const n = pos.length;
  const Rof = (p: { pnl: number; risk: number }) => (p.risk > 0 ? p.pnl / p.risk : 0);
  const Rs = pos.map(Rof);
  const wins = pos.filter((p) => p.pnl > 0);
  const losses = pos.filter((p) => p.pnl <= 0);
  const totalPnl = pos.reduce((a, p) => a + p.pnl, 0);
  const grossWin = wins.reduce((a, p) => a + p.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, p) => a + p.pnl, 0));
  const totalCost = pos.reduce((a, p) => a + p.cost, 0);
  // R equity curve → max drawdown in R
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of Rs) { eq += r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); }
  // tail capture: top-decile positions by pnl → share of total pnl
  const sorted = [...pos].sort((a, b) => b.pnl - a.pnl);
  const topN = Math.max(1, Math.round(n * 0.1));
  const tailPnl = sorted.slice(0, topN).reduce((a, p) => a + p.pnl, 0);
  const grossPnlPreCost = totalPnl + totalCost;
  return {
    positions: n,
    winRate: n ? wins.length / n : 0,
    expectancyR: n ? Rs.reduce((a, r) => a + r, 0) / n : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWinR: wins.length ? wins.map(Rof).reduce((a, r) => a + r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.map(Rof).reduce((a, r) => a + r, 0) / losses.length : 0,
    maxDrawdownR: maxDD,
    tailCapture: totalPnl !== 0 ? tailPnl / totalPnl : 0,
    costDrag: Math.abs(grossPnlPreCost) > 1e-6 ? totalCost / grossPnlPreCost : null,
    totalPnl,
  };
}

type Sessions = Awaited<ReturnType<typeof loadRealSessions>>;

function runSide(sessions: Sessions, chainOf: (s: Sessions[number]) => ChainProvider, evalFor: (bars: Bar[]) => Evaluate, management: Management | undefined, costModel: CostModel, premiumExit?: { profitPct?: number; stopPct?: number }): Trade[] {
  const all: Trade[] = [];
  for (const s of sessions) {
    all.push(...simulateSession(s.bars, CFG, FUND, evalFor(s.bars), chainOf(s), false, premiumExit, costModel, management));
  }
  return all;
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const f2 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
const pf = (v: number) => (v === Infinity ? "∞" : v.toFixed(2));

function printPair(base: string, smart: string, b: ABMetrics, s: ABMetrics, mgmtOnly: boolean) {
  const row = (label: string, bv: string, sv: string, dv: string) =>
    console.log(`  ${label.padEnd(15)} ${bv.padStart(11)} ${sv.padStart(11)}   ${dv.padStart(9)}`);
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  A/B · ${base}  vs  ${smart}${mgmtOnly ? "  (--mgmt-only)" : ""}`);
  console.log(`══════════════════════════════════════════════════════════`);
  row("metric", base, smart, "Δ");
  console.log("  " + "─".repeat(50));
  row("positions", String(b.positions), String(s.positions), "");
  row("winRate", (b.winRate * 100).toFixed(1) + "%", (s.winRate * 100).toFixed(1) + "%", f2((s.winRate - b.winRate) * 100));
  row("expectancyR", f2(b.expectancyR), f2(s.expectancyR), f2(s.expectancyR - b.expectancyR));
  row("profitFactor", pf(b.profitFactor), pf(s.profitFactor), "");
  row("avgWinR", f2(b.avgWinR), f2(s.avgWinR), "");
  row("avgLossR", f2(b.avgLossR), f2(s.avgLossR), "");
  row("maxDrawdownR", b.maxDrawdownR.toFixed(1), s.maxDrawdownR.toFixed(1), f2(s.maxDrawdownR - b.maxDrawdownR));
  row("tailCapture", (b.tailCapture * 100).toFixed(0) + "%", (s.tailCapture * 100).toFixed(0) + "%", "");
  row("costDrag", b.costDrag != null ? (b.costDrag * 100).toFixed(0) + "%" : "n/a", s.costDrag != null ? (s.costDrag * 100).toFixed(0) + "%" : "n/a", "");
  row("totalPnl", usd(b.totalPnl), usd(s.totalPnl), usd(s.totalPnl - b.totalPnl));
  console.log("══════════════════════════════════════════════════════════");
}

async function main() {
  const argv = process.argv;
  const mgmtOnly = argv.includes("--mgmt-only");
  const di = argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && argv[di + 1] ? Number(argv[di + 1]) : undefined;
  const pi = argv.indexOf("--pair");
  const pairArg = pi >= 0 ? argv[pi + 1] : null;

  const pairs: [string, string][] = argv.includes("--all")
    ? Object.keys(SMART_SPECS).map((sm) => [basePairOf(sm), sm] as [string, string])
    : pairArg
      ? [[pairArg.split(":")[0], pairArg.split(":")[1] || pairArg.split(":")[0] + "-smart"]]
      : [["power", "power-smart"]];

  const oi = argv.indexOf("--options");
  const optMode = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "synthetic"; // synthetic | real | databento

  const sessions = await loadRealSessions(sinceDaysAgo != null ? { sinceDaysAgo } : undefined);
  if (!sessions.length) { console.log("\nNo real sessions — backfill underlying_bars first.\n"); return; }

  // Chain source (SAME both sides → fair A/B):
  //   databento → REAL NBBO from the local cbbo-1m cache + REAL spread (honest fills)
  //   real      → option_bars trade prices + modeled 3% spread
  //   else      → Black-Scholes modeled chains
  const dbento = optMode === "databento";
  const useRealOptions = optMode === "real";
  let byDay = new Map<string, unknown[]>();
  if (dbento) byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  else if (useRealOptions) {
    try { byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET)) as Map<string, unknown[]>; }
    catch (e) { console.log(`  (option_bars unavailable — ${(e as Error).message}; using modeled)`); }
  }
  const COST = dbento ? REAL_NBBO_COST : DEFAULT_COST_MODEL;
  const realDays = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0).length;
  const chainOf = (s: Sessions[number]): ChainProvider => {
    const contracts = byDay.get(s.dateET);
    if (dbento && contracts && contracts.length) return makeDatabentoChain(contracts as Parameters<typeof makeDatabentoChain>[0]);
    if (useRealOptions && contracts && contracts.length) return makeRealChain(contracts as Parameters<typeof makeRealChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };
  const chainLabel = dbento ? `REAL NBBO · Databento cbbo-1m (${realDays}/${sessions.length} days) + real spread`
    : useRealOptions ? `REAL option_bars (${realDays}/${sessions.length} days) + modeled spread`
    : "modeled (Black-Scholes) chains";
  console.log(`\n  ${sessions.length} sessions · ${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · ${chainLabel}, post-cost`);

  for (const [base, smart] of pairs) {
    const baseDef = STRATEGY_REGISTRY[base];
    const spec = SMART_SPECS[smart] ?? MULTILEG_SPECS[smart];
    if (!baseDef || !spec) { console.log(`  (skip ${base}:${smart} — base or smart not found)`); continue; }
    const baseEval = (bars: Bar[]) => baseDef.build(bars, baseDef.timeframeMin);
    const smartDef = specToStrategyDef(spec);
    // full: smart entry + smart mgmt.  --mgmt-only: BASE entry + smart mgmt.
    const smartEval = mgmtOnly ? baseEval : (bars: Bar[]) => smartDef.build(bars, smartDef.timeframeMin);
    // The smart/spec side honors its spec.exits (profit/stop) — needed for the
    // multi-leg specs (no management block); existing *-smart specs have empty
    // exits so this is a no-op for them (they exit via the management state machine).
    const smartPx = specPremiumExit(spec);
    const bm = abMetrics(runSide(sessions, chainOf, baseEval, undefined, COST));
    const sm = abMetrics(runSide(sessions, chainOf, smartEval, spec.management, COST, smartPx));
    printPair(base, smart, bm, sm, mgmtOnly);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
