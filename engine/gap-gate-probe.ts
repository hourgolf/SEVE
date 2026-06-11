// ============================================================================
//  gap-gate-probe — does the gap-magnitude regime signal SURVIVE verification?
//  (2026-06-11, the gap-regime follow-up.) gap-regime-probe found flat-open days
//  bleed and gap days pay for the breakout family (pooled). Two gates it must pass
//  before it's believable — the same bar that killed the or_width_min floor:
//
//   A. 5-WINDOW robustness — gate "trade only when |gap| ≥ thr", sweep the
//      threshold, require it lifts pooled exp$/t AND helps/neutral in ≥4/5
//      regime windows (not one fat gap-up window carrying it). Watch the trade
//      count — a gate that cuts most trades for a marginal lift is the mirage.
//   B. INDEPENDENCE vs OR width — a flat open likely CAUSES a narrow opening
//      range, and narrow ORs already bleed (orb-width-verdict). So is the gap a
//      NEW signal or the same chop days re-found? corr(|gap|, OR-width) + a 2×2
//      of exp$/t by (gap: flat/gappy) × (width: narrow/wide). If gappy>flat holds
//      WITHIN each width column, gap adds independent signal; if it vanishes once
//      width is fixed, it's redundant.
//
//    npm run gap-gate-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "gap", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };

const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
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
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const winOf = (date: string) => WINDOWS.find((w) => date >= w.from && date <= w.to)?.name ?? null;

interface TT { pnl: number; optType: string; gap: number; width: number; win: string | null }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  const allSorted = [...sessions].sort((a, b) => a.dateET.localeCompare(b.dateET));
  const priorClose = new Map<string, number>();
  for (let i = 1; i < allSorted.length; i++) priorClose.set(allSorted[i].dateET, allSorted[i - 1].bars[allSorted[i - 1].bars.length - 1].close);
  const ctx = new Map<string, { gap: number; width: number }>();
  for (const s of real) {
    const pc = priorClose.get(s.dateET); if (pc == null) continue;
    const open = s.bars[0].open;
    const first30 = s.bars.slice(0, 30);
    ctx.set(s.dateET, { gap: ((open - pc) / pc) * 100, width: ((Math.max(...first30.map((b) => b.high)) - Math.min(...first30.map((b) => b.low))) / open) * 100 });
  }
  const withCtx = real.filter((s) => ctx.has(s.dateET));

  // tag every trade with (gap, width, window) — one run per channel, then slice.
  const tagChannel = (mk: (s: RealSession) => Evaluate): TT[] => {
    const out: TT[] = [];
    for (const s of withCtx) {
      const c = ctx.get(s.dateET)!;
      for (const t of simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE))
        out.push({ pnl: t.pnl, optType: t.optType, gap: c.gap, width: c.width, win: winOf(s.dateET) });
    }
    return out;
  };
  const channels: Array<[string, TT[]]> = [["ALT", tagChannel(evalOf(ALT, "15:25"))], ["V3", tagChannel(evalOf(V3, "15:25"))], ["ORB", tagChannel(evalOf(ORB, "15:30"))]];

  // ---- A. 5-window robustness of the |gap| gate ----
  console.log(`\n  GAP-GATE verification · breakout family · real NBBO · ${withCtx.length} SPY sessions\n`);
  console.log(`  ══ A. 5-WINDOW robustness — gate: trade only when |gap| ≥ thr ══`);
  const thrs = [0, 0.15, 0.25, 0.35];
  for (const [name, tt] of channels.filter(([n]) => n !== "ORB")) {
    console.log(`  ${name}:   gate     exp$/t    n` + WINDOWS.map((w) => w.name.slice(0, 11).padStart(13)).join(""));
    for (const thr of thrs) {
      const set = tt.filter((x) => Math.abs(x.gap) >= thr);
      const exp = mean(set.map((x) => x.pnl));
      const per = WINDOWS.map((w) => { const ws = set.filter((x) => x.win === w.name); return ws.length ? `${sgn(mean(ws.map((x) => x.pnl)))}${mean(ws.map((x) => x.pnl)).toFixed(0)}` : "—"; });
      console.log(`        ${(thr === 0 ? "all" : `≥${thr}%`).padStart(7)}  ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(set.length).padStart(4)}` + per.map((p) => p.padStart(13)).join(""));
    }
    console.log("");
  }

  // ---- B. independence vs OR width ----
  const pooled = channels.flatMap(([, tt]) => tt);
  const gx = pooled.map((x) => Math.abs(x.gap)), wy = pooled.map((x) => x.width);
  const mx = mean(gx), mw = mean(wy);
  const sd = (xs: number[], m: number) => Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
  const corr = mean(pooled.map((x) => (Math.abs(x.gap) - mx) * (x.width - mw))) / (sd(gx, mx) * sd(wy, mw));
  const wMed = median(withCtx.map((s) => ctx.get(s.dateET)!.width));
  console.log(`  ══ B. INDEPENDENCE vs OR width (pooled ALT+V3+ORB, ${pooled.length} trades) ══`);
  console.log(`  corr(|gap|, OR-width) = ${corr.toFixed(2)}   (high ⇒ proxies; low ⇒ independent) · width split at median ${wMed.toFixed(2)}%`);
  console.log(`  2×2 exp$/t (n):            narrow OR (<${wMed.toFixed(2)}%)        wide OR (≥${wMed.toFixed(2)}%)`);
  for (const [gl, gp] of [["flat |gap|<0.25%", (x: TT) => Math.abs(x.gap) < 0.25], ["gappy |gap|≥0.25%", (x: TT) => Math.abs(x.gap) >= 0.25]] as Array<[string, (x: TT) => boolean]>) {
    const cell = (wide: boolean) => { const set = pooled.filter((x) => gp(x) && (x.width >= wMed) === wide); return set.length ? `${sgn(mean(set.map((x) => x.pnl)))}${mean(set.map((x) => x.pnl)).toFixed(0)}/t (${set.length})` : "—"; };
    console.log(`  ${gl.padEnd(22)} ${cell(false).padStart(20)} ${cell(true).padStart(20)}`);
  }
  console.log(`\n  READ: gap is REAL+independent if (A) a gate holds ≥4/5 windows + lifts exp$/t AND (B) gappy>flat`);
  console.log(`  within BOTH width columns. Redundant if the 2×2 gap rows converge once width is fixed (corr high).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
