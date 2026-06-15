// ============================================================================
//  orb-gate-live-probe — Stage 1 GATING re-validation for orb-gated.
//  (2026-06-15.) chop-ride-oos-probe validated the implied-chop gate on ORB, but
//  measured realized through 10:30 while ORB can ENTER from 10:00 → a mild look-
//  ahead. This re-validates with the LIVE-FAITHFUL timing: realized window closes
//  at 10:00 (computable before any ORB entry), and reports the FIXED threshold R*
//  (the raw ratio the live `implied_move_min` condition will use — live can't rank
//  against the future, so the percentile becomes a constant).
//
//  PASS (build the vocab + arm) IFF the edge survives realized→10:00: OOS gate
//  better on ≥4/5 held-out windows, pooled +EV, AND the FIXED-R* form (live shape)
//  also +EV with the DD still improved. WEAKENS → tune the cutoff / stop.
//
//    npm run orb-gate-live-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, Quote, StrategistConfig } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "orb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const CLOSE = 16 * 60, READ = 9 * 60 + 35, REALIZED_END = 10 * 60; // ⬅ realized closes 10:00 (live-faithful)

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
const mkORB = () => { const def = specToStrategyDef({ meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET: "15:30" }], entries: ORB, sizing: {} }); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin); };
const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

interface T { pnl: number; date: string; window: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // implied-chop ratio: implied(9:35 straddle) vs realized(9:30->10:00) — readable by 10:00
  const ratioOf = new Map<string, number>();
  for (const s of real) {
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const si = barAt(READ), mi = barAt(REALIZED_END); if (si < 0 || mi <= si) continue;
    const sb = s.bars[si], K = Math.round(sb.close), ch = chainOf(s)(sb.close, CLOSE - mins[si], sb.ts);
    const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
    if (ce && pe && ce.mid > 0 && pe.mid > 0) { const im = (ce.mid + pe.mid) / sb.close; if (im > 0) ratioOf.set(s.dateET, Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open / im); }
  }
  const gateable = real.filter((s) => ratioOf.has(s.dateET));
  const RSTAR = median([...ratioOf.values()]); // ⬅ the live fixed threshold

  // ORB trades
  const mk = mkORB();
  const trades: T[] = [];
  const byDate = new Map<string, number>();
  for (const s of gateable) { let d = 0; for (const t of simulateSession(s.bars, CFG, FUND, mk(s) as Evaluate, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) { trades.push({ pnl: t.pnl, date: s.dateET, window: winOf(s.dateET) }); d += t.pnl; } byDate.set(s.dateET, d); }
  const exp = (ts: T[]) => ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : NaN;

  console.log(`\n  ORB-GATE-LIVE · Stage-1 re-validation (realized→10:00, look-ahead-safe) · ${gateable.length} sessions · ${trades.length} ORB trades`);
  console.log(`  implied = 9:35 ATM straddle/spot · realized = |spot(10:00)−open|/open · live threshold R* = median ratio = ${RSTAR.toFixed(3)}\n`);

  // (1) OOS leave-one-out (the validation): rank held-out days vs the OTHER 4 windows, keep pctRank>=0.50
  const oosKeep = (t: T) => { const train = [...ratioOf.entries()].filter(([d]) => winOf(d) !== t.window).map(([, v]) => v); return pctRank(train, ratioOf.get(t.date)!) >= 0.5; };
  console.log(`  ══ (1) OOS leave-one-out (validation) — held-out window, percentile gate ══`);
  let better = 0;
  for (const W of WINDOWS) {
    const inW = trades.filter((t) => t.window === W.name); if (!inW.length) continue;
    const kept = inW.filter(oosKeep); const b = (exp(kept) || -1e9) > (exp(inW) || 0); if (b) better++;
    console.log(`  ${W.name.padEnd(18)} ungated ${usd(exp(inW)).padStart(7)} (${inW.length})  →  gated ${usd(exp(kept)).padStart(7)} (${kept.length})  ${b ? "✓" : "✗"}`);
  }
  const oosKept = trades.filter(oosKeep);
  console.log(`  POOLED  ungated ${usd(exp(trades))}/t (${trades.length})  →  OOS-gated ${usd(exp(oosKept))}/t (${oosKept.length})  ·  ${better}/5 windows  ${better >= 4 ? "PASS" : "FAIL"}\n`);

  // (2) LIVE FIXED-R* form (what the worker will actually do): keep trades on days with ratio >= R*
  const fixedKeep = (t: T) => ratioOf.get(t.date)! >= RSTAR;
  const fixedKept = trades.filter(fixedKeep);
  const dd = (series: number[]) => { let cum = 0, peak = 0, m = 0; for (const p of series) { cum += p; peak = Math.max(peak, cum); m = Math.min(m, cum - peak); } return m; };
  const dates = [...byDate.keys()].sort();
  const ddUn = dd(dates.map((d) => byDate.get(d) ?? 0));
  const keepDate = new Set(fixedKept.map((t) => t.date));
  const ddGated = dd(dates.map((d) => keepDate.has(d) ? (byDate.get(d) ?? 0) : 0));
  console.log(`  ══ (2) LIVE FORM — fixed threshold ratio ≥ R*=${RSTAR.toFixed(3)} (no percentile; what the worker computes) ══`);
  console.log(`  ungated  ${usd(exp(trades))}/t · Σ ${usd(trades.reduce((a, t) => a + t.pnl, 0))} · maxDD ${usd(ddUn)}`);
  console.log(`  gated    ${usd(exp(fixedKept))}/t · Σ ${usd(fixedKept.reduce((a, t) => a + t.pnl, 0))} · maxDD ${usd(ddGated)} · ${trades.length}→${fixedKept.length} trades`);
  console.log(`  per-window (fixed): ${WINDOWS.map((W) => { const k = trades.filter((t) => t.window === W.name && fixedKeep(t)); return k.length ? `${W.name.replace(/ .*/, "")} ${usd(exp(k))}` : ""; }).filter(Boolean).join(" · ")}\n`);

  console.log(`  VERDICT: BUILD the implied_move_min vocab IFF (1) OOS ≥4/5 + pooled +EV survives realized→10:00,`);
  console.log(`  AND (2) the live fixed-R* form is +EV with maxDD still improved vs ungated. R*=${RSTAR.toFixed(3)} is the`);
  console.log(`  live threshold. Else: the 10:30 edge was timing-inflated → tune the cutoff or stop.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
