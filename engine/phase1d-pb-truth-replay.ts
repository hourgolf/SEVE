// Phase 1D canonical channel replay: pb-ride under the CURRENT desk contract.
// This deliberately differs from the historical probes in four material ways:
// current risk/stop/target/stall settings, executable-bid exit observations,
// the live gate-vs-fill cost split, and the FOMC stand-down policy.

import { simulateSession } from "./backtest";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { inEventWindow } from "./market-events";
import { loadRealSessions, type RealSession } from "./realsource";
import { getStrategy } from "./registry";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const POLICY_AS_OF = "2026-07-10";
const RISK_USD = 1_250;
const PREMIUM_STOP_PCT = 30;
const STOP_FRACTION = PREMIUM_STOP_PCT / 100;
const FUND: FundState = {
  // riskGovernor budgets premium, while live sizes stop-aware. This mapping makes
  // floor(total/ask/100) == floor(RISK/(stopFraction*ask*100)).
  total_capital_usd: RISK_USD / STOP_FRACTION,
  master_daily_stop_usd: 1e9,
  is_halted: false,
};
const CFG: StrategistConfig = {
  slug: "pb-ride",
  capital_pct: 100,
  aggression: 100,
  max_contracts: 10,
  daily_stop_usd: 3_000,
  muted: false,
  soloed: false,
};
const FILL_AUDITED: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const FILL_OPTIMISTIC: CostModel = { ...FILL_AUDITED, slippageTicksPerSide: 0.25 };
const GATE_LIVE: CostModel = FILL_OPTIMISTIC;
const ENTRY_GATE = { minMoveToCostRatio: 3, gateCostModel: GATE_LIVE };

const WINDOWS = [
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "TREND-OOS 25", from: "2025-05-01", to: "2025-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
];

interface Variant {
  name: string;
  premiumExit: { profitPct?: number; stopPct: number };
  stall?: { minMinutes: number; maxFavorPct: number };
}
const VARIANTS: Variant[] = [
  { name: "CURRENT TP10", premiumExit: { profitPct: 10, stopPct: 30 }, stall: { minMinutes: 120, maxFavorPct: 25 } },
  { name: "RIDE", premiumExit: { stopPct: 30 } },
  { name: "TP20", premiumExit: { profitPct: 20, stopPct: 30 }, stall: { minMinutes: 120, maxFavorPct: 25 } },
  { name: "TP30", premiumExit: { profitPct: 30, stopPct: 30 }, stall: { minMinutes: 120, maxFavorPct: 25 } },
];

const etOpenMin = 9 * 60 + 30;
function withEventStanddown(dateET: string, inner: Evaluate): Evaluate {
  return (f, pos) => {
    if (inEventWindow(dateET, etOpenMin + f.minute, 10, 30, "SPY")) {
      return pos ? { kind: "exit", reason: "event_standdown" } : null;
    }
    return inner(f, pos);
  };
}

function positionKey(t: Trade): string {
  return `${t.entryTs}|${t.strike}|${t.optType}`;
}

function summarize(dayRows: Array<{ date: string; trades: Trade[] }>) {
  const all = dayRows.flatMap((d) => d.trades);
  const positions = new Map<string, number>();
  for (const t of all) positions.set(positionKey(t), (positions.get(positionKey(t)) ?? 0) + t.pnl);
  const positionPnls = [...positions.values()];
  const dayPnls = dayRows.map((d) => d.trades.reduce((sum, t) => sum + t.pnl, 0));
  const total = dayPnls.reduce((a, b) => a + b, 0);
  let equity = 0, peak = 0, maxDD = 0;
  for (const pnl of dayPnls) { equity += pnl; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity); }
  const positiveDays = dayPnls.filter((p) => p > 0).sort((a, b) => b - a);
  const grossPositive = positiveDays.reduce((a, b) => a + b, 0);
  const top3Share = grossPositive > 0 ? positiveDays.slice(0, 3).reduce((a, b) => a + b, 0) / grossPositive : 0;
  return {
    total,
    positions: positionPnls.length,
    winPct: positionPnls.length ? 100 * positionPnls.filter((p) => p > 0).length / positionPnls.length : 0,
    expectancy: positionPnls.length ? total / positionPnls.length : 0,
    activeDays: dayRows.filter((d) => d.trades.length).length,
    maxDD,
    top3Share,
  };
}

function signed(v: number): string { return `${v >= 0 ? "+" : "-"}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`; }

async function main(): Promise<void> {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const mdte = loadMultiDteByDay(dates);
  const real = sessions.filter((s) => {
    const contracts = mdte.get(s.dateET);
    const expiry = nextOf.get(s.dateET);
    return !!contracts && !!expiry && s.bars.length >= 90
      && contracts.some((c) => c.expiration === expiry)
      && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  if (!real.length) throw new Error("No overlapping SPY bars + next-session Databento NBBO corpus");
  const def = getStrategy("pb-ride");
  if (!def) throw new Error("pb-ride missing from strategy registry");
  const chainFor = (s: RealSession): ChainProvider => {
    const all = makeMultiDteChain(mdte.get(s.dateET)!);
    const expiry = nextOf.get(s.dateET)!;
    return (_spot, _minutesToClose, ts) => all(ts).filter((q) => q.expiration === expiry);
  };

  const run = (variant: Variant, fill: CostModel, maxEntriesPerDay: number) => real.map((s) => {
    const core = def.build(s.bars, def.timeframeMin);
    const evaluate = withEventStanddown(s.dateET, core);
    const trades = simulateSession(
      s.bars, CFG, FUND, evaluate, chainFor(s), false, variant.premiumExit, fill,
      undefined, undefined, undefined, undefined, 0.35, ENTRY_GATE,
      undefined, undefined, undefined, variant.stall, undefined, 0,
      maxEntriesPerDay, "bid",
    );
    return { date: s.dateET, trades };
  });

  console.log(`\nPHASE 1D · PB-RIDE MARKET-TRUTH REPLAY`);
  console.log(`policy snapshot ${POLICY_AS_OF} · SPY 1DTE · ${real.length} sessions · ${real[0].dateET} → ${real[real.length - 1].dateET}`);
  console.log(`real underlying bars + Databento 1-minute OCC NBBO · entry ask / exit bid+slippage · BID triggers`);
  console.log(`RISK $${RISK_USD} · max 10 · daily stop $3,000 · premium stop 30% · u-stop 0.35% · live 0.25-tick gate`);
  console.log(`FOMC stand-down 13:50–14:30 ET · results are research, not promotion authority\n`);

  for (const entryCap of [0, 1]) {
    console.log(entryCap === 0 ? "LIVE RE-ENTRY BEHAVIOR" : "ONE ENTRY/DAY (management isolated)");
    console.log("variant".padEnd(15) + "audited fill".padStart(15) + "optimistic".padStart(14) + "positions".padStart(11) + "win%".padStart(8) + "exp/pos".padStart(11) + "maxDD".padStart(11) + "top3+".padStart(9));
    for (const variant of VARIANTS) {
      const auditedRows = run(variant, FILL_AUDITED, entryCap);
      const optimisticRows = run(variant, FILL_OPTIMISTIC, entryCap);
      const a = summarize(auditedRows), o = summarize(optimisticRows);
      console.log(
        variant.name.padEnd(15) + signed(a.total).padStart(15) + signed(o.total).padStart(14)
        + String(a.positions).padStart(11) + a.winPct.toFixed(1).padStart(8)
        + signed(a.expectancy).padStart(11) + signed(a.maxDD).padStart(11)
        + `${Math.round(a.top3Share * 100)}%`.padStart(9),
      );
      if (entryCap === 0 && variant.name === "CURRENT TP10") {
        const windowCells = WINDOWS.map((w) => {
          const rows = auditedRows.filter((d) => d.date >= w.from && d.date <= w.to);
          return `${w.name}: ${signed(summarize(rows).total)}`;
        });
        console.log(`  current by window: ${windowCells.join(" · ")}`);
      }
    }
    console.log("");
  }
  console.log("Interpretation guard: a positive pooled total is insufficient. Demand cost-bracket survival, window breadth, controlled concentration, and forward paper confirmation before changing the live channel.\n");
}

main().catch((error) => { console.error(error); process.exit(1); });
