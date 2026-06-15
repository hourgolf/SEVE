// ============================================================================
//  qqq-orb-gate-probe — does the OOS-validated implied-chop gate rescue the QQQ
//  ORB bleeder? (2026-06-15, generative follow-on to chop-ride-oos-probe.)
//
//  Context: chop-ride-oos-probe validated an implied-chop gate on SPY's spec-ORB
//  OOS (skip predicted-chop days, keep imScore >= 0.50; +$111/t lift, ≥4/5
//  held-out windows). The gate's value is "give a chop-AVERSE bleeder room to
//  filter." QQQ's ORB is a KNOWN bleeder (the incumbent QQQ ORB ≈ −$8,817, why
//  breakout-qqq was cut) → it has the most room to filter. Question: does the
//  same gate rescue QQQ ORB (orb-qqq-trail equivalent)?
//
//  STRUCTURE (mirrors chop-ride-oos-probe exactly, on QQQ):
//   · the SPY spec-ORB entries, cloned verbatim, run on QQQ bars + QQQ chains
//   · the implied-chop gate = QQQ ATM straddle @9:35 vs realized QQQ 1hr move,
//     OOS leave-one-out vs the OTHER 4 windows, NORMAL direction (skip
//     predicted-chop, keep imScore >= 0.50)
//   · same 5 windows; real QQQ NBBO; ride exits (−50% / 15:30 flatten, gate 3.0)
//
//  ⚠ HONEST DATA LIMIT (the binding one): real QQQ NBBO exists locally only for
//  2026-03-02 → 2026-06-11 = the Mar26 + AprMay26 windows ONLY. The other 3
//  windows (MA25, TREND 24, CHOP-MIX 25-26) have ZERO QQQ chain coverage → a true
//  5-window leave-one-out is IMPOSSIBLE (train pool = 1 window, held-out = 2).
//  The probe runs and reports per-window n; if <~10 QQQ sessions cover the gate
//  in a window it flags THIN, and with <3 covered windows the OOS verdict is
//  unsupported (status=thin-data) — buying the OOS QQQ windows (~$0.20 each) is
//  the prerequisite for a real verdict.
//
//  SANITY GATE: the UNGATED QQQ-ORB baseline MUST be negative (the bleeder
//  precondition). If it's strongly positive, the wiring is wrong (ticker/chain).
//
//    npx tsx engine/qqq-orb-gate-probe.ts
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, Quote, StrategistConfig } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const SYM = "QQQ";
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "orb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const CLOSE = 16 * 60;
const READS = [9 * 60 + 35, 9 * 60 + 45]; // straddle-read minutes (timing sensitivity)
const MORN_END = 10 * 60 + 30;
const THIN_N = 10; // per-window QQQ-session floor for an OOS hold to be trustworthy

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
// ORB spec entries — cloned VERBATIM from chop-ride-oos-probe.ts (the SPY candidate),
// run here on QQQ bars + QQQ chains. (QQQ is $1-strike, OPRA-fed, same OCC layout.)
const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const evalOf = (entries: StrategySpec["entries"], timeET: string) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

interface Trade { pnl: number; date: string; window: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: SYM, sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), SYM) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // ---- per-window QQQ NBBO coverage (the binding data check) ----
  const covByWin = new Map<string, number>();
  for (const s of real) covByWin.set(winOf(s.dateET), (covByWin.get(winOf(s.dateET)) ?? 0) + 1);
  const coveredWindows = WINDOWS.filter((w) => (covByWin.get(w.name) ?? 0) > 0);

  console.log(`\n  QQQ-ORB-GATE · implied-chop gate on the QQQ ORB bleeder · ${real.length} ${SYM} sessions · real NBBO\n`);
  console.log(`  ══ QQQ NBBO COVERAGE per window (the binding limit) ══`);
  for (const w of WINDOWS) {
    const n = covByWin.get(w.name) ?? 0;
    console.log(`  ${w.name.padEnd(18)} ${String(n).padStart(3)} QQQ sessions  ${n === 0 ? "✗ NO QQQ chain data" : n < THIN_N ? "⚠ THIN (<10)" : "✓"}`);
  }
  console.log(`  → ${coveredWindows.length}/5 windows have QQQ NBBO. A real OOS leave-one-out needs ≥3 covered windows`);
  console.log(`    (train pool ≥2, held-out ≥1). ${coveredWindows.length < 3 ? "NOT MET → OOS verdict is THIN-DATA." : "met."}\n`);

  // ---- per-session implied-move ratio at each read minute (QQQ straddle vs realized) ----
  const ratioAt: Map<number, Map<string, number>> = new Map(READS.map((r) => [r, new Map()]));
  for (const s of real) {
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const mi = barAt(MORN_END); if (mi < 0) continue;
    const realizedPct = Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open;
    for (const r of READS) {
      const si = barAt(r); if (si < 0 || si >= mi) continue;
      const sb = s.bars[si], K = Math.round(sb.close);
      const ch = chainOf(s)(sb.close, CLOSE - mins[si], sb.ts);
      const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
      if (ce && pe && ce.mid > 0 && pe.mid > 0) { const implied = (ce.mid + pe.mid) / sb.close; if (implied > 0) ratioAt.get(r)!.set(s.dateET, realizedPct / implied); }
    }
  }
  const imCov = new Map<string, number>();
  for (const [d] of ratioAt.get(READS[0])!) imCov.set(winOf(d), (imCov.get(winOf(d)) ?? 0) + 1);

  // ---- ORB trades on QQQ, tagged ----
  const mk = evalOf(ORB, "15:30");
  const trades: Trade[] = [];
  const byDate = new Map<string, number>(); // ORB daily P&L (for DD)
  for (const s of real) {
    let day = 0;
    for (const t of simulateSession(s.bars, CFG, FUND, mk(s) as Evaluate, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) { trades.push({ pnl: t.pnl, date: s.dateET, window: winOf(s.dateET) }); day += t.pnl; }
    byDate.set(s.dateET, (byDate.get(s.dateET) ?? 0) + day);
  }
  const exp = (ts: Trade[]) => ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : NaN;

  // ================= SANITY GATE — ungated QQQ-ORB baseline MUST be negative =================
  const allExp = exp(trades);
  const tot = trades.reduce((a, t) => a + t.pnl, 0);
  const winPct = trades.length ? (100 * trades.filter((t) => t.pnl > 0).length) / trades.length : 0;
  console.log(`  ══ SANITY GATE — ungated QQQ-ORB baseline (must be NEGATIVE; bleeder precondition) ══`);
  console.log(`  ungated  exp$/t ${usd(allExp)}  ·  n ${trades.length}  ·  win% ${winPct.toFixed(0)}  ·  Σ ${usd(tot)}`);
  console.log(`  per-window ungated:`);
  for (const w of WINDOWS) { const inW = trades.filter((t) => t.window === w.name); if (inW.length) console.log(`    ${w.name.padEnd(16)} ${usd(exp(inW)).padStart(7)}/t  (n ${inW.length})  Σ ${usd(inW.reduce((a, t) => a + t.pnl, 0))}`); }
  const sanityOk = (allExp || 0) < 0;
  console.log(`  → baseline ${sanityOk ? "NEGATIVE ✓ (bleeder confirmed — gate has room to filter)" : "POSITIVE ✗ — WIRING SUSPECT (wrong ticker/chain?); gated result NOT trustworthy"}\n`);

  // ================= (1) OOS LEAVE-ONE-OUT (read 9:35, threshold 0.50, NORMAL direction) =================
  // NORMAL: keep imScore >= thr (high realized/implied = NOT chop = trade-worthy); skip predicted-chop.
  const oosGatePass = (read: number, thr: number) => {
    const perWin: Array<{ w: string; nAll: number; expAll: number; nKept: number; expKept: number; surv: boolean; imN: number }> = [];
    const keptPooled: Trade[] = [];
    for (const W of WINDOWS) {
      const train = [...ratioAt.get(read)!.entries()].filter(([d]) => winOf(d) !== W.name).map(([, v]) => v);
      const inW = trades.filter((t) => t.window === W.name);
      if (!inW.length) continue;
      const kept = inW.filter((t) => { const r = ratioAt.get(read)!.get(t.date); return r != null && pctRank(train, r) >= thr; });
      keptPooled.push(...kept);
      perWin.push({ w: W.name, nAll: inW.length, expAll: exp(inW), nKept: kept.length, expKept: exp(kept), surv: (exp(kept) || -1) > (exp(inW) || 0), imN: imCov.get(W.name) ?? 0 });
    }
    return { perWin, keptPooled };
  };
  const { perWin, keptPooled } = oosGatePass(READS[0], 0.5);
  console.log(`  ══ (1) OOS LEAVE-ONE-OUT (read 9:35 · gate pctile 0.50, ranked vs the OTHER covered windows) ══`);
  console.log(`  held-out window     ungated exp$/t (n)      OOS-gated exp$/t (n)     gate better?`);
  let better = 0;
  for (const p of perWin) {
    if (p.surv) better++;
    const thinFlag = p.imN < THIN_N ? " ⚠thin" : "";
    console.log(`  ${p.w.padEnd(18)} ${`${usd(p.expAll)} (${p.nAll})`.padStart(18)}   ${`${usd(p.expKept)} (${p.nKept})`.padStart(20)}     ${p.surv ? "✓ better" : "✗ worse"}${thinFlag}`);
  }
  const keptExp = exp(keptPooled);
  console.log(`  POOLED (held-out)  ungated ${usd(allExp)}/t (${trades.length})   →   OOS-gated ${usd(keptExp)}/t (${keptPooled.length})`);
  console.log(`  → gate better on ${better}/${perWin.length} covered windows  (a real OOS bar needs ≥3 covered windows)\n`);

  // ================= (2) THRESHOLD × TIMING SENSITIVITY =================
  console.log(`  ══ (2) SENSITIVITY — pooled OOS-gated exp$/t (robust = plateau, not knife-edge) ══`);
  console.log(`  read     pctile 0.40           pctile 0.50           pctile 0.60`);
  for (const read of READS) {
    const cells = [0.40, 0.50, 0.60].map((thr) => { const { keptPooled: kp } = oosGatePass(read, thr); return `${usd(exp(kp))}/t (${kp.length})`; });
    console.log(`  ${(`${Math.floor(read / 60)}:${String(read % 60).padStart(2, "0")}`).padEnd(7)} ${cells.map((c) => c.padStart(20)).join("")}`);
  }
  console.log(`  baseline ungated ${usd(allExp)}/t (${trades.length})\n`);

  // ================= (3) TAIL-DD (the reason ORB was benched) =================
  const dates = [...new Set(trades.map((t) => t.date))].sort();
  const keepDate = new Set(keptPooled.map((t) => t.date));
  const dd = (series: number[]) => { let cum = 0, peak = 0, mdd = 0, worst = 0; for (const p of series) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); worst = Math.min(worst, p); } return { mdd, worst, tot: cum }; };
  const ungatedDaily = dates.map((d) => byDate.get(d) ?? 0);
  const gatedDaily = dates.map((d) => keepDate.has(d) ? (byDate.get(d) ?? 0) : 0);
  const u = dd(ungatedDaily), g = dd(gatedDaily);
  console.log(`  ══ (3) TAIL-DD — gated (OOS 9:35/0.50) vs ungated daily QQQ-ORB series ══`);
  console.log(`  ungated  Σ ${usd(u.tot).padStart(8)}   maxDD ${usd(u.mdd).padStart(8)}   worst day ${usd(u.worst).padStart(7)}`);
  console.log(`  gated    Σ ${usd(g.tot).padStart(8)}   maxDD ${usd(g.mdd).padStart(8)}   worst day ${usd(g.worst).padStart(7)}`);
  console.log(`  → DD ${g.mdd > u.mdd ? "IMPROVES" : "WORSENS"} (the benched-for-DD reason ${g.mdd > u.mdd ? "addressed" : "NOT addressed"})\n`);

  // ================= VERDICT =================
  const oosSupported = coveredWindows.length >= 3;
  console.log(`  ══ VERDICT ══`);
  console.log(`  sanity (ungated bleeder): ${sanityOk ? "PASS" : "FAIL — investigate wiring before trusting anything"}`);
  console.log(`  OOS support: ${coveredWindows.length}/5 windows covered → ${oosSupported ? "OOS verdict supported" : "THIN-DATA: cannot run a real 5-window leave-one-out; buy the 3 missing QQQ windows first"}`);
  if (oosSupported && sanityOk) console.log(`  gate rescues QQQ ORB IFF better on ≥4/5 covered windows + pooled OOS exp$/t up + DD improves.`);
  console.log(`  pooled: ungated ${usd(allExp)}/t → gated ${usd(keptExp)}/t · windows-better ${better}/${perWin.length} · trades ${trades.length}→${keptPooled.length}\n`);

  // machine-readable tail for the harness
  console.log(`  RESULT_JSON ${JSON.stringify({
    sym: SYM, sanityNegative: sanityOk, coveredWindows: coveredWindows.length,
    ungatedExpPerT: Number((allExp || 0).toFixed(2)), gatedExpPerT: Number((keptExp || 0).toFixed(2)),
    windowsBetter: better, windowsTested: perWin.length, nAll: trades.length, nKept: keptPooled.length,
    perWindow: perWin.map((p) => ({ w: p.w, ungated: Math.round(p.expAll), gated: Math.round(p.expKept || 0), n: p.nAll, imN: p.imN, better: p.surv })),
    oosSupported,
  })}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
