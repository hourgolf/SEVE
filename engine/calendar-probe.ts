// ============================================================================
//  calendar-probe — do CATALYST days (FOMC / NFP) genuinely differ for us, and
//  is FOMC the gap_min BLIND SPOT the design claims? (2026-06-11 ideation → probe.)
//
//  Premise (from the gap_min thread): the calendar's unique value over gap_min is
//  the INTRADAY scheduled event — a 2:00 PM FOMC detonates mid-session, invisible
//  to the overnight gap. Three tests:
//   A. VOL SIGNATURE — mean 1-min range in the 14:00–14:30 ET window (the 2:00 PM
//      announcement) on FOMC days vs non-FOMC, with an 11:00–11:30 CONTROL window.
//      If FOMC spikes at 2:00 but not 11:00, the signature is real + localized.
//      (Underlying bars only → full corpus, high n.)
//   B. GAP BY EVENT — median |gap| on FOMC vs NFP vs calm days. Expect NFP (8:30
//      pre-open) to gap MORE (gap_min owns it) and FOMC to gap like a calm day
//      (the 2pm event isn't an overnight gap) → confirms FOMC = the blind spot.
//   C. CHANNEL P&L — ALT/V3 (no gap_min) on FOMC vs non-FOMC, and trades HELD
//      THROUGH 2:00 vs not. Thin n (few FOMC days have option fills) → directional.
//
//  FOMC dates: VERIFIED vs the official Fed calendar (see engine/market-events.ts;
//  fetched 2026-06-11). NFP = first-Friday rule (~90% right) — diagnostic only.
//
//    npm run calendar-probe
// ============================================================================

import { simulateSession } from "./backtest";
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
const CFG: StrategistConfig = { slug: "cal", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

// FOMC decision dates — VERIFIED vs the official Fed calendar (engine/market-events.ts).
import { MARKET_EVENTS } from "./market-events";
const FOMC = new Set<string>(MARKET_EVENTS.filter((e) => e.kind === "fomc").map((e) => e.date));

const etMinOf = (ms: number): number => {
  const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getHours() * 60 + et.getMinutes();
};
// first Friday of the month (NFP, ~8:30 ET) from a YYYY-MM-DD (uses the date's own month).
const isFirstFriday = (date: string): boolean => {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 5 = Fri
  return dow === 5 && d <= 7;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const sgn = (v: number) => (v >= 0 ? "+" : "");

const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const evalOf = (entries: StrategySpec["entries"]) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET: "15:25" }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};

// mean 1-min range (% of close) over [a,b) ET minutes
const winRangePct = (s: RealSession, a: number, b: number): number | null => {
  const rs = s.bars.filter((x) => { const m = etMinOf(x.ts); return m >= a && m < b; }).map((x) => (x.high - x.low) / x.close * 100);
  return rs.length ? mean(rs) : null;
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const corpus = sessions.filter((s) => s.bars.length >= 300); // full RTH days
  const fomcDays = corpus.filter((s) => FOMC.has(s.dateET));
  const nfpDays = corpus.filter((s) => isFirstFriday(s.dateET));

  console.log(`\n  CALENDAR probe · ${corpus.length} SPY sessions · FOMC ${fomcDays.length}d · NFP(1st-Fri) ${nfpDays.length}d`);
  console.log(`  FOMC dates VERIFIED vs the official Fed calendar (engine/market-events.ts, fetched 2026-06-11).\n`);

  // ---- A. intraday vol signature: 14:00–14:30 (2pm FOMC) vs 11:00–11:30 control ----
  const EVT = [840, 870], CTRL = [660, 690];
  const r = (set: RealSession[], w: number[]) => mean(set.map((s) => winRangePct(s, w[0], w[1])).filter((x): x is number => x != null));
  const nonF = corpus.filter((s) => !FOMC.has(s.dateET));
  console.log(`  ══ A. INTRADAY VOL SIGNATURE — mean 1-min range (% of px) ══`);
  console.log(`                       14:00–14:30 (2pm)   11:00–11:30 (control)   ratio 2pm÷ctrl`);
  for (const [lbl, set] of [["FOMC days", fomcDays], ["non-FOMC days", nonF]] as Array<[string, RealSession[]]>) {
    const e = r(set, EVT), c = r(set, CTRL);
    console.log(`  ${lbl.padEnd(20)} ${e.toFixed(3).padStart(13)}%   ${c.toFixed(3).padStart(16)}%   ${(e / c).toFixed(2).padStart(11)}×`);
  }

  // ---- B. gap by event type (the blind-spot check) ----
  const gapsOf = (set: RealSession[]) => set.map((s) => s.gap).filter((g): g is number => g != null).map(Math.abs);
  const calm = corpus.filter((s) => !FOMC.has(s.dateET) && !isFirstFriday(s.dateET));
  console.log(`\n  ══ B. |GAP| BY EVENT (median) — does the OPEN know? ══`);
  console.log(`  FOMC (2pm event)   ${median(gapsOf(fomcDays)).toFixed(3)}%   · expect ≈ calm (overnight gap unrelated to the 2pm event)`);
  console.log(`  NFP  (8:30 event)  ${median(gapsOf(nfpDays)).toFixed(3)}%   · expect > calm (pre-open → gaps → gap_min already owns it)`);
  console.log(`  calm days          ${median(gapsOf(calm)).toFixed(3)}%`);

  // ---- C. channel P&L on FOMC days + held-through-2pm (thin n) ----
  const byDay = loadDatabentoByDay(corpus.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = corpus.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  interface TT { pnl: number; fomc: boolean; held2pm: boolean }
  const tag = (entries: StrategySpec["entries"]): TT[] => {
    const mk = evalOf(entries); const out: TT[] = [];
    for (const s of real) for (const t of simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE))
      out.push({ pnl: t.pnl, fomc: FOMC.has(s.dateET), held2pm: etMinOf(t.entryTs) < 840 && etMinOf(t.exitTs) > 840 });
    return out;
  };
  const cell = (set: TT[]) => set.length ? `${sgn(mean(set.map((x) => x.pnl)))}${mean(set.map((x) => x.pnl)).toFixed(0)}/t (${set.length})` : "—";
  console.log(`\n  ══ C. ALT+V3 (no gap_min) on FOMC days · real NBBO · THIN n, directional ══`);
  const tt = [...tag(ALT), ...tag(V3)];
  console.log(`  non-FOMC days        ${cell(tt.filter((x) => !x.fomc))}`);
  console.log(`  FOMC days (all)      ${cell(tt.filter((x) => x.fomc))}`);
  console.log(`  FOMC · held thru 2pm ${cell(tt.filter((x) => x.fomc && x.held2pm))}   (the flatten-before-2pm test)`);
  console.log(`  FOMC · not held 2pm  ${cell(tt.filter((x) => x.fomc && !x.held2pm))}`);
  console.log(`\n  READ: A shows a 2pm spike on FOMC (signature real) → B shows FOMC gaps like calm (gap_min blind to it)`);
  console.log(`  → C's held-thru-2pm worse than not = a flatten-before-2pm edge. All three ⇒ FOMC awareness is worth a build.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
