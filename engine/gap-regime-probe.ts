// ============================================================================
//  gap-regime-probe — do our channels care about the OVERNIGHT GAP? (2026-06-11,
//  operator's question.) The features are gap-BLIND by construction: ATR =
//  intrabar (high−low) over session bars only (engine.ts), never the true-range
//  |open−priorClose|; ER/relVol/mom/VWAP reset at the open; the only backward
//  input is pdh/pdl as price levels. So the gap is invisible to volatility.
//  Two questions:
//   A. DIAGNOSTIC — how blind, and does it matter? median |gap|, how often the
//      gap exceeds the first-30-min ATR (= the day was more volatile than the
//      channel can "see" at entry), and corr(gap, intraday return) (gap-and-go
//      vs gap-fill — is the gap even directional information?).
//   B. P&L by gap — bucket the breakout family's trades (ORB / ALT / V3, real
//      NBBO ride) by signed gap (down ≤−0.25% / flat / up ≥+0.25%). Do gap days
//      pay differently? And for ALT: WITH-gap (trade dir == gap dir, "gap-and-go")
//      vs AGAINST-gap (fade) — the one tradeable angle a gap feature could add.
//
//  READ: if exp$/t is flat across gap buckets and corr(gap,ret)≈0, the gap is
//  noise → the session-to-session design is correct, gap-blindness costs nothing.
//  If a bucket (or with/against) separates, a gap feature/gate is worth a look.
//
//    npm run gap-regime-probe
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

const ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "14:00" }] },
];
const evalOf = (entries: StrategySpec["entries"], timeET: string) => {
  const spec: StrategySpec = { meta: { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"], exits: [{ timeET }], entries, sizing: {} };
  const def = specToStrategyDef(spec);
  return (s: RealSession) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
const sgn = (v: number) => (v >= 0 ? "+" : "");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);

  // ---- per-session gap, intraday ATR%, day return (gap uses prior RTH session close) ----
  const allSorted = [...sessions].sort((a, b) => a.dateET.localeCompare(b.dateET));
  const priorClose = new Map<string, number>();
  for (let i = 1; i < allSorted.length; i++) priorClose.set(allSorted[i].dateET, allSorted[i - 1].bars[allSorted[i - 1].bars.length - 1].close);
  interface G { gap: number; atr30: number; ret: number }
  const gOf = new Map<string, G>();
  for (const s of real) {
    const pc = priorClose.get(s.dateET); if (pc == null) continue;
    const open = s.bars[0].open;
    const gap = ((open - pc) / pc) * 100;
    const first30 = s.bars.slice(0, 30);
    const atr30 = (mean(first30.map((b) => b.high - b.low)) / open) * 100;
    const ret = ((s.bars[s.bars.length - 1].close - open) / open) * 100;
    gOf.set(s.dateET, { gap, atr30, ret });
  }
  const withGap = real.filter((s) => gOf.has(s.dateET));

  // ---- A. diagnostics ----
  const gaps = withGap.map((s) => gOf.get(s.dateET)!);
  const overAtr = gaps.filter((g) => Math.abs(g.gap) > g.atr30).length;
  // corr(gap, intraday return): does the gap point the day's way (go) or against (fill)?
  const gx = gaps.map((g) => g.gap), gy = gaps.map((g) => g.ret);
  const mx = mean(gx), my = mean(gy);
  const cov = mean(gaps.map((g) => (g.gap - mx) * (g.ret - my)));
  const sd = (xs: number[], m: number) => Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  const corr = cov / (sd(gx, mx) * sd(gy, my));
  console.log(`\n  GAP-REGIME probe · ${withGap.length} SPY sessions (real NBBO) · gap = (open − prior RTH close)/prior close\n`);
  console.log(`  ══ A. DIAGNOSTIC — how blind, does it matter? ══`);
  console.log(`  median |gap|        ${median(gaps.map((g) => Math.abs(g.gap))).toFixed(2)}%   ·   median first-30 ATR ${median(gaps.map((g) => g.atr30)).toFixed(2)}%`);
  console.log(`  |gap| > first-30 ATR on ${overAtr}/${gaps.length} days (${Math.round((100 * overAtr) / gaps.length)}%) — the overnight move the ATR can't see exceeded the intraday vol it does`);
  console.log(`  corr(gap, intraday return) = ${corr.toFixed(2)}   (>0 = gap-and-go · <0 = gap-fill · ≈0 = gap is noise for direction)`);

  // ---- B. P&L by signed gap bucket ----
  const buckets: Array<[string, (g: G) => boolean]> = [
    ["gap-down ≤−0.25%", (g) => g.gap <= -0.25],
    ["flat −0.25..+0.25%", (g) => g.gap > -0.25 && g.gap < 0.25],
    ["gap-up ≥+0.25%", (g) => g.gap >= 0.25],
  ];
  const channels: Array<[string, (s: RealSession) => Evaluate]> = [["ORB", evalOf(ORB, "15:30")], ["ALT", evalOf(ALT, "15:25")], ["V3", evalOf(V3, "15:25")]];
  const runTagged = (mk: (s: RealSession) => Evaluate): Array<{ t: Trade; g: G }> => {
    const out: Array<{ t: Trade; g: G }> = [];
    for (const s of withGap) { const g = gOf.get(s.dateET)!; for (const t of simulateSession(s.bars, CFG, FUND, mk(s), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE)) out.push({ t, g }); }
    return out;
  };
  console.log(`\n  ══ B. breakout-family P&L by signed gap (real NBBO ride) ══`);
  console.log(`  channel   ` + buckets.map(([n]) => n.padStart(22)).join(""));
  for (const [name, mk] of channels) {
    const tagged = runTagged(mk);
    const cells = buckets.map(([, pred]) => {
      const set = tagged.filter((x) => pred(x.g));
      if (!set.length) return "—";
      const exp = mean(set.map((x) => x.t.pnl));
      const win = (100 * set.filter((x) => x.t.pnl > 0).length) / set.length;
      return `${sgn(exp)}${exp.toFixed(0)}/t ${set.length}t ${win.toFixed(0)}%`;
    });
    console.log(`  ${name.padEnd(8)}` + cells.map((c) => c.padStart(22)).join(""));
  }

  // ---- C. ALT with-gap (gap-and-go) vs against-gap (fade) ----
  const alt = runTagged(evalOf(ALT, "15:25")).filter((x) => Math.abs(x.g.gap) >= 0.25);
  const withG = alt.filter((x) => (x.t.optType === "call" ? x.g.gap > 0 : x.g.gap < 0));
  const against = alt.filter((x) => (x.t.optType === "call" ? x.g.gap < 0 : x.g.gap > 0));
  const fmt = (set: typeof alt) => set.length ? `${sgn(mean(set.map((x) => x.t.pnl)))}${mean(set.map((x) => x.t.pnl)).toFixed(0)}/t · ${set.length}t · ${(100 * set.filter((x) => x.t.pnl > 0).length / set.length).toFixed(0)}% win` : "—";
  console.log(`\n  ══ C. ALT on gap days (|gap|≥0.25%): trade WITH the gap vs AGAINST it ══`);
  console.log(`  with-gap (gap-and-go):  ${fmt(withG)}`);
  console.log(`  against-gap (fade):     ${fmt(against)}`);
  console.log(`\n  READ: flat across B + corr≈0 ⇒ gap is noise, session-to-session is correct. A bucket or with/against`);
  console.log(`  split that separates ⇒ a gap feature (true-range ATR, or a gap-direction gate) is worth a probe.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
