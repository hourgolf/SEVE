// ============================================================================
//  gap-sizing-probe (roadmap #3) — the FIRST conviction-sizing experiment.
//  Question: among V3/ALT's trades (already gap-GATED at gap_min 0.25 = the live
//  config), does scaling SIZE by gap magnitude — bigger size on fatter gaps, smaller
//  on the marginal 0.25–0.35 ones — beat flat RISK on a risk-adjusted basis? gap is
//  the desk's ONE armed regime signal (gap-regime-verdict), so the least-overfit
//  conviction lever. Holds the ENTRY SET fixed (pure sizing), real Databento NBBO,
//  the worker cost model (0.25 tick), across 5 regime windows + a maxDD tail check
//  (sizing is multiplicative on a convex-tail book — pooled mean alone can lie).
//
//    npm run gap-sizing-probe
//  PASS bar: a variant improves OR holds total in EVERY window AND does not worsen
//  maxDD. Fail / mixed ⇒ gating already captured the gap signal; sizing on top is
//  redundant (also a real finding). NOT a live arm — graduates to the paper-lab.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { buildSizingModel, scalarFor, type SizingFeatures, type SizingSpec } from "./sizing";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec, Condition } from "../lib/desk/strategySpec";

// V3/ALT's REAL knob: RISK $500 → total_capital 2×risk / pct100 / agg100 (the decide.ts mapping) so
// qty = floor(risk/(0.5·ask·100)) is RISK-BASED (2–6 contracts by premium), NOT pinned to max — only
// then does the conviction scalar move size. (At the $100k budget qty pins to max_contracts and the
// scalar is inert.) daily_stop kept large to ISOLATE pure sizing (entry set fixed); the daily-stop ×
// sizing interaction is a follow-up.
const RISK = 500;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // match the live worker
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "gs", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

// V3/ALT entries, gap-GATED at 0.25 (the live config). ALT carries momentum_atr; V3 drops it.
function entrySpec(withMom: boolean, gapMin = 0.25): StrategySpec {
  const leg = (side: "above" | "below", brk: "break_above" | "break_below"): Condition[] => [
    { kind: "opening_range", side: brk, minutes: 30 },
    { kind: "vwap_side", side },
    ...(withMom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as Condition] : []),
    { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 },
    { kind: "rel_vol", min: 1.3 },
    { kind: "time_before", et: "14:00" },
    { kind: "gap_min", pct: gapMin },
  ];
  return { meta: { name: withMom ? "ALT" : "V3", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: withMom ? "alt" : "v3" } as StrategySpec["meta"],
    exits: [{ timeET: "15:25" }], sizing: {}, entries: [{ direction: "call", reason: "u", all: leg("above", "break_above") }, { direction: "put", reason: "d", all: leg("below", "break_below") }] };
}
const makeEval = (withMom: boolean) => { const def = specToStrategyDef(entrySpec(withMom)); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }); };

const WINDOWS = [
  { key: "2024-trend", from: "2024-05-01", to: "2024-08-31" },
  { key: "2025-trend", from: "2025-05-01", to: "2025-08-31" },
  { key: "late-2025", from: "2025-11-01", to: "2025-12-31" },
  { key: "CHOP-Mar26", from: "2026-03-01", to: "2026-03-31" },
  { key: "AprJun26", from: "2026-04-01", to: "2026-06-30" },
];

// Sizing variants — rules on absGap (|gap|; gap-regime is a MAGNITUDE signal, not directional).
// Small, principled set (overfitting guard): up-size fat gaps, down-size the marginal 0.25–0.35 band.
const VARIANTS: { label: string; spec: SizingSpec | null }[] = [
  { label: "flat (baseline)", spec: null },
  { label: "modest 1.3/0.8", spec: { kind: "rules", default: 1.0, clamp: [0.5, 2.0], rules: [{ key: "absGap", op: ">=", value: 0.5, scalar: 1.3 }, { key: "absGap", op: "<", value: 0.35, scalar: 0.8 }] } },
  { label: "steep 1.6/0.6", spec: { kind: "rules", default: 1.0, clamp: [0.5, 2.0], rules: [{ key: "absGap", op: ">=", value: 0.5, scalar: 1.6 }, { key: "absGap", op: "<", value: 0.35, scalar: 0.6 }] } },
];

const etDay = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
// maxDD on the cumulative DAILY P&L curve (peak-to-trough) — the tail proxy that pooled total hides.
function maxDrawdown(trades: Trade[]): number {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(etDay(t.exitTs), (byDay.get(etDay(t.exitTs)) ?? 0) + t.pnl);
  let cum = 0, peak = 0, dd = 0;
  for (const d of [...byDay.keys()].sort()) { cum += byDay.get(d)!; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  return dd;
}
const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 1200 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);

  const sizingFor = (spec: SizingSpec | null, s: RealSession): ((f: SizingFeatures) => number) | undefined => {
    const built = buildSizingModel(spec);
    return built ? (f) => scalarFor(built, { ...f, gap: s.gap, absGap: Math.abs(s.gap) }) : undefined;
  };
  const runWin = (withMom: boolean, spec: SizingSpec | null, from: string, to: string) => {
    const mk = makeEval(withMom);
    const ws = real.filter((s) => s.dateET >= from && s.dateET <= to);
    const trades = ws.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE, sizingFor(spec, s)));
    const m = metrics(trades, ws.length);
    return { n: trades.length, total: m.totalPnl, dd: maxDrawdown(trades), qty: trades.reduce((s, t) => s + t.qty, 0), win: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : 0 };
  };

  for (const withMom of [false, true]) {
    const ch = withMom ? "BREAK(ALT)" : "BREAK(ALT V3)";
    console.log(`\n═══ ${ch} · gap-magnitude SIZING (entry set fixed at gap_min 0.25) · real NBBO ═══`);
    console.log(`window        ` + VARIANTS.map((v) => v.label.padStart(20)).join(""));
    const pooled = VARIANTS.map(() => ({ total: 0, dd: 0, n: 0, qty: 0 }));
    const holds = VARIANTS.map(() => ({ better: 0, worseDD: 0 }));
    for (const w of WINDOWS) {
      const cells = VARIANTS.map((v) => runWin(withMom, v.spec, w.from, w.to));
      const base = cells[0];
      cells.forEach((c, i) => { pooled[i].total += c.total; pooled[i].dd += c.dd; pooled[i].n += c.n; pooled[i].qty += c.qty; if (i > 0) { if (c.total >= base.total - 1) holds[i].better++; if (c.dd < base.dd - 1) holds[i].worseDD++; } });
      console.log(`${(w.key + ` n${base.n}`).padEnd(14)}` + cells.map((c) => `${sgn(c.total)}/dd${Math.round(c.dd)}`.padStart(20)).join(""));
    }
    console.log(`${"POOLED".padEnd(14)}` + pooled.map((p) => `${sgn(p.total)}/dd${Math.round(p.dd)}`.padStart(20)).join(""));
    console.log(`${"Σcontracts".padEnd(14)}` + pooled.map((p) => String(p.qty).padStart(20)).join("") + "   ← scalar moved size iff these differ");
    VARIANTS.forEach((v, i) => { if (i > 0) console.log(`  ${v.label}: holds-or-improves ${holds[i].better}/${WINDOWS.length} windows · worsens maxDD in ${holds[i].worseDD}/${WINDOWS.length} · pooled Δ ${sgn(pooled[i].total - pooled[0].total)} (dd Δ ${Math.round(pooled[i].dd - pooled[0].dd)})${holds[i].better === WINDOWS.length && holds[i].worseDD === 0 ? "  ✅ PASS" : "  ✗ mixed/fail"}`); });
  }
  console.log(`\n⚠ entry set held fixed (pure sizing). PASS = a variant holds/improves EVERY window with NO maxDD worsening. Even a PASS graduates to the paper-lab, not the live book — and a pooled lift with a maxDD blow-up is a FAIL (multiplicative variance on the convex tail).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
