// ============================================================================
//  scalp-twin-probe — can the operator's manual exit policy be COMPILED?
//
//  The live man-vs-machine twins revealed the operator's policy on grind(base)
//  entries: exit within ~1-2 minutes at a small gain (median hold 1.0 min,
//  avg +4%/trade, 63% win, +$33/t over 57 live trades; post-exit drift shows
//  real 15-min timing skill but −$13k of 30-min tail cut). This codifies that
//  policy and runs it across the desk's full real-NBBO history under LIVE
//  conditions (cost gate 3.0 — the twins' entries are gated too; −50%
//  catastrophic stop; EOD backstop; entry at ask / exit at bid via Databento).
//
//    npm run scalp-twin-probe
//
//  READ: the operator nets +$33/t live. If a codified variant approaches that
//  pooled AND across windows → arm it as a machine channel and bank the wrist
//  as code. If every variant bleeds (the fill-probe prior: ~$7/t round-trip
//  spread eats mechanical scalps), the operator's edge is the DISCRETIONARY
//  RESIDUE — which signals he takes and the intra-minute moment he pulls the
//  trigger — i.e. the manual book is a legitimate channel that cannot be
//  compiled at minute granularity, not helicopter parenting.
//
//  Exit-policy variants (entries identical = grind base, DEFAULT_GRIND_PARAMS):
//    native      grind's own exits (the cost-doomed baseline, for reference)
//    H1/H2/H3    pure time-scalp: exit N bars after entry, no target
//    T4·H2 …     premium target +X% OR time-stop at H bars, first to fire
//  All non-native variants drop the strategy's own exits (manual-twin
//  semantics: the policy owns the exit) and keep stop −50% + EOD ≤3min.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "scalp", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

interface Variant { name: string; native: boolean; maxHoldBars?: number; targetPct?: number }
const VARIANTS: Variant[] = [
  { name: "native (grind's own)", native: true },
  { name: "H1  (next-bar out)  ", native: false, maxHoldBars: 1 },
  { name: "H2                  ", native: false, maxHoldBars: 2 },
  { name: "H3                  ", native: false, maxHoldBars: 3 },
  { name: "T+4% · H2           ", native: false, maxHoldBars: 2, targetPct: 4 },
  { name: "T+6% · H3           ", native: false, maxHoldBars: 3, targetPct: 6 },
  { name: "T+8% · H3           ", native: false, maxHoldBars: 3, targetPct: 8 },
  { name: "T+12% · H5          ", native: false, maxHoldBars: 5, targetPct: 12 },
];

// Manual-twin semantics: entries from the base strategy; ITS exit intents are
// dropped — the codified policy (time-stop here; target/stop engine-side via
// premiumExit) owns the exit, with an EOD backstop. Hold is tracked off
// minutesToClose (1 bar = 1 minute), no bar-index assumptions.
function scalpEvaluate(maxHoldBars: number): (s: RealSession) => Evaluate {
  return () => {
    let entryMtc: number | null = null;
    return (f, pos) => {
      if (!pos) {
        entryMtc = null;
        const intent = grindEvaluate(f, null, DEFAULT_GRIND_PARAMS);
        return intent?.kind === "enter" ? intent : null;
      }
      if (entryMtc == null) entryMtc = f.minutesToClose + 1; // pos appeared → entry was last bar
      if (f.minutesToClose <= 3) return { kind: "exit", reason: "eod_backstop" };
      if (entryMtc - f.minutesToClose >= maxHoldBars) return { kind: "exit", reason: "scalp_time" };
      return null;
    };
  };
}
const nativeEvaluate = (): Evaluate => (f, pos) => grindEvaluate(f, pos, DEFAULT_GRIND_PARAMS);

const run = (v: Variant, set: RealSession[], chainOf: (s: RealSession) => ChainProvider): Trade[] =>
  set.flatMap((s) => simulateSession(
    s.bars, CFG, FUND,
    v.native ? nativeEvaluate() : scalpEvaluate(v.maxHoldBars!)(s),
    chainOf(s), false,
    { profitPct: v.targetPct, stopPct: 50 },
    NBBO, undefined, undefined, undefined, undefined, 0, GATE,
  ));

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 800 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider =>
    makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  console.log(`\n  SCALP-TWIN probe — the operator's exit policy, codified · grind(base) entries`);
  console.log(`  live conditions: cost gate 3.0 · stop −50% · real NBBO (ask in / bid out) · ${real.length} sessions`);
  console.log(`  LIVE BENCHMARK (the human): +$33/t · 63% win · median hold 1.0m · 57 trades\n`);

  console.log("  variant                  exp$/t   win%      n     total$");
  const cells: Array<{ v: Variant; tr: Trade[] }> = [];
  for (const v of VARIANTS) {
    const tr = run(v, real, chainOf);
    cells.push({ v, tr });
    const m = metrics(tr, real.length);
    const exp = tr.length ? m.totalPnl / tr.length : 0;
    console.log(`  ${v.name}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)}  ${(m.winRate * 100).toFixed(0).padStart(4)}%  ${String(tr.length).padStart(5)}  ${`${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`.padStart(9)}`);
  }

  console.log("\n  per-window total$");
  console.log("  " + "".padEnd(24) + WINDOWS.map((w) => w.name.slice(0, 13).padStart(15)).join(""));
  for (const v of VARIANTS) {
    const tots = WINDOWS.map((w) => {
      const win = real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      const m = metrics(run(v, win, chainOf), win.length);
      return `${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`;
    });
    console.log("  " + v.name.padEnd(24) + tots.map((t) => t.padStart(15)).join(""));
  }
  console.log(`\n  READ: a variant must approach the human's +$33/t pooled AND not bleed across windows`);
  console.log(`  to justify arming. Spread math: entry@ask→exit@bid needs ~+spread% of mid move just`);
  console.log(`  to break even — the human beats it by picking the intra-minute moment; the minute`);
  console.log(`  grid can't. If all variants bleed, the manual book IS the strategy (uncompilable).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
