// ============================================================================
//  ema-stretch-probe — does ENTRY DISTANCE FROM THE EMA BAND predict outcomes?
//  (2026-06-12, operator's chart-read: "our channels buy at the top of moves
//  with resistance written all over it" — price visibly respects the 9/21/50
//  EMA ribbon, and entries far above it look like they're buying exhaustion.)
//
//  Code fact: channels are EMA-BAND-BLIND — Features has no EMA; the vocab has
//  ma_cross/macd (cross EVENTS) but nothing measures distance-to-band. So this
//  tests whether that blindness costs money on the breakout family.
//
//  Measures at each trade's ENTRY bar (1-min session bars, cum-session EMAs):
//    stretch21 / stretch50 = directional distance from EMA21/EMA50 in ATR units
//      (calls: (close−ema)/atr · puts: (ema−close)/atr — positive = stretched
//      in the trade's direction, i.e. "chasing")
//    ribbon = EMA9 vs EMA21 alignment with the trade direction (trend stack)
//
//  A. DIAGNOSTIC buckets (pooled, hypothesis-generator): exp$/t by stretch.
//  B. PRE-REGISTERED gates × the 5-window arm bar (helps/neutral ≥4/5 AND lifts
//     pooled exp$/t AND total P&L doesn't collapse — the gap_min standard):
//      G1a don't-chase: block entry if stretch21 > 1.5 ATR
//      G1b don't-chase: block entry if stretch21 > 2.0 ATR
//      G2  ribbon-only: require EMA9 aligned with trade direction vs EMA21
//
//  Baselines are the AS-ARMED configs (V3/ALT carry gap_min 0.25 + →14:00) —
//  the question is residual geometry signal BEYOND the armed regime gate.
//  PRIOR: the level-gate graveyard (rides want structure crossings) says these
//  gates likely trim the entries that explode. The probe settles it.
//
//    npm run ema-stretch-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { ema } from "../lib/indicators";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "ema", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "u", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const evalOf = (entries: StrategySpec["entries"], timeET: string) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);

type GateFn = ((dir: "call" | "put", i: number, e9: number[], e21: number[], atr: number, close: number) => boolean) | null; // true = allow
const stretchOf = (dir: "call" | "put", close: number, emaV: number, atr: number) =>
  atr > 0 ? (dir === "call" ? (close - emaV) : (emaV - close)) / atr : 0;
const G_CHASE = (lim: number): GateFn => (dir, i, _e9, e21, atr, close) => stretchOf(dir, close, e21[i], atr) <= lim;
const G_RIBBON: GateFn = (dir, i, e9, e21) => (dir === "call" ? e9[i] >= e21[i] : e9[i] <= e21[i]);

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  const emaCache = new Map<string, { e9: number[]; e21: number[]; e50: number[] }>();
  const emasOf = (s: RealSession) => {
    let c = emaCache.get(s.dateET);
    if (!c) { const closes = s.bars.map((b) => b.close); c = { e9: ema(closes, 9), e21: ema(closes, 21), e50: ema(closes, 50) }; emaCache.set(s.dateET, c); }
    return c;
  };
  const gated = (mk: (s: RealSession) => Evaluate, gate: GateFn) => (s: RealSession): Evaluate => {
    const e = mk(s); const { e9, e21 } = emasOf(s);
    return (f, pos) => {
      const it = e(f, pos);
      if (!gate || it?.kind !== "enter" || !it.direction) return it;
      return gate(it.direction, f.minute, e9, e21, f.atr, f.close) ? it : null;
    };
  };
  const run = (mk: (s: RealSession) => Evaluate, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  const CH: Array<[string, (s: RealSession) => Evaluate]> = [["V3 (as-armed)", evalOf(V3, "15:25")], ["ALT (as-armed)", evalOf(ALT, "15:25")], ["ORB (as-live)", evalOf(ORB, "15:30")]];

  // ---- A. diagnostic: bucket baseline trades by entry stretch vs EMA21 ----
  console.log(`\n  EMA-STRETCH probe · entry distance from the EMA band, in ATR units · real NBBO · ${real.length} SPY sessions`);
  console.log(`  stretch = directional (close − EMA21)/ATR at the entry bar (positive = chasing in trade direction)\n`);
  console.log(`  ══ A. DIAGNOSTIC — pooled exp$/t by entry stretch (hypothesis-generator) ══`);
  interface TT { pnl: number; s21: number; s50: number; aligned: boolean }
  const allTagged = new Map<string, TT[]>();
  for (const [name, mk] of CH) {
    const tagged: TT[] = [];
    for (const s of real) {
      const { e9, e21, e50 } = emasOf(s);
      const idxByTs = new Map(s.bars.map((b, i) => [b.ts, i]));
      // ATR(14) exactly as engine.ts computes it — the gate and the buckets must share the scale
      const atrAt = (i: number) => { let sum = 0, n = 0; for (let j = Math.max(0, i - 13); j <= i; j++) { sum += s.bars[j].high - s.bars[j].low; n++; } return Math.max(1e-9, sum / n); };
      for (const t of run(mk, [s])) {
        const i = idxByTs.get(t.entryTs); if (i == null) continue;
        tagged.push({
          pnl: t.pnl,
          s21: stretchOf(t.optType, s.bars[i].close, e21[i], atrAt(i)),
          s50: stretchOf(t.optType, s.bars[i].close, e50[i], atrAt(i)),
          aligned: t.optType === "call" ? e9[i] >= e21[i] : e9[i] <= e21[i],
        });
      }
    }
    allTagged.set(name, tagged);
    const buckets: Array<[string, (x: TT) => boolean]> = [
      ["<1 ATR", (x) => x.s21 < 1], ["1–2 ATR", (x) => x.s21 >= 1 && x.s21 < 2],
      ["2–3 ATR", (x) => x.s21 >= 2 && x.s21 < 3], ["≥3 ATR (chasing)", (x) => x.s21 >= 3],
    ];
    const cells = buckets.map(([lbl, p]) => { const set = tagged.filter(p); return set.length ? `${lbl} ${sgn(mean(set.map((x) => x.pnl)))}${mean(set.map((x) => x.pnl)).toFixed(0)}/t (${set.length})` : `${lbl} —`; });
    const al = tagged.filter((x) => x.aligned), na = tagged.filter((x) => !x.aligned);
    console.log(`  ${name.padEnd(15)} ${cells.join("  ·  ")}`);
    console.log(`  ${"".padEnd(15)} ribbon-aligned ${al.length ? sgn(mean(al.map((x) => x.pnl))) + mean(al.map((x) => x.pnl)).toFixed(0) : "—"}/t (${al.length})  ·  counter-ribbon ${na.length ? sgn(mean(na.map((x) => x.pnl))) + mean(na.map((x) => x.pnl)).toFixed(0) : "—"}/t (${na.length})`);
  }

  // ---- B. pre-registered gates × the 5-window bar ----
  console.log(`\n  ══ B. GATES (pre-registered) — the arm bar: ≥4/5 windows helped/neutral AND pooled exp$/t up AND total holds ══`);
  const variants: Array<[string, GateFn]> = [["baseline", null], ["G1a chase>1.5 blocked", G_CHASE(1.5)], ["G1b chase>2.0 blocked", G_CHASE(2.0)], ["G2 ribbon-aligned only", G_RIBBON]];
  for (const [name, mk] of CH) {
    console.log(`  ${name}`);
    console.log(`    variant                 exp$/t    n     pooled$` + WINDOWS.map((w) => w.name.slice(0, 11).padStart(13)).join(""));
    for (const [vn, g] of variants) {
      const mkG = gated(mk, g);
      const all = run(mkG, real);
      const exp = all.length ? all.reduce((a, t) => a + t.pnl, 0) / all.length : 0;
      const tot = all.reduce((a, t) => a + t.pnl, 0);
      const per = WINDOWS.map((w) => Math.round(run(mkG, real.filter((s) => s.dateET >= w.from && s.dateET <= w.to)).reduce((a, t) => a + t.pnl, 0)));
      console.log(`    ${vn.padEnd(22)} ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)}  ${`${sgn(tot)}${Math.round(tot)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(13)).join(""));
    }
  }
  console.log(`\n  READ: the operator's eye is right if exp$/t DEGRADES with stretch (A) and a gate passes the full bar (B).`);
  console.log(`  The level-gate prior says the stretched entries ARE the momentum — refuted unless the data says otherwise.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
