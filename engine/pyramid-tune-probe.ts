// ============================================================================
//  pyramid-tune-probe — resolve the regime hole the adversarial review caught before any
//  live build. (2026-06-16.) pyramid-probe's "4/5 robust" hid TWO concerns: (1) pyramiding
//  made TREND-AprMay26 WORSE (ride −$201 → −$1,101) — the one window V3 has ~no edge, so adds
//  just amplify a small loss; (2) the pooled lift CONCENTRATES in CHOP-MIX (~half). The
//  convex-tail-concentration failure mode that buried gap-sizing. This sweeps minProfitPct
//  (add only to STRONGER winners) PER WINDOW with the tail (maxDD), asking: is there a
//  threshold that does NOT deepen the AprMay loss vs ride AND still beats ride on ≥4/5 windows
//  AND keeps the tail intact? If yes → worker shadow is worth building. If no → pyramiding is
//  conditional / parked. FAITHFUL cost (0.25 gate + 1-tick fills), live sizing, V3 + ALT.
//
//    npm run pyramid-tune-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const RISK = 500, DAILY_STOP = 500, RATIO = 3.0, MAX_ADDS = 3;
const FUND: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const cfgOf = (maxC: number): StrategistConfig => ({ slug: "pt", capital_pct: 100, aggression: 100, max_contracts: maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE_LIVE: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const specEval = (entries: StrategySpec["entries"]) => { const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries }); return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap }); };
const leg = (br: "break_above" | "break_below", side: "above" | "below", mom: boolean): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: br, minutes: 30 }, { kind: "vwap_side", side },
  ...(mom ? [{ kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 3 } as any] : []),
  { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }];
const V3 = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", false) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", false) }];
const ALT = [{ direction: "call" as const, reason: "u", all: leg("break_above", "above", true) }, { direction: "put" as const, reason: "d", all: leg("break_below", "below", true) }];
const CH = [{ name: "BREAK(ALT V3)", mk: specEval(V3) }, { name: "BREAK(ALT)", mk: specEval(ALT) }];
const THRESHOLDS = [null, 20, 30, 40, 50, 60, 75]; // null = RIDE

const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const maxDD = (s: number[]) => { let c = 0, p = 0, m = 0; for (const x of s) { c += x; p = Math.max(p, c); m = Math.min(m, c - p); } return m; };

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET); return !!cc && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to); });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;
  const cfg = cfgOf(6);

  console.log(`\n  PYRAMID-TUNE · ${real.length} SPY sessions · FAITHFUL gate · maxAdds ${MAX_ADDS} · sweep minProfitPct PER WINDOW`);
  console.log(`  the question: a threshold that does NOT deepen AprMay26 vs RIDE, still beats ride ≥4/5, tail intact?\n`);

  for (const ch of CH) {
    // per (threshold) → per-window Σ + per-window daily series for maxDD
    const byThr = THRESHOLDS.map((t) => {
      const win = new Map<string, number>(), daily = new Map<string, number[]>();
      for (const s of real) {
        const w = winOf(s.dateET);
        const pyr = t == null ? undefined : { maxAdds: MAX_ADDS, minProfitPct: t };
        const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s) as Evaluate, chainFor(s), false, { stopPct: 50 }, FILL_1T, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE }, undefined, pyr);
        const d = ts.reduce((a, x) => a + x.pnl, 0);
        win.set(w, (win.get(w) ?? 0) + d);
        daily.set(w, [...(daily.get(w) ?? []), d]);
      }
      return { t, win, daily };
    });
    const ride = byThr[0];
    console.log(`  ${ch.name} — per-window Σ (RIDE → minProfitPct sweep)`);
    console.log(`  window              ${THRESHOLDS.map((t) => (t == null ? "RIDE" : `+${t}%`).padStart(9)).join("")}`);
    for (const W of WINDOWS) {
      const cells = byThr.map((b) => usd(b.win.get(W.name) ?? 0).padStart(9)).join("");
      console.log(`  ${W.name.padEnd(18)}${cells}`);
    }
    // verdict per threshold: beats ride windows + AprMay not deepened + pooled + worst-window maxDD
    console.log(`  ── per threshold: windows-beating-ride / AprMay-vs-ride / pooled Σ / worst-window maxDD`);
    const aprName = "TREND AprMay26";
    for (let i = 1; i < byThr.length; i++) {
      const b = byThr[i];
      const beats = WINDOWS.filter((W) => (b.win.get(W.name) ?? 0) > (ride.win.get(W.name) ?? 0)).length;
      const apr = (b.win.get(aprName) ?? 0), aprRide = (ride.win.get(aprName) ?? 0);
      const pooled = WINDOWS.reduce((a, W) => a + (b.win.get(W.name) ?? 0), 0);
      const worstDD = Math.min(...WINDOWS.map((W) => maxDD(b.daily.get(W.name) ?? [])));
      const clean = beats >= 4 && apr >= aprRide;
      console.log(`     +${String(b.t).padEnd(3)}%  beats ${beats}/5  · AprMay ${usd(apr)} (ride ${usd(aprRide)}) ${apr >= aprRide ? "✓not-deepened" : "✗DEEPENS"}  · pooled ${usd(pooled).padStart(8)}  · worstDD ${usd(worstDD)}  ${clean ? "◀ CLEARS BAR" : ""}`);
    }
    const ridePooled = WINDOWS.reduce((a, W) => a + (ride.win.get(W.name) ?? 0), 0);
    console.log(`     RIDE pooled ${usd(ridePooled)}\n`);
  }
  console.log(`  READ: "CLEARS BAR" = beats ride on ≥4/5 windows AND does not deepen the no-edge AprMay window vs ride.`);
  console.log(`  If a threshold clears for BOTH V3+ALT → worker shadow is worth building at that minProfitPct. Else → conditional/park.\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
