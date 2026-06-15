// ============================================================================
//  chop-gate-roster-probe — does the implied-move chop gate (validated OOS on
//  ORB) help ANY OTHER channel? (2026-06-15.) Runs the same OOS leave-one-out
//  gate (rank each window's days vs the OTHER four; skip predicted-chop, imScore
//  < 0.50 at the 9:35 straddle read) across the distinct SPY-0DTE strategy types:
//  the scalper (grind-v3), the power lean (power), base-ORB (breakout), and the
//  rides (V3/ALT/ORB) for context.
//
//  The mechanism hypothesis: the gate helps UNDER-filtered, chop-AVERSE directional
//  bleeders (ORB) and HURTS already-selective momentum (V3/ALT). So it should be
//  channel-specific — this prints OOS-gated vs ungated exp$/t + windows-better per
//  channel so the adversarial pass can sort real benefit from mirage.
//  (pb-ride is 1DTE + chop-LOVING → a separate test; QQQ needs QQQ straddle data.)
//
//    npm run chop-gate-roster-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { getStrategy } from "./registry";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, Quote, StrategistConfig } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "x", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const CLOSE = 16 * 60, READ = 9 * 60 + 35, MORN_END = 10 * 60 + 30, THR = 0.5;

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const specEval = (entries: StrategySpec["entries"], timeET: string) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin);
};
const builtinEval = (slug: string) => { const c = getStrategy(slug)!; return (s: RealSession) => c.build(s.bars as Bar[], c.timeframeMin); };

const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

interface T { pnl: number; date: string; window: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // implied-move ratio at 9:35
  const ratioOf = new Map<string, number>();
  for (const s of real) {
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const si = barAt(READ), mi = barAt(MORN_END); if (si < 0 || mi <= si) continue;
    const sb = s.bars[si], K = Math.round(sb.close), ch = chainOf(s)(sb.close, CLOSE - mins[si], sb.ts);
    const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
    if (ce && pe && ce.mid > 0 && pe.mid > 0) { const im = (ce.mid + pe.mid) / sb.close; if (im > 0) ratioOf.set(s.dateET, Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open / im); }
  }
  const gateable = real.filter((s) => ratioOf.has(s.dateET));
  const exp = (ts: T[]) => ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : NaN;
  // OOS: keep a trade iff its day, ranked vs the OTHER windows' ratios, is >= THR (predicted-trend)
  const oos = (trades: T[]) => {
    const perWin = WINDOWS.map((W) => {
      const train = [...ratioOf.entries()].filter(([d]) => winOf(d) !== W.name).map(([, v]) => v);
      const inW = trades.filter((t) => t.window === W.name);
      const kept = inW.filter((t) => pctRank(train, ratioOf.get(t.date)!) >= THR);
      return { w: W.name, expAll: exp(inW), expKept: exp(kept), better: (exp(kept) || -1e9) > (exp(inW) || 0), n: inW.length };
    });
    const keptAll = trades.filter((t) => { const train = [...ratioOf.entries()].filter(([d]) => winOf(d) !== t.window).map(([, v]) => v); return pctRank(train, ratioOf.get(t.date)!) >= THR; });
    return { perWin, betterCount: perWin.filter((p) => p.better && p.n > 0).length, nWin: perWin.filter((p) => p.n > 0).length, expKept: exp(keptAll), nKept: keptAll.length };
  };

  const CHANNELS: Array<{ name: string; type: string; ev: (s: RealSession) => Evaluate }> = [
    { name: "grind-v3", type: "scalper", ev: builtinEval("grind-v3") },
    { name: "power", type: "final-hr lean", ev: builtinEval("power") },
    { name: "breakout(base ORB)", type: "ride/bleeder", ev: builtinEval("breakout") },
    { name: "ORB(spec)", type: "ride/bleeder", ev: specEval(ORB, "15:30") },
    { name: "V3", type: "selective momo", ev: specEval(V3, "15:25") },
    { name: "ALT", type: "selective momo", ev: specEval(ALT, "15:25") },
  ];

  console.log(`\n  CHOP-GATE-ROSTER · implied-chop OOS gate across strategy types · ${gateable.length} sessions · real NBBO`);
  console.log(`  gate = skip session when imScore(9:35) < ${THR}, ranked OOS vs the other 4 windows\n`);
  console.log(`  channel              type            ungated$/t   OOS-gated$/t   win-better   trades(all→kept)   verdict`);
  for (const c of CHANNELS) {
    const trades: T[] = [];
    for (const s of gateable) for (const t of simulateSession(s.bars, CFG, FUND, c.ev(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) trades.push({ pnl: t.pnl, date: s.dateET, window: winOf(s.dateET) });
    const all = exp(trades), o = oos(trades);
    const lift = (o.expKept || 0) - (all || 0);
    const verdict = trades.length < 30 ? "thin-n" : (o.betterCount >= 4 && o.expKept > 0 && o.expKept > all) ? "BENEFITS" : (o.expKept < all) ? "HARMED" : "neutral/mixed";
    console.log(`  ${c.name.padEnd(20)} ${c.type.padEnd(15)} ${usd(all).padStart(9)}   ${usd(o.expKept).padStart(10)}   ${`${o.betterCount}/${o.nWin}`.padStart(8)}   ${`${trades.length}→${o.nKept}`.padStart(14)}   ${lift >= 0 ? "+" : ""}${Math.round(lift)}/t · ${verdict}`);
  }
  console.log(`\n  READ: BENEFITS = OOS-gated > ungated, +EV, better on ≥4/5 windows (ORB's profile). HARMED = gate strips`);
  console.log(`  winners (the selective-momentum case). The gate is for chop-AVERSE under-filtered bleeders, not all.`);
  console.log(`  ⚠ adversarial follow-ups: power trades 15:00+ vs a 9:35 read (horizon); pb-ride/QQQ untested here.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
