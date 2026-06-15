// ============================================================================
//  orb-gate-tune-probe — Stage-1 RECOVERY tuning for the ORB implied-chop gate.
//  (2026-06-15.) orb-gate-live-probe FAILED the bar at realized→10:00: only 3/5
//  OOS windows better, pooled +$29/t, fixed R*=0.306. The 10:30 edge that passed
//  Stage 0 (5/5, +$97/t) was partly LOOK-AHEAD-inflated — ORB can ENTER from 10:00,
//  so a realized window that runs to 10:30 peeks at tape ORB already traded on.
//  And the failure was ERA-SPLIT: the gate helps the recent windows (CHOP Mar26,
//  TREND AprMay26, CHOP-MIX) but hurts 2024/2025 — one global-median threshold
//  can't straddle the eras.
//
//  Two tunes vs the realized→10:00 baseline, EACH reported honestly:
//
//   (a) REALIZED WINDOW SWEEP — close the realized leg at 10:00 / 10:15 / 10:30.
//       · 10:30 = the look-ahead-INFLATED original → MUST reproduce ~5/5, ~+$97/t
//         (the sanity anchor; if it doesn't, the wiring is wrong).
//       · 10:00 = the live-faithful baseline → MUST reproduce 3/5, ~+$29/t.
//       · 10:15 = the candidate. ORB rarely fires in the first 15 min (needs the
//         30-min OR + a break + rel_vol), so realized→10:15 is ~look-ahead-safe
//         while giving the classifier 50% more realized signal than 10:00.
//
//   (b) ROLLING R* — instead of one global-median threshold, a CAUSAL trailing-N-
//       session median of the ratio (default N=60). The threshold then ADAPTS across
//       eras (the era-split failure mode), and it's strictly causal (each day's R*
//       uses only PRIOR sessions). Reported at the live-safe reads (10:00 & 10:15).
//
//  PER CUTOFF we report: OOS leave-one-out windows-better (x/5), pooled gated exp$/t,
//  and the tail-DD vs ungated. clearsBar IFF a LOOK-AHEAD-SAFE config (10:15 or
//  rolling-R*, NOT 10:30) reaches ≥4/5 + pooled +EV + DD still improved.
//
//    npx tsx engine/orb-gate-tune-probe.ts
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
const CLOSE = 16 * 60, READ = 9 * 60 + 35;
const CUTOFFS = [10 * 60, 10 * 60 + 15, 10 * 60 + 30]; // realized-leg close minutes
const ROLL_N = 60; // trailing-session window for the causal rolling median
const ROLL_NS = [40, 60, 80]; // N-sensitivity for the rolling median (robustness, not knife-edge)

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const mkORB = () => { const def = specToStrategyDef({ meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET: "15:30" }], entries: ORB, sizing: {} }); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl }); };
const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

interface T { pnl: number; date: string; window: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // --- ratio per session per realized cutoff (implied = 9:35 straddle / spot; realized = |spot(cutoff)-open|/open) ---
  const ratioAt: Map<number, Map<string, number>> = new Map(CUTOFFS.map((c) => [c, new Map()]));
  for (const s of real) {
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const si = barAt(READ); if (si < 0) continue;
    const sb = s.bars[si], K = Math.round(sb.close), ch = chainOf(s)(sb.close, CLOSE - mins[si], sb.ts);
    const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
    if (!(ce && pe && ce.mid > 0 && pe.mid > 0)) continue;
    const im = (ce.mid + pe.mid) / sb.close; if (im <= 0) continue;
    for (const c of CUTOFFS) { const mi = barAt(c); if (mi <= si) continue; ratioAt.get(c)!.set(s.dateET, Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open / im); }
  }

  // --- ORB trades (entry/exit logic is gate-INDEPENDENT; gating only filters which days count) ---
  const mk = mkORB();
  const trades: T[] = [];
  const byDate = new Map<string, number>();
  for (const s of real) { let d = 0; for (const t of simulateSession(s.bars, CFG, FUND, mk(s) as Evaluate, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) { trades.push({ pnl: t.pnl, date: s.dateET, window: winOf(s.dateET) }); d += t.pnl; } byDate.set(s.dateET, d); }
  const exp = (ts: T[]) => ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : NaN;
  const allExp = exp(trades);
  const dates = [...new Set(real.map((s) => s.dateET))].sort();
  const dd = (series: number[]) => { let cum = 0, peak = 0, mdd = 0, worst = 0; for (const p of series) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); worst = Math.min(worst, p); } return { mdd, worst, tot: cum }; };
  const ddOf = (keepDate: Set<string>) => dd(dates.map((d) => keepDate.has(d) ? (byDate.get(d) ?? 0) : 0));
  const ddUngated = dd(dates.map((d) => byDate.get(d) ?? 0));

  console.log(`\n  ORB-GATE-TUNE · Stage-1 recovery · ${real.length} sessions · ${trades.length} ORB trades · real NBBO`);
  console.log(`  ungated baseline ${usd(allExp)}/t (${trades.length}) · maxDD ${usd(ddUngated.mdd)} · worst day ${usd(ddUngated.worst)}\n`);

  // ---- shared OOS leave-one-out (percentile, ranked vs the OTHER 4 windows) ----
  const oosRun = (ratio: Map<string, number>) => {
    let better = 0; const kept: T[] = []; const rows: string[] = [];
    for (const W of WINDOWS) {
      const train = [...ratio.entries()].filter(([d]) => winOf(d) !== W.name).map(([, v]) => v);
      const inW = trades.filter((t) => t.window === W.name);
      const k = inW.filter((t) => { const r = ratio.get(t.date); return r != null && pctRank(train, r) >= 0.5; });
      kept.push(...k); const b = (exp(k) || -1e9) > (exp(inW) || 0); if (b) better++;
      rows.push(`    ${W.name.padEnd(18)} ungated ${usd(exp(inW)).padStart(7)} (${String(inW.length).padStart(3)})  →  gated ${usd(exp(k)).padStart(7)} (${String(k.length).padStart(3)})  ${b ? "✓" : "✗"}`);
    }
    return { better, kept, rows };
  };

  // ============ (a) REALIZED WINDOW SWEEP (global-median fixed-R*, percentile OOS) ============
  console.log(`  ══ (a) REALIZED-WINDOW SWEEP — close realized leg at 10:00 / 10:15 / 10:30 ══`);
  console.log(`     (10:30 = look-ahead-INFLATED sanity anchor; 10:00 = live baseline; 10:15 = look-ahead-safe candidate)\n`);
  const safe: Array<{ label: string; better: number; pooled: number; ddImproved: boolean; mdd: number; lookaheadSafe: boolean }> = [];
  for (const c of CUTOFFS) {
    const ratio = ratioAt.get(c)!;
    const rstar = median([...ratio.values()]);
    const { better, kept, rows } = oosRun(ratio);
    // live fixed-R* form
    const fixedKeepDate = new Set([...ratio.entries()].filter(([, v]) => v >= rstar).map(([d]) => d));
    const fk = trades.filter((t) => fixedKeepDate.has(t.date));
    const g = ddOf(fixedKeepDate);
    const ddImproved = g.mdd > ddUngated.mdd;
    const lookaheadSafe = c <= 10 * 60 + 15;
    console.log(`  ── realized→${hhmm(c)}  (R*=${rstar.toFixed(3)}${c === 10 * 60 + 30 ? " · INFLATED" : lookaheadSafe ? " · live-safe" : ""}) ──`);
    rows.forEach((r) => console.log(r));
    console.log(`    OOS POOLED  ungated ${usd(allExp)}/t  →  gated ${usd(exp(kept))}/t (${kept.length})  ·  ${better}/5 windows  ${better >= 4 ? "PASS" : "fail"}`);
    console.log(`    FIXED-R* (live form)  gated ${usd(exp(fk))}/t · Σ ${usd(g.tot)} · maxDD ${usd(g.mdd)} (ungated ${usd(ddUngated.mdd)}) → DD ${ddImproved ? "IMPROVES" : "WORSENS"}\n`);
    safe.push({ label: `realized→${hhmm(c)} fixed-R*`, better, pooled: exp(kept), ddImproved, mdd: g.mdd, lookaheadSafe });
  }

  // ============ (b) ROLLING R* — causal trailing-N-session median (at the live-safe reads) ============
  console.log(`  ══ (b) ROLLING R* — causal trailing-${ROLL_N}-session median (adapts across eras; strictly causal) ══\n`);
  // chronological ratio stream across ALL gateable sessions (calendar history, not window-split)
  for (const c of CUTOFFS.filter((x) => x <= 10 * 60 + 15)) {
    const ratio = ratioAt.get(c)!;
    const chrono = dates.filter((d) => ratio.has(d)); // date-sorted gateable days
    // per-day causal threshold = median of the prior up-to-N sessions' ratios (warmup: use prior <N until full)
    const rollThr = new Map<string, number>();
    for (let i = 0; i < chrono.length; i++) {
      const hist = chrono.slice(Math.max(0, i - ROLL_N), i).map((d) => ratio.get(d)!);
      rollThr.set(chrono[i], hist.length >= 10 ? median(hist) : -Infinity); // <10 prior → no gate (keep) so early days aren't dropped blind
    }
    const keepDate = new Set(chrono.filter((d) => (ratio.get(d) ?? -1) >= (rollThr.get(d) ?? Infinity)));
    const rk = trades.filter((t) => keepDate.has(t.date));
    const g = ddOf(keepDate);
    const ddImproved = g.mdd > ddUngated.mdd;
    // per-window: is rolling-gated better than ungated, on that window's trades?
    let better = 0; const rows: string[] = [];
    for (const W of WINDOWS) {
      const inW = trades.filter((t) => t.window === W.name);
      const k = inW.filter((t) => keepDate.has(t.date));
      const b = (exp(k) || -1e9) > (exp(inW) || 0); if (b) better++;
      rows.push(`    ${W.name.padEnd(18)} ungated ${usd(exp(inW)).padStart(7)} (${String(inW.length).padStart(3)})  →  roll-gated ${usd(exp(k)).padStart(7)} (${String(k.length).padStart(3)})  ${b ? "✓" : "✗"}`);
    }
    console.log(`  ── realized→${hhmm(c)} · rolling-${ROLL_N} median (live-safe, causal) ──`);
    rows.forEach((r) => console.log(r));
    console.log(`    POOLED  ungated ${usd(allExp)}/t  →  roll-gated ${usd(exp(rk))}/t (${rk.length})  ·  ${better}/5 windows  ${better >= 4 ? "PASS" : "fail"}`);
    console.log(`    Σ ${usd(g.tot)} · maxDD ${usd(g.mdd)} (ungated ${usd(ddUngated.mdd)}) → DD ${ddImproved ? "IMPROVES" : "WORSENS"} · ${trades.length}→${rk.length} trades\n`);
    safe.push({ label: `realized→${hhmm(c)} rolling-${ROLL_N}`, better, pooled: exp(rk), ddImproved, mdd: g.mdd, lookaheadSafe: true });
  }

  // ---- N-sensitivity for the WINNING cutoff (10:00): is rolling-60 a plateau or a knife-edge? ----
  console.log(`  ── rolling-N sensitivity at realized→10:00 (robustness: plateau = real, single-N = overfit) ──`);
  for (const N of ROLL_NS) {
    const ratio = ratioAt.get(10 * 60)!;
    const chrono = dates.filter((d) => ratio.has(d));
    const rollThr = new Map<string, number>();
    for (let i = 0; i < chrono.length; i++) { const hist = chrono.slice(Math.max(0, i - N), i).map((d) => ratio.get(d)!); rollThr.set(chrono[i], hist.length >= 10 ? median(hist) : -Infinity); }
    const keepDate = new Set(chrono.filter((d) => (ratio.get(d) ?? -1) >= (rollThr.get(d) ?? Infinity)));
    const rk = trades.filter((t) => keepDate.has(t.date));
    let better = 0; for (const W of WINDOWS) { const inW = trades.filter((t) => t.window === W.name); const k = inW.filter((t) => keepDate.has(t.date)); if ((exp(k) || -1e9) > (exp(inW) || 0)) better++; }
    const g = ddOf(keepDate);
    console.log(`    N=${String(N).padStart(2)}  ${better}/5 windows · pooled ${usd(exp(rk)).padStart(6)}/t (${rk.length}) · maxDD ${usd(g.mdd)} (ungated ${usd(ddUngated.mdd)})`);
  }
  console.log("");

  // ============ VERDICT ============
  const winners = safe.filter((s) => s.lookaheadSafe && s.better >= 4 && s.pooled > 0 && s.ddImproved);
  const best = [...safe.filter((s) => s.lookaheadSafe)].sort((a, b) => (b.better - a.better) || (b.pooled - a.pooled))[0];
  console.log(`  ══ VERDICT ══`);
  if (winners.length) {
    const w = winners.sort((a, b) => (b.better - a.better) || (b.pooled - a.pooled))[0];
    console.log(`  ✅ RECOVERED — look-ahead-safe config "${w.label}": ${w.better}/5 windows, pooled ${usd(w.pooled)}/t, maxDD ${usd(w.mdd)} (improved). clearsBar=TRUE.`);
  } else {
    console.log(`  ❌ NOT RECOVERED — no look-ahead-safe config reaches ≥4/5 + pooled +EV + DD improved.`);
    console.log(`  Best look-ahead-safe: "${best.label}" = ${best.better}/5, pooled ${usd(best.pooled)}/t, maxDD ${usd(best.mdd)} (DD ${best.ddImproved ? "improved" : "worse"}). The 10:30 edge was timing-inflated; the honest edge stays at ~3/5. clearsBar=FALSE.`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
