// ============================================================================
//  power-probe — isolate which guards actually help POWER on REAL option fills.
//
//  Power is the only near-breakeven channel on real fills (base expectancyR ≈ −0.02,
//  avgWinR +2.69 — a real convex tail). The full smart layer HURT it (scale-outs cap
//  the tail). This probe asks the narrower question the live worker cares about:
//  with power's ENTRY held fixed, which EXIT guards help?
//
//    npm run power-probe                 # real fills (needs backfilled option_bars)
//
//  Configs (all single-leg ATM 0DTE, power's final-hour entry, post-cost):
//    base        — power as-is (own exits: 1.0-ATR adverse stop + flat @3m)
//    +premStop   — base exits + premium −50% catastrophic stop      (LIVE minus gate)
//    LIVE        — base exits + premium −50% + cost gate (3.0)       (worker 2026-06-01d)
//    ride-tail   — premium −50% + flat@3m ONLY, NO ATR stop         (let it breathe)
//    ride+gate   — ride-tail + cost gate
//
//  A structuralStop:{atr_adverse,1.0} in the management block reproduces power's own
//  ATR stop exactly (manage.ts uses the same entryUnderlying−atr·ATR level), so the
//  management path faithfully models the live worker (base evaluator exits are owned
//  by the state machine here, but the levels are identical).
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { powerEvaluate, DEFAULT_POWER_PARAMS } from "./strategies/power";
import { loadRealSessions } from "./realsource";
import { loadOptionBarsByDay, makeRealChain, type ChainProvider } from "./optionsource";
import { loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { Management } from "../lib/desk/strategySpec";

const CFG: StrategistConfig = { slug: "power", capital_pct: 30, aggression: 40, max_contracts: 6, daily_stop_usd: 90, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 10000, master_daily_stop_usd: 300, is_halted: false };

const powerEval: Evaluate = (f, pos) => powerEvaluate(f, pos, DEFAULT_POWER_PARAMS);
const REAL_NBBO_COST: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

// Minimal management blocks — NO scale-outs / trail / breakeven (the A/B says those
// cap the tail). structuralStop:atr_adverse 1.0 == power's own stop; eodFlatten 3 ==
// power's flattenBeforeClose.
const M_PREMSTOP: Management = { risk: { defineR: "premium_stop", premiumStopPct: 50, structuralStop: { kind: "atr_adverse", atr: 1.0 } }, eodFlattenMinToClose: 3 };
const M_LIVE: Management = { ...M_PREMSTOP, costGate: { minMoveToCostRatio: 3.0 } };
const M_RIDE: Management = { risk: { defineR: "premium_stop", premiumStopPct: 50 }, eodFlattenMinToClose: 3 };
const M_RIDE_GATE: Management = { ...M_RIDE, costGate: { minMoveToCostRatio: 3.0 } };

// ── TAKE-PROFIT variants (the user's ask: lock big gains WITHOUT capping the
// convex tail). R = 50% of premium, so atR=3 ≈ +150% premium, atR=4 ≈ +200%.
// A scaleOut whose fraction rounds to ~0 contracts still fires its `then` action,
// so we can ENGAGE a protection (breakeven / giveback trail) after a big gain
// WITHOUT closing anything early. All on top of the LIVE base (M_PREMSTOP).
const M_TP150: Management = { ...M_PREMSTOP, scaleOut: [{ atR: 3, fraction: 1.0 }] };                 // full close at +150% premium
const M_TP200: Management = { ...M_PREMSTOP, scaleOut: [{ atR: 4, fraction: 1.0 }] };                 // full close at +200% premium
const M_BE100: Management = { ...M_PREMSTOP, scaleOut: [{ atR: 2, fraction: 0.01, then: "move_stop_breakeven" }] }; // after +100%, never give back to a loss
const M_TRAIL100_50: Management = { ...M_PREMSTOP, scaleOut: [{ atR: 2, fraction: 0.01, then: "engage_trail" }], trail: { mode: "premium_giveback", premiumGivebackPct: 50 } }; // after +100%, give back ≤50% of peak
const M_TRAIL100_40: Management = { ...M_PREMSTOP, scaleOut: [{ atR: 2, fraction: 0.01, then: "engage_trail" }], trail: { mode: "premium_giveback", premiumGivebackPct: 40 } };

type Sessions = Awaited<ReturnType<typeof loadRealSessions>>;

function runSide(sessions: Sessions, chainOf: (s: Sessions[number]) => ChainProvider, mgmt: Management | undefined, costModel: CostModel): Trade[] {
  const all: Trade[] = [];
  for (const s of sessions) all.push(...simulateSession(s.bars, CFG, FUND, powerEval, chainOf(s), false, undefined, costModel, mgmt));
  return all;
}

const usd = (v: number) => (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(0);
const f2 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 95;
  const sessions = await loadRealSessions({ sinceDaysAgo });
  if (!sessions.length) { console.log("\nNo real sessions — backfill underlying_bars first.\n"); return; }

  const oi = process.argv.indexOf("--options");
  const optMode = oi >= 0 && process.argv[oi + 1] ? process.argv[oi + 1] : "databento"; // databento (real NBBO) | real | modeled
  const dbento = optMode === "databento", useReal = optMode === "real";
  let byDay = new Map<string, unknown[]>();
  if (dbento) byDay = loadDatabentoByDay(sessions.map((s) => s.dateET)) as unknown as Map<string, unknown[]>;
  else if (useReal) { try { byDay = await loadOptionBarsByDay(sessions.map((s) => s.dateET)) as Map<string, unknown[]>; } catch (e) { console.log(`  (option_bars unavailable — ${(e as Error).message}; using modeled)`); } }
  const COST = dbento ? REAL_NBBO_COST : DEFAULT_COST_MODEL;
  const realDays = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0).length;
  const chainOf = (s: Sessions[number]): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (dbento && c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    if (useReal && c && c.length) return makeRealChain(c as Parameters<typeof makeRealChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };
  const srcLabel = dbento ? `REAL NBBO · Databento (${realDays}/${sessions.length} days) + real spread` : useReal ? `REAL option_bars (${realDays}/${sessions.length} days) + modeled spread` : "modeled chains";

  const configs: [string, Management | undefined][] = [
    ["base", undefined],
    ["+premStop(LIVE-)", M_PREMSTOP],
    ["+TP@150%", M_TP150],
    ["+TP@200%", M_TP200],
    ["+BE@100%", M_BE100],
    ["+trail@100/50", M_TRAIL100_50],
    ["+trail@100/40", M_TRAIL100_40],
  ];

  console.log(`\n  POWER probe · ${sessions.length} sessions · ${sessions[0].dateET} → ${sessions[sessions.length - 1].dateET} · ${srcLabel}, post-cost\n`);
  const head = ["config", "trades", "win%", "avgWin", "avgLoss", "exp$/t", "totalPnl", "maxDD"];
  console.log("  " + head[0].padEnd(16) + head[1].padStart(7) + head[2].padStart(7) + head[3].padStart(8) + head[4].padStart(8) + head[5].padStart(8) + head[6].padStart(10) + head[7].padStart(8));
  console.log("  " + "─".repeat(72));
  for (const [label, mgmt] of configs) {
    const m = metrics(runSide(sessions, chainOf, mgmt, COST), sessions.length);
    console.log("  " + label.padEnd(16) + String(m.nTrades).padStart(7) + (m.winRate * 100).toFixed(1).padStart(7) + usd(m.avgWin).padStart(8) + usd(m.avgLoss).padStart(8) + usd(m.expectancy).padStart(8) + usd(m.totalPnl).padStart(10) + usd(m.maxDrawdown).padStart(8));
    console.log("    exits: " + JSON.stringify(m.byReason));
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
