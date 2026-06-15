// ============================================================================
//  chop-ride-gate-probe — repurpose the implied-move chop detector. The fly it
//  was built for is door-blocked, but the detector is real (48% recall). The
//  rides BLEED on chop. So: does standing the rides DOWN on predicted-chop
//  mornings (implied-move gate) improve them — and does it beat / add to the
//  gap gate already armed on V3/ALT? (the weekend special #1, 2026-06-15.)
//
//  Gate = SKIP the whole session when the morning is predicted-chop:
//    imScore = pctRank( realized(9:30→10:30) / implied(9:35 ATM straddle) )  — LOW = quiet
//    vs priced = chop-leaning. predicted-chop = imScore < 0.5 → don't trade that day.
//  Compared against: all-days · gap-only (|gap| ≥ 0.25, the armed signal) · implied AND gap.
//
//  THE TELL (mechanical-mirage discipline, the verdict that buried the morning-regime
//  gate): report **exp$/t**, not just total$. Skipping −EV days raises total$ by
//  dropping trades; only a LIFT in per-trade expectancy on the KEPT trades is real
//  selection. Kill-lanes: (a) ex-CHOP-MIX (does any lift survive without the carrier
//  window?), (b) rescue-the-worst-window (does it help the WINNERS or only cut the
//  loser window's loss — the trap that sank breakeven / tier2 / regime-gate?).
//
//  Rides cloned verbatim from gap-regime-probe.ts (ORB/ALT/V3 specs); imScore from
//  implied-move-probe.ts; real Databento NBBO, ride exits (−50% stop, 15:25/15:30
//  flatten, cost gate 3.0). Full-corpus percentile = in-sample (hypothesis-grade).
//
//    npm run chop-ride-gate-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, Quote, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "ride", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const CLOSE = 16 * 60, STRADDLE_ET = 9 * 60 + 35, MORN_END = 10 * 60 + 30;

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const CHOPMIX = "CHOP-MIX 25-26";

const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const evalOf = (entries: StrategySpec["entries"], timeET: string) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};

const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const sgn = (v: number) => (v >= 0 ? "+" : "");
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

interface Tagged { pnl: number; window: string; date: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // ---- per-session morning features: implied-move ratio + gap ----
  const allSorted = [...sessions].sort((a, b) => a.dateET.localeCompare(b.dateET));
  const priorClose = new Map<string, number>();
  for (let i = 1; i < allSorted.length; i++) priorClose.set(allSorted[i].dateET, allSorted[i - 1].bars[allSorted[i - 1].bars.length - 1].close);

  const imRatioOf = new Map<string, number>(), gapOf = new Map<string, number>();
  for (const s of real) {
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const si = barAt(STRADDLE_ET), mi = barAt(MORN_END);
    if (si >= 0 && mi > si) {
      const sb = s.bars[si], K = Math.round(sb.close);
      const ch = makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0])(sb.close, CLOSE - mins[si], sb.ts);
      const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
      if (ce && pe && ce.mid > 0 && pe.mid > 0) {
        const impliedPct = (ce.mid + pe.mid) / sb.close;
        const realizedPct = Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open;
        if (impliedPct > 0) imRatioOf.set(s.dateET, realizedPct / impliedPct);
      }
    }
    const pc = priorClose.get(s.dateET);
    if (pc != null) gapOf.set(s.dateET, Math.abs((s.bars[0].open - pc) / pc) * 100);
  }
  const ratios = [...imRatioOf.values()];
  const imScore = (d: string) => (imRatioOf.has(d) ? pctRank(ratios, imRatioOf.get(d)!) : null);

  // ---- run each ride, collect trades tagged with the day's window ----
  const channels: Array<[string, (s: RealSession) => Evaluate]> = [["V3", evalOf(V3, "15:25")], ["ALT", evalOf(ALT, "15:25")], ["ORB", evalOf(ORB, "15:30")]];
  const gateable = real.filter((s) => imRatioOf.has(s.dateET) && gapOf.has(s.dateET));

  console.log(`\n  CHOP-RIDE-GATE probe · ${gateable.length} SPY sessions (real NBBO, gateable) · per-contract $`);
  console.log(`  gate skips the SESSION when predicted-chop (imScore<0.5) · vs gap-only (|gap|≥0.25) · vs both\n`);

  // GATES (session-level predicates)
  const GATES: Array<[string, (d: string) => boolean]> = [
    ["all days (baseline)", () => true],
    ["skip pred-chop (im≥0.5)", (d) => (imScore(d) ?? 1) >= 0.5],
    ["gap-only (|gap|≥0.25)", (d) => (gapOf.get(d) ?? 0) >= 0.25],
    ["im-trend AND gap", (d) => (imScore(d) ?? 1) >= 0.5 && (gapOf.get(d) ?? 0) >= 0.25],
  ];

  const summarize = (trades: Tagged[]) => {
    const n = trades.length, tot = trades.reduce((a, t) => a + t.pnl, 0);
    const wins = trades.filter((t) => t.pnl > 0).length;
    const days = new Set(trades.map((t) => t.date)).size;
    return { n, tot, days, exp: n ? tot / n : NaN, win: n ? (100 * wins) / n : NaN };
  };
  const fmt = (s: ReturnType<typeof summarize>) => s.n ? `${usd(s.exp).padStart(7)}/t  Σ${usd(s.tot).padStart(8)}  ${String(s.n).padStart(4)}t/${String(s.days).padStart(3)}d  ${s.win.toFixed(0).padStart(2)}%w` : "        —";

  for (const [name, mk] of channels) {
    const trades: Tagged[] = [];
    for (const s of gateable) for (const t of simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) trades.push({ pnl: t.pnl, window: winOf(s.dateET), date: s.dateET });
    console.log(`  ══ ${name} — gate × pooled / per-window (exp$/t is the mechanical-mirage tell) ══`);
    for (const [glabel, gpred] of GATES) {
      const kept = trades.filter((t) => gpred(t.date));
      const ex = kept.filter((t) => t.window !== CHOPMIX);
      console.log(`  ${glabel.padEnd(26)} ${fmt(summarize(kept))}   · ex-CHOP-MIX ${fmt(summarize(ex))}`);
    }
    // rescue-the-worst-window kill-lane: per-window all-days vs implied-gated
    console.log(`    per-window Δ (implied gate − all days), exp$/t:`);
    const row: string[] = [];
    for (const w of WINDOWS) {
      const allW = summarize(trades.filter((t) => t.window === w.name));
      const gatedW = summarize(trades.filter((t) => t.window === w.name && (imScore(t.date) ?? 1) >= 0.5));
      if (allW.n) row.push(`${w.name.replace(/ .*/, "").slice(0, 6)} ${sgn((gatedW.exp || 0) - (allW.exp || 0))}${((gatedW.exp || 0) - (allW.exp || 0)).toFixed(0)}`);
    }
    console.log(`    ${row.join("  ·  ")}\n`);
  }

  console.log(`  READ: PASS = implied gate LIFTS exp$/t (not just total$) on the rides, holds ex-CHOP-MIX, and helps`);
  console.log(`  the WINNER windows (not only the worst). Mirage = total$ up but exp$/t flat (just fewer −EV days) /`);
  console.log(`  only the loser window improves. Redundant = im-AND-gap ≈ gap-only (gap already does the work).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
