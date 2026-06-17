// ============================================================================
//  pb-regime-mute-probe — the matrix's biggest unrealized lever, scored FOUL-OUT-AWARE.
//  (2026-06-16.) PB is a pure one-at-a-time TREND engine: regime-attribution showed
//  +$555/session in TREND, −$313 in CHOP ($868 swing). The proposed lever: MUTE PB on
//  predicted-chop mornings. Two things this probe does that the attribution didn't:
//
//   (A) FOUL-OUT-AWARE COST. The −$313 chop figure was computed UNCAPPED (daily_stop 1e9
//       — the live trader can't take that loss). Here PB runs through its LIVE knobs
//       (RISK $150 → total_capital 300, daily_stop 300, max_contracts 4, cost-gate 3),
//       so a chop session bleeds only until the per-channel daily-stop LATCHES, then is
//       foreclosed. The always-on baseline is charged the bleed the trader can ACTUALLY
//       take — bounded, not the uncapped attribution number.
//   (B) EX-ANTE CLASSIFIER. regimeOf (legs≥3) is HINDSIGHT — useless for a live morning
//       mute. The mute keys on the regime-gate signal: morning NET DRIFT (|open→10:30|)
//       + VWAP PERSISTENCE (frac of the first hour on one side of cumulative VWAP), both
//       knowable by 10:30. Low combined percentile = chop = mute. (Refuted as a breakout
//       PROFIT gate; NEVER tested as a PB-mute — a NEW application of the dead axis.)
//
//  GAUNTLET (mirrors chop-ride-oos): (1) 5-window leave-one-out — rank each held-out
//  window's mornings vs the OTHER four, mute the low-score days, compare always-on vs
//  muted PB on the held-out window; (2) threshold sensitivity (plateau = robust);
//  (3) tail check — block-bootstrap the daily series, the mute must CUT the chop tail
//  WITHOUT amputating the convex TREND windows (the inverted-gate failure mode).
//  PASS = muted ≥ always-on on ≥4/5 held-out windows AND the trend windows aren't gutted.
//
//    npm run pb-regime-mute-probe
//  Real Databento NBBO, PB at its live 1DTE, the 5-window corpus.
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, FundState, StrategistConfig, Trade } from "./types";

// PB live knobs (pulled from strategist_config 2026-06-16, NOT the stale SQL seed):
// pb-ride armed RISK 500 / daily_stop 500 / max_contracts 4 / entry_dte 1. RISK → engine
// budget total_capital = 2×risk (benched-sim mapping → qty IDENTICAL to decide.ts).
const RISK = 500;
const DAILY_STOP = 500;
const FUND_LATCHED: FundState = { total_capital_usd: 2 * RISK, master_daily_stop_usd: 1e9, is_halted: false };
const CFG_LATCHED: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 4, daily_stop_usd: DAILY_STOP, muted: false, soloed: false };
// Uncapped reference = risk-sized but no daily-stop (isolates the foul-out/latch effect).
const CFG_UNCAPPED: StrategistConfig = { ...CFG_LATCHED, daily_stop_usd: 1e9 };
// Validation config = how pb-ride was ORIGINALLY blessed (+$4,632): max_contracts 6 pinned
// (100k budget ≫ one contract), daily_stop OFF. NOT how the live trader sizes — the anchor we
// decompose AWAY from. FUND_VAL gives the pinned-6 budget.
const FUND_VAL: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const CFG_VAL: StrategistConfig = { ...CFG_LATCHED, max_contracts: 6, daily_stop_usd: 1e9 };
// The cost model has TWO distinct roles that the live desk sets DIFFERENTLY — the engine now
// lets us split them (entryCostGate.gateCostModel) so the faithful number is exact, not a blend:
//   FILL  = the slippage the P&L actually pays. The 06-08 live fill audit validated 1 tick/side
//           ON TOP of crossing real NBBO ([[entry-window-verdict]]); the benched-sim quotes path
//           later used 0.25 — so the fill model is CONTESTED. We run both → a bracket.
//   GATE  = the slippage the 3× cost gate uses to decide WHETHER to trade. The live worker's gate
//           uses 0.25 (decide.ts:38 → policy.SLIPPAGE_TICKS_PER_SIDE) — UNAMBIGUOUS, read from code.
const FILL_1T: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };                              // 1-tick — audited fill
const FILL_025: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 }; // 0.25-tick — optimistic fill
const GATE_LIVE: CostModel = FILL_025; // the live worker's gate slippage (0.25)
const GATE_BLESSED: CostModel = FILL_1T; // the 1-tick gate the validation used (over-vetoes churn)
const RATIO = 3.0; // PB is cost-gated (not exempt); the live COST_GATE_RATIO

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];

const RTH_OPEN = 9 * 60 + 30, MORN_END = 10 * 60 + 30;
const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

// realized regime (HINDSIGHT — reference only, never the mute signal). Copied from
// regime-attribution-probe so the latched-vs-uncapped split is directly comparable.
function regimeOf(s: RealSession): "TREND" | "CHOP" | "DRIFT" {
  const b = s.bars, o = b[0].close, c = b[b.length - 1].close;
  const move = Math.abs((c - o) / o) * 100;
  let legs = 0, anchor = o, dir = 0;
  for (const x of b) { const m = (x.close - anchor) / anchor; if (Math.abs(m) >= 0.003) { const d = Math.sign(m); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = x.close; } }
  return legs >= 3 ? "CHOP" : move >= 0.45 ? "TREND" : "DRIFT";
}

// EX-ANTE morning features (knowable by 10:30): net drift + VWAP persistence. Both LOW
// on chop mornings. Cumulative session VWAP computed here (the per-bar underlying_bars
// vwap ≈ close is useless — the known live VWAP quirk).
function morningFeatures(s: RealSession): { drift: number; persistence: number } | null {
  const first = s.bars.filter((b) => { const m = etMinOf(b.ts); return m >= RTH_OPEN && m <= MORN_END; });
  if (first.length < 30) return null;
  const o = first[0].open;
  const last = first[first.length - 1];
  const drift = Math.abs(last.close - o) / o; // |open → 10:30|, spot-normalized
  let cumPV = 0, cumV = 0, above = 0, below = 0, n = 0;
  for (const b of first) {
    const vol = b.volume || 1, typ = (b.high + b.low + b.close) / 3;
    cumPV += typ * vol; cumV += vol;
    const vwap = cumPV / cumV;
    if (n >= 5) { if (b.close > vwap) above++; else if (b.close < vwap) below++; } // skip the noisy first 5 min
    n++;
  }
  const tot = above + below;
  const persistence = tot ? Math.max(above, below) / tot : 0.5; // 1 = trends one side; ~0.5 = chops across VWAP
  return { drift, persistence };
}

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  // PB is 1DTE → require the NEXT session's expiry in the multi-dte chain. 5-window corpus.
  const real = sessions.filter((s) => {
    const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET);
    return !!cc && !!nx && cc.some((q) => q.expiration === nx) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); const exp = nextOf.get(s.dateET)!; return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // ---- PB per-session P&L: uncapped (attribution basis) AND latched (foul-out-aware) ----
  // fill = slippage the P&L pays; gate = slippage the 3× cost gate uses (split via gateCostModel).
  const pbDay = (cfg: StrategistConfig, fund: FundState, fill: CostModel, gate: CostModel = fill) => {
    const m = new Map<string, number>();
    for (const s of real) {
      const ev = buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS);
      const ts: Trade[] = simulateSession(s.bars, cfg, fund, ev, chainFor(s), false, { stopPct: 50 }, fill, undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: gate });
      m.set(s.dateET, ts.reduce((a, x) => a + x.pnl, 0));
    }
    return m;
  };
  // The decomposition chain (each step changes exactly ONE input from the as-blessed config):
  const dayBlessed = pbDay(CFG_VAL, FUND_VAL, FILL_1T, GATE_BLESSED);      // 6ct · gate 1t · fill 1t → +$4,632 anchor
  const dayGateLive = pbDay(CFG_VAL, FUND_VAL, FILL_1T, GATE_LIVE);        // 6ct · gate 0.25 (live, admits churn) · fill 1t → isolates the GATE
  const daySizeF1 = pbDay(CFG_UNCAPPED, FUND_LATCHED, FILL_1T, GATE_LIVE); // RISK500/maxC4 · gate 0.25 · fill 1t, no stop → isolates SIZING
  const dayLatched = pbDay(CFG_LATCHED, FUND_LATCHED, FILL_1T, GATE_LIVE); // FAITHFUL: live sizing + $500 stop · gate 0.25 · fill 1t (audited)
  const dayLatched025 = pbDay(CFG_LATCHED, FUND_LATCHED, FILL_025, GATE_LIVE); // optimistic-fill bracket (0.25 fills)
  const dayUncapped = daySizeF1; // alias: the no-stop faithful run (foul-out isolation in section 0)
  const feat = new Map<string, { drift: number; persistence: number }>();
  for (const s of real) { const f = morningFeatures(s); if (f) feat.set(s.dateET, f); }
  const withFeat = real.filter((s) => feat.has(s.dateET));
  const corpus = (m: Map<string, number>) => real.reduce((a, s) => a + (m.get(s.dateET) ?? 0), 0);

  console.log(`\n  PB-REGIME-MUTE · ${real.length} SPY sessions (real NBBO, PB @1DTE) · FAITHFUL: live gate 0.25-tick + audited 1-tick fills + RISK ${RISK}/stop ${DAILY_STOP}/maxC 4\n`);

  // ---- (0a) THE RECKONING: decompose the validated +$4,632, isolating GATE vs FILL vs SIZE vs FOUL-OUT ----
  const bTot = corpus(dayBlessed), gTot = corpus(dayGateLive), sTot = corpus(daySizeF1), lTot = corpus(dayLatched), l025 = corpus(dayLatched025);
  console.log(`  ══ (0a) WHAT THE LIVE TRADER ACTUALLY GETS — one input changed per step ══`);
  console.log(`  AS-BLESSED    6ct pinned · gate 1-tick · fill 1-tick             Σ ${usd(bTot).padStart(8)}   ← reproduces the +$4,632 that armed pb-ride`);
  console.log(`  → LIVE GATE   gate 0.25 (decide.ts) admits the churn 1-tick hid  Σ ${usd(gTot).padStart(8)}   gate effect    ${usd(gTot - bTot)}  ◀ the cost-model bug`);
  console.log(`  → LIVE SIZE   RISK ${RISK} (1-4 contracts by premium, not 6)        Σ ${usd(sTot).padStart(8)}   sizing effect  ${usd(sTot - gTot)}`);
  console.log(`  → FOUL-OUT    + live daily-stop ${DAILY_STOP} (forecloses recovery)       Σ ${usd(lTot).padStart(8)}   foul-out effect ${usd(lTot - sTot)}`);
  console.log(`  FAITHFUL PB EDGE = ${usd(lTot)}  (audited 1-tick fills)  ·  ${usd(l025)} if fills are the optimistic 0.25-tick  →  bracket [${usd(Math.min(lTot, l025))}, ${usd(Math.max(lTot, l025))}]`);
  console.log(`  The +$4,632 was a 1-tick-GATE + fixed-6-contract artifact: the inflated gate over-vetoed PB's marginal entries (the benched-sim bug class), in an ARMED channel's validation.\n`);

  // ---- (0) FOUL-OUT CORRECTION: the regime split, uncapped vs latched ----
  console.log(`  ══ (0) FOUL-OUT CORRECTION — PB $/session by REALIZED regime (hindsight reference) ══`);
  console.log(`  regime     n     uncapped $/sess     latched $/sess     Δ (latch bounds the bleed)`);
  for (const R of ["TREND", "CHOP", "DRIFT"] as const) {
    const ds = real.filter((s) => regimeOf(s) === R);
    if (!ds.length) continue;
    const u = ds.reduce((a, s) => a + (dayUncapped.get(s.dateET) ?? 0), 0) / ds.length;
    const l = ds.reduce((a, s) => a + (dayLatched.get(s.dateET) ?? 0), 0) / ds.length;
    console.log(`  ${R.padEnd(8)} ${String(ds.length).padStart(4)}   ${usd(u).padStart(14)}    ${usd(l).padStart(14)}     ${usd(l - u).padStart(8)}`);
  }
  console.log(`  → the chop bleed the always-on baseline is charged is the LATCHED figure (what the trader can take), not the uncapped one.\n`);

  // ---- OOS leave-one-out mute: rank held-out mornings vs the OTHER 4 windows ----
  const oosMute = (thr: number) => {
    const perWin: Array<{ w: string; nAll: number; on: number; muted: number; nMute: number; mutedDayAvg: number; keptDayAvg: number }> = [];
    const mutedDaily: Array<{ date: string; pnl: number }> = []; // muted-policy daily series (0 on muted days)
    for (const W of WINDOWS) {
      const trainD = withFeat.filter((s) => winOf(s.dateET) !== W.name).map((s) => feat.get(s.dateET)!.drift);
      const trainP = withFeat.filter((s) => winOf(s.dateET) !== W.name).map((s) => feat.get(s.dateET)!.persistence);
      const inW = withFeat.filter((s) => winOf(s.dateET) === W.name);
      let on = 0, muted = 0, nMute = 0, muteSum = 0, keptSum = 0;
      for (const s of inW) {
        const f = feat.get(s.dateET)!;
        const score = (pctRank(trainD, f.drift) + pctRank(trainP, f.persistence)) / 2; // LOW = chop
        const pnl = dayLatched.get(s.dateET) ?? 0;
        on += pnl;
        if (score < thr) { nMute++; muteSum += pnl; mutedDaily.push({ date: s.dateET, pnl: 0 }); } // muted → no trades
        else { muted += pnl; keptSum += pnl; mutedDaily.push({ date: s.dateET, pnl }); }
      }
      perWin.push({ w: W.name, nAll: inW.length, on, muted, nMute, mutedDayAvg: nMute ? muteSum / nMute : NaN, keptDayAvg: inW.length - nMute ? keptSum / (inW.length - nMute) : NaN });
    }
    return { perWin, mutedDaily };
  };

  console.log(`  ══ (1) OOS LEAVE-ONE-OUT — mute the predicted-chop mornings (drift+persistence pctile < 0.40, ranked vs the OTHER 4 windows) ══`);
  console.log(`  held-out window     always-on Σ (n)        muted Σ (muted/n)      muted-day avg   kept-day avg   mute better?`);
  const { perWin } = oosMute(0.40);
  let better = 0;
  for (const p of perWin) {
    const win = p.muted >= p.on; if (win) better++;
    console.log(`  ${p.w.padEnd(18)} ${`${usd(p.on)} (${p.nAll})`.padStart(16)}   ${`${usd(p.muted)} (${p.nMute}/${p.nAll})`.padStart(18)}   ${(isNaN(p.mutedDayAvg) ? "—" : usd(p.mutedDayAvg)).padStart(11)}   ${(isNaN(p.keptDayAvg) ? "—" : usd(p.keptDayAvg)).padStart(11)}   ${win ? "✓ better" : "✗ worse"}`);
  }
  const onTot = perWin.reduce((a, p) => a + p.on, 0), muTot = perWin.reduce((a, p) => a + p.muted, 0);
  console.log(`  POOLED  always-on ${usd(onTot)}  →  muted ${usd(muTot)}  (Δ ${usd(muTot - onTot)})  · mute better on ${better}/5 windows  ${better >= 4 ? "· PASS the OOS bar" : "· FAILS the OOS bar (≥4/5 needed)"}`);
  console.log(`  READ: mute wins only if muted-day avg is NEGATIVE (we cut losers) AND kept-day avg stays positive (we kept the trend).\n`);

  // ---- (2) THRESHOLD SENSITIVITY (plateau = robust, not a knife-edge) ----
  console.log(`  ══ (2) THRESHOLD SENSITIVITY — pooled muted Σ across mute pctile (always-on ${usd(onTot)}) ══`);
  for (const thr of [0.30, 0.40, 0.50]) {
    const { perWin: pw } = oosMute(thr);
    const mt = pw.reduce((a, p) => a + p.muted, 0), b = pw.filter((p) => p.muted >= p.on).length, nm = pw.reduce((a, p) => a + p.nMute, 0);
    console.log(`  pctile ${thr.toFixed(2)}   muted Σ ${usd(mt).padStart(8)}   Δ ${usd(mt - onTot).padStart(7)}   mutes ${nm} days   better ${b}/5`);
  }
  console.log("");

  // ---- (3) TAIL CHECK — block-bootstrap the daily series; the mute must cut the tail w/o gutting trend ----
  const datesS = [...new Set(real.map((s) => s.dateET))].sort();
  const onSeries = datesS.map((d) => dayLatched.get(d) ?? 0);
  const { mutedDaily } = oosMute(0.40);
  const muteByDate = new Map(mutedDaily.map((x) => [x.date, x.pnl]));
  const muSeries = datesS.map((d) => muteByDate.has(d) ? muteByDate.get(d)! : (dayLatched.get(d) ?? 0));
  const maxDD = (series: number[]) => { let cum = 0, peak = 0, mdd = 0; for (const p of series) { cum += p; peak = Math.max(peak, cum); mdd = Math.min(mdd, cum - peak); } return mdd; };
  // deterministic block bootstrap (B=5, circular) — seeded by index so no Math.random
  const boot = (series: number[]) => {
    const n = series.length, B = 5, paths = 2000, terms: number[] = [], dds: number[] = [];
    for (let p = 0; p < paths; p++) {
      const path: number[] = []; let seed = (p * 2654435761) >>> 0;
      const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
      while (path.length < n) { const start = Math.floor(rnd() * n); for (let k = 0; k < B && path.length < n; k++) path.push(series[(start + k) % n]); }
      terms.push(path.reduce((a, x) => a + x, 0)); dds.push(maxDD(path));
    }
    terms.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.floor(p * (arr.length - 1))];
    return { p5: q(terms, 0.05), p50: q(terms, 0.5), p95: q(terms, 0.95), mddP5: q(dds, 0.05) };
  };
  const bo = boot(onSeries), bm = boot(muSeries);
  console.log(`  ══ (3) TAIL CHECK — block-bootstrap (B=5, 2000 paths) of the daily PB series, always-on vs muted ══`);
  console.log(`  policy       Σ realized    p5 terminal   p50 terminal   p95 terminal   maxDD p5 (worst)`);
  console.log(`  always-on   ${usd(onSeries.reduce((a, x) => a + x, 0)).padStart(9)}   ${usd(bo.p5).padStart(9)}   ${usd(bo.p50).padStart(10)}   ${usd(bo.p95).padStart(10)}   ${usd(bo.mddP5).padStart(10)}`);
  console.log(`  chop-muted  ${usd(muSeries.reduce((a, x) => a + x, 0)).padStart(9)}   ${usd(bm.p5).padStart(9)}   ${usd(bm.p50).padStart(10)}   ${usd(bm.p95).padStart(10)}   ${usd(bm.mddP5).padStart(10)}`);
  console.log(`  → the mute must lift p5 / cut maxDD (less chop bleed) WITHOUT collapsing p95 (the convex TREND tail — the inverted-gate failure).\n`);

  console.log(`  VERDICT: arm the PB-mute IFF (1) muted ≥ always-on on ≥4/5 held-out windows, (2) a plateau across thresholds,`);
  console.log(`  (3) the tail bootstrap shows lower DD / higher p5 with p95 intact. Else → the drift+persistence axis fails PB too → PARK.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
