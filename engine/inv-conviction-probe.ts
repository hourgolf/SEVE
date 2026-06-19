// ============================================================================
//  inv-conviction-probe — conviction sizing, CORRECTLY SIGNED. (2026-06-19.)
//
//  The refreshed training store (62 feature-complete rows, n=29 riders) CONFIRMS the 06-16
//  vol-inversion, starkly: every at-entry VOLATILITY proxy is INVERTED vs realized R —
//  RIDE-only evMargin lo +0.30R → hi −0.40R, atr +0.29 → −0.40, gap +0.10 → −0.32. High-vol
//  0DTE entries get whipsawed into the −50% stop; low-vol entries ride cleaner. So the desk's
//  first conviction probe (gap-sizing #3) was refuted because it sized UP on big gaps — the
//  WRONG SIGN. This tests the correctly-signed model: size DOWN on high vol / UP on low vol.
//
//  Pure sizing (entry set fixed at the live V3/ALT gap_min-0.25 gate), real Databento NBBO, the
//  worker cost model (0.25 tick), 5 regime windows + the TAIL (block-bootstrap p5 + maxDD —
//  sizing is multiplicative on a convex book, pooled mean alone lies). Signals: gap INVERTED
//  (the direct sign-flip of the refuted probe) + atr/close (era-normalized vol, z-scored).
//
//    npm run inv-conviction-probe
//
//  PASS bar (same as gap-sizing): a variant holds-or-improves total in EVERY window AND does NOT
//  worsen the tail (maxDD + boot-p5) AND actually MOVED size (Σcontracts differ). Fail/mixed ⇒
//  the inversion isn't a deployable sizing lever (the cost-gate veto is the conviction layer).
//  Even a PASS graduates to the paper-lab, never armed on backtest alone.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { buildSizingModel, scalarFor, type SizingFeatures, type SizingSpec } from "./sizing";
import type { ChainProvider } from "./optionsource";
import type { Bar, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec, Condition } from "../lib/desk/strategySpec";

const RISK = 500;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "iv", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

function entrySpec(withMom: boolean, gapMin = 0.25): StrategySpec {
  const leg = (side: "above" | "below", brk: "break_above" | "break_below"): Condition[] => [
    { kind: "opening_range", side: brk, minutes: 30 }, { kind: "vwap_side", side },
    ...(withMom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as Condition] : []),
    { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }, { kind: "gap_min", pct: gapMin },
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

const etDay = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
function dailyPnl(trades: Trade[]): number[] {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(etDay(t.exitTs), (byDay.get(etDay(t.exitTs)) ?? 0) + t.pnl);
  return [...byDay.keys()].sort().map((d) => byDay.get(d)!);
}
function maxDrawdown(daily: number[]): number { let cum = 0, peak = 0, dd = 0; for (const p of daily) { cum += p; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); } return dd; }
function bootP5(daily: number[]): number {
  const n = daily.length, B = 5, paths = 1500, t: number[] = [];
  if (!n) return 0;
  for (let p = 0; p < paths; p++) { let seed = (p * 2654435761 + 1) >>> 0; const r = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; }; let sum = 0, l = 0; while (l < n) { const st = Math.floor(r() * n); for (let k = 0; k < B && l < n; k++) { sum += daily[(st + k) % n]; l++; } } t.push(sum); }
  t.sort((a, b) => a - b); return t[Math.floor(0.05 * (t.length - 1))];
}
const sgn = (v: number) => (v >= 0 ? "+" : "") + Math.round(v);

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 1200 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);

  // inject era-normalized vol (atr/close) + |gap| into the sizing features
  const inject = (f: SizingFeatures, s: RealSession): SizingFeatures => ({ ...f, gap: s.gap, absGap: Math.abs(s.gap), atrPct: f.close > 0 ? f.atr / f.close : 0 });
  const sizingFor = (spec: SizingSpec | null, s: RealSession): ((f: SizingFeatures) => number) | undefined => {
    const built = buildSizingModel(spec);
    return built ? (f) => scalarFor(built, inject(f, s)) : undefined;
  };

  // ── PRE-PASS: collect atrPct over the actual V3 entry population → μ/σ for the z-scored model ──
  const atrPcts: number[] = [];
  const recorder = (f: SizingFeatures, s: RealSession) => { const i = inject(f, s); if (Number.isFinite(i.atrPct)) atrPcts.push(i.atrPct); return 1.0; };
  for (const s of real) simulateSession(s.bars, CFG, FUND, makeEval(false)(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE, (f) => recorder(f, s));
  const mean = atrPcts.reduce((a, b) => a + b, 0) / (atrPcts.length || 1);
  const sd = Math.sqrt(atrPcts.reduce((a, b) => a + (b - mean) ** 2, 0) / (atrPcts.length || 1)) || 1;
  console.log(`\n  atrPct (atr/close) over ${atrPcts.length} V3 entries — mean ${(mean * 100).toFixed(3)}% · sd ${(sd * 100).toFixed(3)}%`);

  // ── variants: gap INVERTED (sign-flip of the refuted probe) + atrPct INVERTED (z-scored linear) ──
  const VARIANTS: { label: string; spec: SizingSpec | null }[] = [
    { label: "flat (base)", spec: null },
    { label: "inv-gap 0.8/1.2", spec: { kind: "rules", default: 1.0, clamp: [0.5, 2.0], rules: [{ key: "absGap", op: ">=", value: 0.5, scalar: 0.8 }, { key: "absGap", op: "<", value: 0.35, scalar: 1.2 }] } },
    { label: "inv-gap 0.6/1.4", spec: { kind: "rules", default: 1.0, clamp: [0.5, 2.0], rules: [{ key: "absGap", op: ">=", value: 0.5, scalar: 0.6 }, { key: "absGap", op: "<", value: 0.35, scalar: 1.4 }] } },
    { label: "inv-atr W0.3", spec: { kind: "linear", clamp: [0.5, 2.0], intercept: 1.0, link: "identity", terms: [{ key: "atrPct", weight: -0.3, mean, sd }] } },
    { label: "inv-atr W0.5", spec: { kind: "linear", clamp: [0.5, 2.0], intercept: 1.0, link: "identity", terms: [{ key: "atrPct", weight: -0.5, mean, sd }] } },
  ];

  const runWin = (withMom: boolean, spec: SizingSpec | null, from: string, to: string) => {
    const mk = makeEval(withMom);
    const ws = real.filter((s) => s.dateET >= from && s.dateET <= to);
    const trades = ws.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE, sizingFor(spec, s)));
    const daily = dailyPnl(trades);
    const m = metrics(trades, ws.length);
    return { n: trades.length, total: m.totalPnl, dd: maxDrawdown(daily), p5: bootP5(daily), qty: trades.reduce((a, t) => a + t.qty, 0) };
  };

  for (const withMom of [false, true]) {
    const ch = withMom ? "BREAK(ALT)" : "BREAK(ALT V3)";
    console.log(`\n═══ ${ch} · INVERTED-vol SIZING (entry set fixed at gap_min 0.25) · real NBBO · 5-window + tail ═══`);
    console.log(`window        ` + VARIANTS.map((v) => v.label.padStart(18)).join(""));
    const pooled = VARIANTS.map(() => ({ total: 0, dd: 0, p5: 0, qty: 0 }));
    const holds = VARIANTS.map(() => ({ better: 0 }));
    const perWin: number[][] = VARIANTS.map(() => []);
    for (const w of WINDOWS) {
      const cells = VARIANTS.map((v) => runWin(withMom, v.spec, w.from, w.to));
      const base = cells[0];
      cells.forEach((c, i) => { pooled[i].total += c.total; pooled[i].dd += c.dd; pooled[i].qty += c.qty; perWin[i].push(c.total); if (i > 0 && c.total >= base.total - 1) holds[i].better++; });
      console.log(`${(w.key + ` n${base.n}`).padEnd(14)}` + cells.map((c) => `${sgn(c.total)}/dd${Math.round(c.dd)}`.padStart(18)).join(""));
    }
    // pooled boot-p5 over the concatenated daily series of all windows (the real tail)
    const pooledDaily = VARIANTS.map((v) => WINDOWS.flatMap((w) => dailyPnl(real.filter((s) => s.dateET >= w.from && s.dateET <= w.to).flatMap((s) => simulateSession(s.bars, CFG, FUND, makeEval(withMom)(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE, sizingFor(v.spec, s))))));
    console.log(`${"POOLED".padEnd(14)}` + pooled.map((p) => `${sgn(p.total)}/dd${Math.round(p.dd)}`.padStart(18)).join(""));
    console.log(`${"boot-p5".padEnd(14)}` + pooledDaily.map((d) => sgn(bootP5(d)).padStart(18)).join("") + "   ← tail (higher=better)");
    console.log(`${"Σcontracts".padEnd(14)}` + pooled.map((p) => String(p.qty).padStart(18)).join("") + "   ← moved size iff differ");
    VARIANTS.forEach((v, i) => {
      if (i === 0) return;
      const movedSize = pooled[i].qty !== pooled[0].qty;
      const tailOk = bootP5(pooledDaily[i]) >= bootP5(pooledDaily[0]) - 1 && pooled[i].dd >= pooled[0].dd - 1;
      const pass = holds[i].better === WINDOWS.length && tailOk && movedSize && pooled[i].total > pooled[0].total;
      console.log(`  ${v.label}: holds/improves ${holds[i].better}/${WINDOWS.length} · pooled Δ ${sgn(pooled[i].total - pooled[0].total)} · tail ${tailOk ? "intact" : "WORSE"} · ${movedSize ? "size moved" : "INERT"}${pass ? "  ✅ PASS" : "  ✗"}`);
    });
  }
  console.log(`\n  READ: this is the CORRECTLY-SIGNED conviction test (the refuted gap-sizing probe sized UP on vol; this sizes DOWN).`);
  console.log(`  PASS = holds/improves EVERY window + tail intact + size actually moved. A pooled lift that fails a window or worsens`);
  console.log(`  the tail = the inversion isn't a robust sizing lever (the cost-gate veto stays the conviction layer). Paper-lab, never backtest-armed.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
