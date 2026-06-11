// ============================================================================
//  orb-width-probe — is the fixed 30-min opening range the problem? (2026-06-11,
//  operator's observation.)
//
//  THE CRITIQUE: a fixed-TIME OR produces a variable-WIDTH range. The breakout
//  trigger is anchored to the OR EXTREME (close > openRangeHi + 0.5·ATR), so a
//  WIDE OR (a volatile morning, e.g. 06-11's 726↔731 ≈0.7% swing) places the entry
//  at the top of a move that's already largely spent → little runway left → small
//  reversals stop it out and the premium target is unreachable. Fixed time is
//  arbitrary; WIDTH is the hidden variable governing how much move is left.
//
//  Two tests, both on the live ORB ride (real-NBBO, −50% stop, cost gate, the
//  entry-window-probe model):
//   A. WINDOW-LENGTH sweep — opening_range minutes ∈ {15,30,45,60}. Is 30 special?
//   B. OR-WIDTH buckets (at the live 30-min window) — bucket each session's trades
//      by its 30-min OR width %. Reports exp$/t per bucket + "morning capture" =
//      OR-width ÷ full-day range (high = the morning ate the day = no runway left).
//
//  READ: the critique holds if exp$/t DEGRADES from narrow→wide OR and capture is
//  high in the wide bucket → a deployable `or_width_max` gate (we have or_width_MIN
//  0.25% but no ceiling). If a non-30 window dominates 30 across windows, the fixed
//  30 is genuinely suboptimal.
//
//    npm run orb-width-probe
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "orb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

// Live ORB entries (orb-trend-rider / orb-spy-trail spec) — `minutes` parameterized.
const orbEntries = (minutes: number): StrategySpec["entries"] => [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const mkSpec = (minutes: number): StrategySpec => ({
  meta: { name: `orb${minutes}`, regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: `orb${minutes}` } as StrategySpec["meta"],
  exits: [{ timeET: "15:30" }], entries: orbEntries(minutes), sizing: {},
});
const evalFor = (minutes: number) => { const def = specToStrategyDef(mkSpec(minutes)); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl }); };

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");
// OR (hi,lo) over the first `minutes` RTH bars (bars are oldest→newest, 1/min).
const orOf = (bars: Bar[], minutes: number) => {
  const slice = bars.slice(0, minutes);
  return { hi: Math.max(...slice.map((b) => b.high)), lo: Math.min(...slice.map((b) => b.low)), open: bars[0].open };
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const run = (mk: (s: RealSession) => Evaluate, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  console.log(`\n  ORB-WIDTH probe · live ORB ride (−50% stop · cost gate) · real NBBO · ${real.length} SPY sessions\n`);
  console.log(`  ══ A. WINDOW LENGTH ══`);
  console.log(`  The OR window is HARDCODED at 30 min in computeFeatures (engine.ts OPEN_RANGE_MIN); the spec's`);
  console.log(`  opening_range \`minutes\` is DECORATIVE — never plumbed through. So 15/30/45/60 are identical and a`);
  console.log(`  real window sweep needs an engine change (parameterize OPEN_RANGE_MIN through simulateSession).`);
  console.log(`  The productive lever is the WIDTH that the (any) window produces — tested below.`);

  // ---- B. OR-WIDTH buckets (live 30-min window) ----
  // tag each session's trades with its 30-min OR width % + morning-capture ratio,
  // then bucket by width tercile.
  const mk30 = evalFor(30);
  interface Tagged { t: Trade; width: number; capture: number }
  const tagged: Tagged[] = [];
  for (const s of real) {
    const { hi, lo, open } = orOf(s.bars, 30);
    const width = ((hi - lo) / open) * 100;
    const dayHi = Math.max(...s.bars.map((b) => b.high)), dayLo = Math.min(...s.bars.map((b) => b.low));
    const capture = (hi - lo) / Math.max(1e-9, dayHi - dayLo); // OR range ÷ full-day range
    for (const t of run(mk30, [s])) tagged.push({ t, width, capture });
  }
  tagged.sort((a, b) => a.width - b.width);
  const n = tagged.length, t1 = Math.floor(n / 3), t2 = Math.floor((2 * n) / 3);
  const buckets: Array<[string, Tagged[]]> = [
    [`narrow (≤${tagged[t1 - 1]?.width.toFixed(2)}%)`, tagged.slice(0, t1)],
    [`medium`, tagged.slice(t1, t2)],
    [`wide (≥${tagged[t2]?.width.toFixed(2)}%)`, tagged.slice(t2)],
  ];
  console.log(`\n  ══ B. OR-WIDTH buckets (30-min window, ${n} trades by width tercile) ══`);
  console.log(`  bucket               n   exp$/t   win%   avgWidth   capture(OR÷dayRange)   pooled$`);
  for (const [label, set] of buckets) {
    if (!set.length) continue;
    const pnl = set.reduce((a, x) => a + x.t.pnl, 0);
    const exp = pnl / set.length;
    const win = (100 * set.filter((x) => x.t.pnl > 0).length) / set.length;
    const avgW = set.reduce((a, x) => a + x.width, 0) / set.length;
    const cap = set.reduce((a, x) => a + x.capture, 0) / set.length;
    console.log(`  ${label.padEnd(20)} ${String(set.length).padStart(3)}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)}  ${win.toFixed(0).padStart(3)}%   ${avgW.toFixed(2).padStart(6)}%   ${(100 * cap).toFixed(0).padStart(16)}%   ${`${sgn(pnl)}${Math.round(pnl)}`.padStart(8)}`);
  }
  console.log(`\n  READ: critique holds if exp$/t falls narrow→wide AND wide-bucket capture is high (the morning ate the`);
  console.log(`  day's range → no runway past the break). Fix = an or_width_max ceiling, or a vol-defined (constant-width) OR.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
