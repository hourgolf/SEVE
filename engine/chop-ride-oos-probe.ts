// ============================================================================
//  chop-ride-oos-probe — ORB RESURRECTION, Stage 0 (the graduation gate).
//  (2026-06-15.) chop-ride-gate-probe found the implied-move chop gate flips
//  benched ORB +EV and passes the in-sample gauntlet — but the imScore threshold
//  was a FULL-CORPUS percentile = in-sample. This is the OOS bar that decides
//  whether the resurrection is real or the mirage that demoted the regime-gate.
//
//  THREE checks:
//   (1) OOS leave-one-out — for each window, rank its days against the OTHER four
//       windows' imScore distribution (train) and gate; ungated vs gated exp$/t on
//       the HELD-OUT window. Real edge survives out-of-sample; a mirage doesn't.
//   (2) Threshold + timing sensitivity — gate at pctile 0.40/0.50/0.60 × straddle
//       read 9:35/9:45. Plateau = robust; knife-edge = overfit.
//   (3) Tail-DD — ORB was benched for worst-regime DRAWDOWN, not weak mean. Does the
//       OOS gate cut the max-DD / worst-day (the actual reason it was culled)?
//
//  ORB only (the candidate). Real Databento NBBO, ride exits (−50% / 15:30 flatten,
//  cost gate 3.0). PASS = OOS gated exp$/t > ungated on ≥4/5 held-out windows AND DD
//  improves; then Stage 1 (build the implied-chop worker vocab). FAIL = park.
//
//    npm run chop-ride-oos-probe
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
const CLOSE = 16 * 60;
const READS = [9 * 60 + 35, 9 * 60 + 45]; // straddle-read minutes (timing sensitivity)
const MORN_END = 10 * 60 + 30;

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

interface Trade { pnl: number; date: string; window: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to));
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // ---- per-session implied-move ratio at each read minute ----
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

  // ---- ORB trades, tagged ----
  const mk = evalOf(ORB, "15:30");
  const trades: Trade[] = [];
  const byDate = new Map<string, number>(); // ORB daily P&L (for DD)
  for (const s of real) {
    let day = 0;
    for (const t of simulateSession(s.bars, CFG, FUND, mk(s) as Evaluate, chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) { trades.push({ pnl: t.pnl, date: s.dateET, window: winOf(s.dateET) }); day += t.pnl; }
    if (day !== 0 || true) byDate.set(s.dateET, (byDate.get(s.dateET) ?? 0) + day);
  }
  const exp = (ts: Trade[]) => ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : NaN;

  console.log(`\n  CHOP-RIDE-OOS · ORB resurrection Stage 0 · ${real.length} sessions · ${trades.length} ORB trades · real NBBO\n`);

  // ================= (1) OOS LEAVE-ONE-OUT (read 9:35, threshold 0.50) =================
  const oosGatePass = (read: number, thr: number) => {
    // per held-out window: rank its days vs the OTHER windows' ratios; gate trades >= thr
    const perWin: Array<{ w: string; nAll: number; expAll: number; nKept: number; expKept: number; surv: boolean }> = [];
    const keptPooled: Trade[] = [];
    for (const W of WINDOWS) {
      const train = [...ratioAt.get(read)!.entries()].filter(([d]) => winOf(d) !== W.name).map(([, v]) => v);
      const inW = trades.filter((t) => t.window === W.name);
      const kept = inW.filter((t) => { const r = ratioAt.get(read)!.get(t.date); return r != null && pctRank(train, r) >= thr; });
      keptPooled.push(...kept);
      perWin.push({ w: W.name, nAll: inW.length, expAll: exp(inW), nKept: kept.length, expKept: exp(kept), surv: (exp(kept) || -1) > (exp(inW) || 0) });
    }
    return { perWin, keptPooled };
  };
  const { perWin, keptPooled } = oosGatePass(READS[0], 0.5);
  console.log(`  ══ (1) OOS LEAVE-ONE-OUT (read 9:35 · gate pctile 0.50, ranked vs the OTHER 4 windows) ══`);
  console.log(`  held-out window     ungated exp$/t (n)      OOS-gated exp$/t (n)     gate better?`);
  let better = 0;
  for (const p of perWin) {
    if (p.surv) better++;
    console.log(`  ${p.w.padEnd(18)} ${`${usd(p.expAll)} (${p.nAll})`.padStart(18)}   ${`${usd(p.expKept)} (${p.nKept})`.padStart(20)}     ${p.surv ? "✓ better" : "✗ worse"}`);
  }
  const allExp = exp(trades), keptExp = exp(keptPooled);
  console.log(`  POOLED (held-out)  ungated ${usd(allExp)}/t (${trades.length})   →   OOS-gated ${usd(keptExp)}/t (${keptPooled.length})`);
  console.log(`  → gate better on ${better}/5 held-out windows  ${better >= 4 ? "· PASS the OOS bar" : "· FAILS the OOS bar (≥4/5 needed)"}\n`);

  // ================= (2) THRESHOLD × TIMING SENSITIVITY =================
  console.log(`  ══ (2) SENSITIVITY — pooled held-out OOS-gated exp$/t (robust = plateau, not knife-edge) ══`);
  console.log(`  read     pctile 0.40           pctile 0.50           pctile 0.60`);
  for (const read of READS) {
    const cells = [0.40, 0.50, 0.60].map((thr) => { const { keptPooled: kp } = oosGatePass(read, thr); return `${usd(exp(kp))}/t (${kp.length})`; });
    console.log(`  ${(`${Math.floor(read / 60)}:${String(read % 60).padStart(2, "0")}`).padEnd(7)} ${cells.map((c) => c.padStart(20)).join("")}`);
  }
  console.log(`  baseline ungated ${usd(allExp)}/t (${trades.length})\n`);

  // ================= (3) TAIL-DD (the reason ORB was benched) =================
  const dates = [...new Set(trades.map((t) => t.date))].sort();
  const gatedKeep = new Set(keptPooled.map((t) => t.date + "|" + t.pnl)); // approx: keep days whose trades survived
  const keepDate = new Set(keptPooled.map((t) => t.date));
  const dd = (series: number[]) => { let cum = 0, peak = 0, mdd = 0, worst = 0; for (const p of series) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); worst = Math.min(worst, p); } return { mdd, worst, tot: cum }; };
  const ungatedDaily = dates.map((d) => byDate.get(d) ?? 0);
  const gatedDaily = dates.map((d) => keepDate.has(d) ? (byDate.get(d) ?? 0) : 0); // OOS-gated: 0 P&L on skipped days
  const u = dd(ungatedDaily), g = dd(gatedDaily);
  console.log(`  ══ (3) TAIL-DD — gated (OOS 9:35/0.50) vs ungated daily ORB series ══`);
  console.log(`  ungated  Σ ${usd(u.tot).padStart(8)}   maxDD ${usd(u.mdd).padStart(8)}   worst day ${usd(u.worst).padStart(7)}`);
  console.log(`  gated    Σ ${usd(g.tot).padStart(8)}   maxDD ${usd(g.mdd).padStart(8)}   worst day ${usd(g.worst).padStart(7)}`);
  console.log(`  → DD ${g.mdd > u.mdd ? "IMPROVES" : "WORSENS"} (the benched-for-DD reason ${g.mdd > u.mdd ? "is addressed" : "is NOT addressed"})  ${void gatedKeep}\n`);

  console.log(`  VERDICT: graduate to Stage 1 IFF (1) gate better on ≥4/5 held-out windows + pooled OOS exp$/t up,`);
  console.log(`  (2) the lift is a plateau across thresholds/reads (not one cell), (3) DD improves. Else → PARK.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
