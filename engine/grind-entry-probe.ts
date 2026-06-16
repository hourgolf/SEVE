// ============================================================================
//  grind-entry-probe — does a TREND-ALIGNMENT filter fix grind's counter-trend
//  entries? grind/v2/v3 enter on a raw 3-bar momentum burst (mom >= momTrigger·ATR
//  -> call) gated only by relVol + er (efficiency ratio = CHOP filter) + the window.
//  er filters chop but NOT direction: a strong DOWNtrend has high er, so a 3-bar
//  bounce (mom curling up) PASSES and buys a CALL — the operator's "buying the bottom
//  of a downtrend as MACD curls up" falling-knife. Unlike the breakout family, grind
//  has NO vwap_side / trend-direction filter. This tests adding one, real NBBO, 5
//  windows. exp$/t is the scalp metric (high trade count).
//
//    npm run grind-entry-probe
//  PASS = a filter improves exp$/t (and ideally total) in EVERY window without
//  gutting trade count to noise. The vwap variant is a CONCEPT proof (the live worker's
//  vwap is the per-bar bug → degraded live; the ema variants are wireable as-is).
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { grindV2Evaluate, DEFAULT_GRIND_V3_PARAMS } from "./strategies/grind-v2";
import { ema } from "../lib/indicators";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const RISK = 350; // grind-v3's live RISK knob
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "ge", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 }; // grind-v3 is cost-gated live

const WINDOWS = [
  { key: "2024-trend", from: "2024-05-01", to: "2024-08-31" },
  { key: "2025-trend", from: "2025-05-01", to: "2025-08-31" },
  { key: "late-2025", from: "2025-11-01", to: "2025-12-31" },
  { key: "CHOP-Mar26", from: "2026-03-01", to: "2026-03-31" },
  { key: "AprJun26", from: "2026-04-01", to: "2026-06-30" },
];

const FILTERS = ["none (baseline)", "vwap-align", "counter-vwap(knives)", "ema21-align"] as const;
type Filter = typeof FILTERS[number];

// Wrap grind-v3: pass exits/holds through; on an ENTER, require the direction to align
// with the trend reference (close above the ref for calls, below for puts) — i.e. don't
// fade the prevailing trend with a counter-trend bounce.
function makeEval(s: RealSession, filter: Filter): Evaluate {
  const closes = s.bars.map((b) => b.close);
  const e21 = ema(closes, 21);
  return (f, pos) => {
    const intent = grindV2Evaluate(f, pos, DEFAULT_GRIND_V3_PARAMS);
    if (!intent || intent.kind !== "enter") return intent;
    const i = Math.min(Math.max(0, f.minute), closes.length - 1);
    const up = intent.direction === "call";
    let ok = true;
    if (filter === "vwap-align") ok = up ? f.close > f.vwap : f.close < f.vwap;
    else if (filter === "counter-vwap(knives)") ok = up ? f.close < f.vwap : f.close > f.vwap; // ISOLATE the falling-knife bucket
    else if (filter === "ema21-align") ok = up ? f.close > e21[i] : f.close < e21[i];
    return ok ? intent : null;
  };
}

const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 1200 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);

  const runWin = (filter: Filter, from: string, to: string) => {
    const ws = real.filter((s) => s.dateET >= from && s.dateET <= to);
    const trades = ws.flatMap((s) => simulateSession(s.bars, CFG, FUND, makeEval(s, filter), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));
    const m = metrics(trades, ws.length);
    return { n: trades.length, total: m.totalPnl, exp: trades.length ? m.totalPnl / trades.length : 0, win: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : 0 };
  };

  console.log(`\n═══ GRIND v3 · trend-alignment ENTRY filter · real NBBO · exp$/t (scalp metric) ═══`);
  console.log(`window        ` + FILTERS.map((f) => f.padStart(18)).join(""));
  const pooled = FILTERS.map(() => ({ total: 0, n: 0 }));
  const holds = FILTERS.map(() => 0);
  for (const w of WINDOWS) {
    const cells = FILTERS.map((f) => runWin(f, w.from, w.to));
    const base = cells[0];
    cells.forEach((c, i) => { pooled[i].total += c.total; pooled[i].n += c.n; if (i > 0 && c.exp > base.exp + 0.01) holds[i]++; });
    console.log(`${w.key.padEnd(14)}` + cells.map((c) => `${c.exp.toFixed(1)}/${c.n}t`.padStart(18)).join(""));
  }
  console.log(`${"POOLED exp/Σ".padEnd(14)}` + pooled.map((p) => `${(p.n ? p.total / p.n : 0).toFixed(1)}/${sgn(p.total)}`.padStart(18)).join(""));
  FILTERS.forEach((f, i) => { if (i > 0) { const be = pooled[i].n ? pooled[i].total / pooled[i].n : 0, bb = pooled[0].n ? pooled[0].total / pooled[0].n : 0; console.log(`  ${f}: beats baseline exp$/t in ${holds[i]}/${WINDOWS.length} windows · pooled exp$/t ${be.toFixed(1)} vs ${bb.toFixed(1)} · kept ${pooled[i].n}/${pooled[0].n} trades${holds[i] === WINDOWS.length ? "  ✅ PASS" : "  ✗ mixed/fail"}`); } });
  console.log(`\n⚠ exp$/t is the right scalp metric (a filter that just trades less can lift total but not edge). PASS = better per-trade EV in EVERY window. vwap-align is concept-only (live vwap bug); ema-align is wireable now. Even a PASS graduates to the paper-lab.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
