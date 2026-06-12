// ============================================================================
//  cross-gap-probe — the ma_cross × gap COMPOSE (generative inventory, 2026-06-12).
//
//  The engine's OLDEST settled finding: the 15-minute EMA(12/26) crossover is a
//  regime-dependent momentum edge — profitable in trending stretches, lossy in
//  chop, and NO entry filter ever rescued the chop quarters (efficiency-ratio,
//  daily-trend — all failed). The desk's NEWEST validated gate: gap_min — the
//  overnight gap is the one ex-ante trend/chop signal that survived the 5-window
//  bar (armed on V3/ALT). The compose: only run the crossover on gap days.
//
//  PRE-REGISTERED (mirage discipline):
//   - Grid fixed up front: |gap| ≥ {0 (baseline), 0.15, 0.25, 0.35}%.
//   - PASS bar (same as gap-gate): the gate must LIFT pooled exp$/t AND be
//     helped/neutral in ≥4/5 windows AND not be CHOP-MIX-carried (fingerprint #1:
//     that window prints for every momentum shape).
//   - Live-faithful costs: real NBBO, −50% premium stop backstop, cost gate 3.0,
//     ustop 0. The crossover's OWN exits (opposite cross / 1.5-ATR / 45m time
//     stop / 35m flatten) ride via its evaluator — the locked DEFAULT_CROSS_PARAMS,
//     tfMin=15 passed EXPLICITLY (the CLI's makeCrossover(closes) defaults tfMin=1,
//     which mis-scales the time-stop on 15m bars — don't inherit that).
//   - NO-LOOK-AHEAD ts: aggregate() stamps buckets at their START minute; quotes
//     priced there would predate the decision info by ~15 min. Each 15m bar's ts
//     is REMAPPED to its bucket's LAST 1-min bar ts (decision time = fill time).
//   - ⚠ ARMING IS BLOCKED EITHER WAY: the live worker is tf=1 only
//     (`tf_unsupported_v1`) and the 1m crossover was refuted long ago. This probe
//     produces a RESEARCH verdict that decides whether tf>1 worker support is
//     worth building — not an armable config.
//
//    npm run cross-gap-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { aggregate } from "./aggregate";
import { makeCrossover, DEFAULT_CROSS_PARAMS } from "./strategies/crossover";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, FundState, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "xgap", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const THRESH = [0, 0.15, 0.25, 0.35];
const sgn = (v: number) => (v >= 0 ? "+" : "");

// 15m bars with each bucket's ts remapped to its LAST 1-min bar ts (no look-ahead).
function bars15Of(bars1m: Bar[]): Bar[] {
  const out = aggregate(bars1m, 15);
  const size = 15 * 60_000;
  const lastTs = new Map<number, number>();
  for (const b of bars1m) lastTs.set(Math.floor(b.ts / size) * size, b.ts);
  return out.map((b) => ({ ...b, ts: lastTs.get(b.ts) ?? b.ts }));
}

interface TT { pnl: number; gap: number | null; window: string; exitReason?: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const corpus = sessions.filter((s) => s.bars.length >= 300);
  const inWindows = corpus.filter((s) => WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const byDay = loadDatabentoByDay(inWindows.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = inWindows.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  console.log(`\n  CROSS×GAP probe · 15m EMA(12/26) crossover (locked defaults, tfMin=15) · real NBBO · ${real.length} sessions across 5 windows`);
  console.log(`  gate: trade only when |overnight gap| ≥ thr · −50% prem stop · cost gate 3.0 · ustop 0 · no-look-ahead 15m ts\n`);

  const all: TT[] = [];
  let simErrors = 0;
  for (const s of real) {
    const w = WINDOWS.find((x) => s.dateET >= x.from && s.dateET <= x.to)!;
    const b15 = bars15Of(s.bars as Bar[]);
    // A full RTH session is 26 fifteen-minute bars (390/15) — the session-scoped
    // EMA(12/26) warms up inside it by design (the original locked-default shape).
    if (b15.length < 8) continue;
    const ev = makeCrossover(b15.map((b) => b.close), DEFAULT_CROSS_PARAMS, 15);
    let trades: Trade[] = [];
    try {
      trades = simulateSession(b15, CFG, FUND, ev, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
    } catch (e) {
      simErrors++;
      if (simErrors <= 3) console.log(`  ⚠ sim error ${s.dateET}: ${(e as Error).message}`);
      continue;
    }
    for (const t of trades) all.push({ pnl: t.pnl, gap: s.gap ?? null, window: w.name, exitReason: t.exitReason });
  }
  if (simErrors) console.log(`  ⚠ ${simErrors} session(s) skipped on sim errors\n`);

  const cell = (set: TT[]) => (set.length ? `${sgn(set.reduce((a, x) => a + x.pnl, 0))}${set.reduce((a, x) => a + x.pnl, 0).toFixed(0)}` : "—");
  const expt = (set: TT[]) => (set.length ? `${sgn(set.reduce((a, x) => a + x.pnl, 0) / set.length)}${(set.reduce((a, x) => a + x.pnl, 0) / set.length).toFixed(1)}·${set.length}` : "—");

  console.log(`  ══ A. 5-WINDOW GAUNTLET — total$ by gap floor (exp$/t·n beneath) ══`);
  console.log(`  window            ${THRESH.map((t) => (t === 0 ? "baseline" : `|gap|≥${t.toFixed(2)}`).padStart(13)).join("")}`);
  for (const w of WINDOWS) {
    const ws = all.filter((x) => x.window === w.name);
    console.log(`  ${w.name.padEnd(16)} ${THRESH.map((t) => cell(ws.filter((x) => t === 0 || (x.gap != null && Math.abs(x.gap) >= t))).padStart(13)).join("")}`);
    console.log(`  ${"".padEnd(16)} ${THRESH.map((t) => expt(ws.filter((x) => t === 0 || (x.gap != null && Math.abs(x.gap) >= t))).padStart(13)).join("")}`);
  }
  console.log(`  ${"POOLED".padEnd(16)} ${THRESH.map((t) => cell(all.filter((x) => t === 0 || (x.gap != null && Math.abs(x.gap) >= t))).padStart(13)).join("")}`);
  console.log(`  ${"".padEnd(16)} ${THRESH.map((t) => expt(all.filter((x) => t === 0 || (x.gap != null && Math.abs(x.gap) >= t))).padStart(13)).join("")}`);

  // ---- B. the complementary cut: what does the gate EXCLUDE? ----
  const flat = all.filter((x) => x.gap == null || Math.abs(x.gap) < 0.25);
  const gappy = all.filter((x) => x.gap != null && Math.abs(x.gap) >= 0.25);
  console.log(`\n  ══ B. WHAT THE 0.25 GATE SPLITS (the gap-regime read, on crossover trades) ══`);
  console.log(`  flat-open trades   ${expt(flat).padStart(12)}   (the bleed the gate removes — expect negative)`);
  console.log(`  gap-day trades     ${expt(gappy).padStart(12)}   (what the gate keeps — expect better)`);

  console.log(`\n  READ (pre-registered): PASS = pooled exp$/t up vs baseline AND ≥4/5 windows helped/neutral`);
  console.log(`  AND not CHOP-MIX-carried. PASS → the compose earns a paper-lab seat and tf>1 worker support`);
  console.log(`  gets a work item. FAIL → third refutation of "filter the crossover into health" — the 15m`);
  console.log(`  crossover stays a research exhibit, and gap_min's value stays where it's armed (V3/ALT).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
