// ============================================================================
//  orb-voldef-probe — VOLATILITY-DEFINED opening range (2026-06-11, the one open
//  idea from the ORB-width thread). The operator's instinct, properly built:
//  WIDTH governs how much runway is left, so fix the WIDTH and let the TIME float
//  — instead of a fixed 30-min window that produces a variable, sometimes-spent
//  range. A fast morning establishes a narrow range EARLY (entry with runway); a
//  quiet morning may never reach the width → no trade (the chop filter, for free).
//
//  Method: the engine hardcodes the 30-min OR, so this runs a CUSTOM breakout
//  evaluator through simulateSession (identical entry gates / −50% stop / EOD
//  flatten / real-NBBO fills) and varies ONLY the OR definition:
//   · TIME-30 / TIME-15 — fixed-time baselines (TIME-30 ≈ the live ORB).
//   · WIDTH-W% — freeze hi/lo the bar the range since open first reaches W% of
//     spot (sweep 0.30–0.60%); skip the day if it never reaches W by 90 min.
//  Gates mirror the live ORB spec (vwap_side · |mom|≥0.3·ATR · relVol≥1.3 · no
//  entry in the last hour). Same harness → the OR definition is the only variable.
//
//  READ: the idea earns a build only if a WIDTH-W beats TIME-30 on pooled exp$/t
//  AND holds the 5-window bar (≥4/5) — the same gate that just refuted the
//  or_width_min floor. Watch the establish-minute + skip count: a width that only
//  ever fires on the already-volatile days is just the trend-day filter in disguise.
//
//    npm run orb-voldef-probe
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, Intent, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "orb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const P = { breakAtr: 0.5, volMult: 1.3, momConfirm: 0.3, flattenMtc: 35, lastEntryMtc: 60 };

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

// ---- OR definitions: return {hi, lo, idx (establish bar), atEstablish (minute)} or null ----
interface OR { hi: number; lo: number; idx: number }
const timeOR = (bars: Bar[], n: number): OR | null => {
  if (bars.length < n) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = 0; j < n; j++) { hi = Math.max(hi, bars[j].high); lo = Math.min(lo, bars[j].low); }
  return { hi, lo, idx: n - 1 };
};
const widthOR = (bars: Bar[], wPct: number, maxIdx = 90): OR | null => {
  const open = bars[0].open;
  let hi = bars[0].high, lo = bars[0].low;
  for (let i = 0; i < Math.min(bars.length, maxIdx); i++) {
    hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low);
    if (((hi - lo) / open) * 100 >= wPct) return { hi, lo, idx: i }; // freeze the instant width W is reached
  }
  return null; // never reached W by maxIdx → too quiet, skip
};

// Custom breakout evaluator over a precomputed OR (gates mirror the live ORB spec).
const makeEval = (or: OR | null): Evaluate => (f, pos): Intent => {
  if (pos) return f.minutesToClose <= P.flattenMtc ? { kind: "exit", reason: "eod_flatten" } : null; // ride; −50% stop is simulateSession's
  if (!or) return null;
  if (f.minute < or.idx) return null;                  // OR not established yet
  if (f.minutesToClose <= P.lastEntryMtc) return null; // ≈ time_before 15:00
  if (f.atr <= 0 || f.relVol < P.volMult) return null;
  const up = f.close > or.hi + P.breakAtr * f.atr && f.mom > P.momConfirm * f.atr && f.close > f.vwap;
  const dn = f.close < or.lo - P.breakAtr * f.atr && f.mom < -P.momConfirm * f.atr && f.close < f.vwap;
  if (up) return { kind: "enter", direction: "call", reason: "orb_up" };
  if (dn) return { kind: "enter", direction: "put", reason: "orb_dn" };
  return null;
};

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), "SPY") as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0 && s.bars.length >= 90);
  const chainOf = (s: RealSession): ChainProvider => makeDatabentoChain(byDay.get(s.dateET) as Parameters<typeof makeDatabentoChain>[0]);
  const run = (orFn: (b: Bar[]) => OR | null, set: RealSession[]): Trade[] =>
    set.flatMap((s) => simulateSession(s.bars, CFG, FUND, makeEval(orFn(s.bars)), chainOf(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE));

  const variants: Array<{ name: string; fn: (b: Bar[]) => OR | null; width?: number }> = [
    { name: "TIME-30 (≈live ORB)", fn: (b) => timeOR(b, 30) },
    { name: "TIME-15", fn: (b) => timeOR(b, 15) },
    { name: "WIDTH-0.30%", fn: (b) => widthOR(b, 0.30), width: 0.30 },
    { name: "WIDTH-0.40%", fn: (b) => widthOR(b, 0.40), width: 0.40 },
    { name: "WIDTH-0.50%", fn: (b) => widthOR(b, 0.50), width: 0.50 },
    { name: "WIDTH-0.60%", fn: (b) => widthOR(b, 0.60), width: 0.60 },
  ];

  console.log(`\n  ORB VOL-DEFINED OR · custom breakout (live gates · −50% stop · cost gate) · real NBBO · ${real.length} SPY sessions`);
  console.log(`  fixed-WIDTH freezes hi/lo when the range first reaches W% (time floats); skip if never by 90 min.\n`);
  console.log(`  variant               exp$/t    n   win%   estMin  skip%     pooled$` + WINDOWS.map((w) => w.name.slice(0, 11).padStart(13)).join(""));
  for (const v of variants) {
    const all = run(v.fn, real);
    const m = metrics(all, real.length);
    const exp = all.length ? m.totalPnl / all.length : 0;
    const winPct = all.length ? (100 * all.filter((t) => t.pnl > 0).length) / all.length : 0;
    // establish-minute + skip% (width variants only): how early it freezes, how often it never fires
    let estMin = "—", skip = "—";
    if (v.width != null) {
      const ors = real.map((s) => widthOR(s.bars, v.width!));
      const est = ors.filter((o): o is OR => o != null).map((o) => o.idx);
      estMin = est.length ? Math.round(est.reduce((a, x) => a + x, 0) / est.length).toString() : "—";
      skip = `${Math.round((100 * ors.filter((o) => o == null).length) / real.length)}%`;
    }
    const per = WINDOWS.map((w) => Math.round(metrics(run(v.fn, real.filter((s) => s.dateET >= w.from && s.dateET <= w.to)), 1).totalPnl));
    console.log(`  ${v.name.padEnd(20)} ${`${sgn(exp)}${exp.toFixed(1)}`.padStart(7)} ${String(all.length).padStart(4)}  ${winPct.toFixed(0).padStart(3)}%   ${estMin.padStart(5)}  ${skip.padStart(5)}  ${`${sgn(m.totalPnl)}${Math.round(m.totalPnl)}`.padStart(9)}` + per.map((p) => `${sgn(p)}${p}`.padStart(13)).join(""));
  }
  console.log(`\n  READ: a WIDTH row earns a build only if it beats TIME-30 on pooled exp$/t AND holds ≥4/5 windows.`);
  console.log(`  High skip% + early estMin = it only fires on already-volatile days = the trend-day filter, not a better OR.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
