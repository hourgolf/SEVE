// ============================================================================
//  lever-probe — the RIGOROUS, RE-ENTRY-AWARE test of the forensics pattern-mine's
//  3 entry levers, applied as ENTRY GATES via simulateSession's leverGate. When a
//  lever blocks an entry the engine takes the NEXT valid entry (the freed one-at-a-
//  time slot), so this models the foul-out reality the capital-blind dataset replay
//  CANNOT — the honest test the desk's doctrine demands.
//
//  The 3 levers (true = BLOCK the entry):
//    sv  shallow-VWAP-displacement   dirVwapAtr = (call:+1/put:-1)·(close−vwap)/atr < 4
//    ha  MACD-hist-against            histRel    = (call:+1/put:-1)·macdHist < 0
//    wz  whipsaw zone                 er∈[0.10,0.20) AND atr≥0.40
//
//  ⚠ STANDING CAVEAT: the levers were mined on ONE month of mostly-chop/put-tape data.
//  This 5-window OOS backtest is a PRELIMINARY read on whether they GENERALIZE — the
//  forward accrual (worker 24e) is the real validator. A lever is interesting only if
//  it lifts Σ AND helps ≥4/5 windows (regime-wide, not a single-window mirage).
//
//    npm run lever-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { STRATEGY_REGISTRY } from "./registry";
import { computeFeatures } from "./engine";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const cfgOf = (maxC: number): StrategistConfig => ({ slug: "lp", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };               // audited 1-tick fill
const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // live 0.25 gate

const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"], timeET: string) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET }], sizing: {}, entries });
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
const V3 = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", false) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", false) }];
const ALT = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", true) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", true) }];
const reg = (slug: string) => (s: RealSession) => STRATEGY_REGISTRY[slug].build(s.bars as Bar[], 1);

type Ch = { name: string; dte: 0 | 1; maxC: number; mk: (s: RealSession) => Evaluate; px: { profitPct?: number; stopPct?: number } };
const CH: Ch[] = [ // the directional book the entry levers apply to (each at its live exit)
  { name: "BREAK(ALT V3)", dte: 0, maxC: 6, mk: specEval(V3, "15:25"), px: { profitPct: 100, stopPct: 50 } },
  { name: "BREAK(ALT)",    dte: 0, maxC: 6, mk: specEval(ALT, "15:25"), px: { profitPct: 100, stopPct: 50 } },
  { name: "PB RIDER 1DTE", dte: 1, maxC: 4, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS), px: { stopPct: 50 } },
  { name: "ORB(breakout)", dte: 0, maxC: 6, mk: reg("breakout"), px: { stopPct: 50 } },
  { name: "POWERHOUR",     dte: 0, maxC: 6, mk: reg("power"), px: { stopPct: 50 } },
  { name: "POWER Final30", dte: 0, maxC: 6, mk: reg("power-final30"), px: { stopPct: 50 } },
  { name: "GRIND v3",      dte: 0, maxC: 6, mk: reg("grind-v3"), px: { stopPct: 50 } },
  { name: "GRIND(base)",   dte: 0, maxC: 6, mk: reg("grind"), px: { stopPct: 50 } },
];

type LG = (f: ReturnType<typeof computeFeatures>, dir: "call" | "put", mh: number | null) => boolean;
const mkGate = (keys: string[]): LG => (f, dir, mh) => {
  const dvA = f.atr > 0 ? (dir === "call" ? f.close - f.vwap : f.vwap - f.close) / f.atr : 0;
  const hr = (dir === "call" ? 1 : -1) * (mh ?? 0);
  const wz = f.er >= 0.10 && f.er < 0.20 && f.atr >= 0.40;
  return (keys.includes("sv") && dvA < 4) || (keys.includes("ha") && hr < 0) || (keys.includes("wz") && wz);
};
const LEVERS: Array<{ key: string; g?: LG }> = [
  { key: "base" }, { key: "+VWAP", g: mkGate(["sv"]) }, { key: "+MACD", g: mkGate(["ha"]) },
  { key: "+whip", g: mkGate(["wz"]) }, { key: "+all", g: mkGate(["sv", "ha", "wz"]) },
];

const WINDOWS = [
  { name: "CHOP Mar26",    from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26",from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25",from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",      from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26",from: "2025-11-01", to: "2026-02-28" },
];
const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)?.name ?? null;
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET); return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90; });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };

  console.log(`\n  LEVER-PROBE · ${real.length} SPY sessions (real NBBO) · RE-ENTRY-AWARE leverGate · FAITHFUL (live 0.25 gate + 1-tick fills) · RISK ${RISK}/stop ${DAILY_STOP}`);
  console.log(`  each lever GATES entries (blocked → engine re-enters next valid signal); Σ P&L vs base + how many of the 5 OOS windows it HELPS\n`);
  console.log(`  ⚠ levers were mined on ONE month of chop/put-tape — a lever is REAL only if it lifts Σ AND helps ≥4/5 windows (else single-window mirage).\n`);

  for (const ch of CH) {
    const cfg = cfgOf(ch.maxC);
    const perLever = LEVERS.map((L) => {
      let tot = 0, n = 0; const byWin = new Map<string, number>();
      for (const s of real) {
        const exp = ch.dte === 0 ? s.dateET : nextOf.get(s.dateET); if (!exp) continue;
        const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), chainFor(s, exp), false, ch.px, FILL_1T,
          undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
          undefined, undefined, undefined, undefined, L.g);
        const p = ts.reduce((a, x) => a + x.pnl, 0); tot += p; n += ts.length;
        const w = winOf(s.dateET); if (w) byWin.set(w, (byWin.get(w) ?? 0) + p);
      }
      return { key: L.key, tot, n, byWin };
    });
    const base = perLever[0];
    console.log(`  ${ch.name.padEnd(15)} base ${usd(base.tot).padStart(8)} (${base.n}t)`);
    for (const L of perLever.slice(1)) {
      let helped = 0; for (const W of WINDOWS) { if ((L.byWin.get(W.name) ?? 0) > (base.byWin.get(W.name) ?? 0)) helped++; }
      const flag = L.tot > base.tot && helped >= 4 ? "  ⭐ROBUST" : L.tot > base.tot ? "  (lifts Σ, not OOS-robust)" : "";
      console.log(`     ${L.key.padEnd(6)} ${usd(L.tot).padStart(8)}  Δ ${usd(L.tot - base.tot).padStart(8)}  (${L.n}t)  helps ${helped}/5${flag}`);
    }
  }
  console.log(`\n  READ: ⭐ROBUST = lifts pooled Σ AND beats base in ≥4/5 OOS windows. Anything else is a forward-test candidate at best.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
