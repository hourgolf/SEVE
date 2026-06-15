// ============================================================================
//  pbride-invgate-probe — pb-ride (the 1DTE pullback builtin) is CHOP-LOVING:
//  its best regime window was CHOP Mar26 (+$7,472) and its worst was CHOP-MIX.
//  (2026-06-15.) The NORMAL implied-chop gate (stand DOWN on predicted-chop, the
//  chop-ride-oos-probe rule) would HURT it. This tests the INVERTED gate: trade
//  ONLY predicted-CHOP sessions, stand DOWN on predicted-trend.
//
//  WIRING (the load-bearing part):
//   · pb-ride @ 1DTE — cloned EXACTLY from one-dte-probe / pb-selftest: it buys the
//     NEXT-session expiry, so it prices off data/databento-mdte (makeMultiDteChain
//     filtered to nextOf[dateET]), NOT the 0DTE makeDatabentoChain. Evaluator =
//     pbEval(pbPre(s), false, false) (the RIDE variant — same as the registry builtin,
//     proven trade-identical by pb-selftest).
//   · imScore @ 9:35 — cloned from chop-ride-oos-probe / implied-move-probe: the OPEN
//     ATM straddle (0DTE makeDatabentoChain, mid call+put / spot) = the PRICED expected
//     move; realized = |close@10:30 − open|/open. ratio = realized/implied. LOW ratio
//     = quiet-vs-priced = chop-leaning. Percentile-ranked OOS leave-one-out vs the
//     OTHER 4 windows (train), gate the HELD-OUT window.
//   · INVERSION — chop-ride-oos keeps trades where pctRank(train,ratio) >= thr
//     (predicted-TREND). pb-ride is chop-loving, so we KEEP pctRank < thr
//     (predicted-CHOP) and SKIP predicted-trend. thr = 0.50.
//
//  SANITY FIRST (critical): the UNGATED pb-ride@1DTE baseline MUST roughly reproduce
//  the one-dte-verdict anchor (≈ +$18/t, ≈ +$4,632 corpus, 4/5 windows positive). If
//  it doesn't, the 1DTE chain wiring is WRONG — every gated number is then garbage.
//
//  Same 5 windows, real Databento NBBO, ride exits (−50% prem stop / 15:25 flatten,
//  cost gate 3.0). Report per-window + pooled: ungated vs inverted-gated exp$/t,
//  windows-better, n(all->kept).
//
//    npx tsx engine/pbride-invgate-probe.ts
// ============================================================================

import { simulateSession } from "./backtest";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain, loadDatabentoByDay, makeDatabentoChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import { makeEval as pbEval, precompute as pbPre } from "./ema-pullback-probe";
import type { ChainProvider } from "./optionsource";
import type { Evaluate, FundState, Quote, StrategistConfig, Trade } from "./types";

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };
const GATE = { minMoveToCostRatio: 3.0 };
const CFG: StrategistConfig = { slug: "pb", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const CLOSE = 16 * 60;
const STRADDLE_ET = 9 * 60 + 35; // implied read (same as chop-ride-oos / implied-move)
const MORN_END = 10 * 60 + 30;   // realized read
const THR = 0.50;                // gate pctile; INVERTED: keep < THR (predicted-chop)

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];

const etMinOf = (ms: number): number => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const sgn = (v: number) => (v >= 0 ? "+" : "");
const exp = (ts: Trade[]) => (ts.length ? ts.reduce((a, t) => a + t.pnl, 0) / ts.length : NaN);
function pctRank(values: number[], v: number): number { let b = 0; for (const x of values) if (x < v) b++; return b / Math.max(1, values.length); }

interface Tagged { pnl: number; date: string; window: string }

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>();
  for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);

  // ── 1DTE chain (mdte cache) — cloned EXACTLY from one-dte-probe / pb-selftest ──
  const mdte = loadMultiDteByDay(dates);
  // ── 0DTE chain (databento) — for the 9:35 ATM straddle implied read ──
  const byDay0 = loadDatabentoByDay(dates, "SPY") as unknown as Map<string, unknown[]>;

  // usable session: mdte present AND it quotes the next session's expiry (1DTE) AND
  // bars >= 90 — IDENTICAL to one-dte-probe / pb-selftest.
  const real = sessions.filter((s) => {
    const c = mdte.get(s.dateET); const nx = nextOf.get(s.dateET);
    return !!c && !!nx && c.some((q) => q.expiration === nx) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;

  // 1DTE chain: all expirations, filtered to the NEXT session's expiry (pb-ride buys time).
  const chain1 = (s: RealSession): ChainProvider => {
    const all = makeMultiDteChain(mdte.get(s.dateET)!);
    const nx = nextOf.get(s.dateET)!;
    return (_sp, _mtc, ts) => all(ts).filter((q) => q.expiration === nx);
  };

  // ── pb-ride @1DTE trades, tagged by entry session date/window ──
  const preBy = new Map<string, ReturnType<typeof pbPre>>();
  const preOf = (s: RealSession) => { let p = preBy.get(s.dateET); if (!p) { p = pbPre(s); preBy.set(s.dateET, p); } return p; };
  const mkPb = (s: RealSession): Evaluate => pbEval(preOf(s), false, false); // RIDE variant, no vol — the registry builtin

  const trades: Tagged[] = [];
  for (const s of real) {
    for (const t of simulateSession(s.bars, CFG, FUND, mkPb(s), chain1(s), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE))
      trades.push({ pnl: t.pnl, date: s.dateET, window: winOf(s.dateET) });
  }

  // ── per-session implied/realized ratio at 9:35 (0DTE straddle), same as the SPY probe ──
  const ratioBy = new Map<string, number>();
  for (const s of real) {
    const rows0 = byDay0.get(s.dateET);
    if (!rows0 || !rows0.length) continue;
    const chainAt = makeDatabentoChain(rows0 as Parameters<typeof makeDatabentoChain>[0]);
    const mins = s.bars.map((b) => etMinOf(b.ts));
    const barAt = (t: number) => { for (let i = 0; i < mins.length; i++) if (mins[i] >= t) return i; return -1; };
    const si = barAt(STRADDLE_ET), mi = barAt(MORN_END);
    if (si < 0 || mi <= si) continue;
    const sb = s.bars[si], K = Math.round(sb.close);
    const ch = chainAt(sb.close, CLOSE - mins[si], sb.ts);
    const ce = atQ(ch, K, "call"), pe = atQ(ch, K, "put");
    if (ce && pe && ce.mid > 0 && pe.mid > 0) {
      const implied = (ce.mid + pe.mid) / sb.close;
      const realized = Math.abs(s.bars[mi].close - s.bars[0].open) / s.bars[0].open;
      if (implied > 0) ratioBy.set(s.dateET, realized / implied);
    }
  }

  console.log(`\n  PBRIDE-INVERTED-GATE · pb-ride @1DTE (next-expiry, mdte cache) · ${real.length} sessions · ${trades.length} pb-ride trades · real NBBO`);
  console.log(`  gate = OOS implied-chop (9:35 straddle / 10:30 realized, leave-one-out vs the OTHER 4 windows), INVERTED:`);
  console.log(`  KEEP a session's trades iff OOS pctRank(ratio) < ${THR} (predicted-CHOP); SKIP predicted-trend.\n`);

  // ===================== (0) SANITY — UNGATED baseline =====================
  const ANCHOR_T = 18, ANCHOR_TOT = 4632; // one-dte-verdict: pb-ride@1DTE ≈ +$18/t, +$4,632, 4/5 windows +
  const allExp = exp(trades), allTot = trades.reduce((a, t) => a + t.pnl, 0);
  const perWinAll = WINDOWS.map((w) => { const ts = trades.filter((t) => t.window === w.name); return { w: w.name, n: ts.length, exp: exp(ts), tot: ts.reduce((a, t) => a + t.pnl, 0) }; });
  const winsPosAll = perWinAll.filter((p) => p.tot > 0).length;
  console.log(`  ══ (0) SANITY — UNGATED pb-ride@1DTE baseline vs one-dte-verdict anchor ══`);
  console.log(`  pooled exp$/t ${`${sgn(allExp)}${allExp.toFixed(1)}`.padStart(7)} (n=${trades.length})   corpus Σ ${usd(allTot)}   windows positive ${winsPosAll}/5`);
  console.log(`  anchor (one-dte): ≈ +$${ANCHOR_T}/t · +$${ANCHOR_TOT} corpus · 4/5 windows +`);
  for (const p of perWinAll) console.log(`    ${p.w.padEnd(18)} ${`${sgn(p.exp)}${p.exp.toFixed(1)}`.padStart(7)}/t  Σ ${usd(p.tot).padStart(8)}  (n=${p.n})`);
  const sane = Math.abs(allExp - ANCHOR_T) <= 12 && Math.abs(allTot - ANCHOR_TOT) <= 2500 && winsPosAll >= 3;
  console.log(`  → ${sane ? "SANITY OK — baseline ≈ anchor; 1DTE wiring trusted" : "⚠ SANITY MISMATCH — baseline far from anchor; 1DTE wiring SUSPECT"}\n`);

  // ===================== (1) INVERTED OOS LEAVE-ONE-OUT =====================
  const invGate = (thr: number) => {
    const perWin: Array<{ w: string; nAll: number; expAll: number; totAll: number; nKept: number; expKept: number; totKept: number; better: boolean }> = [];
    const keptPooled: Tagged[] = [];
    for (const W of WINDOWS) {
      // train = ratios from the OTHER 4 windows
      const train = [...ratioBy.entries()].filter(([d]) => winOf(d) !== W.name).map(([, v]) => v);
      const inW = trades.filter((t) => t.window === W.name);
      // INVERTED: keep predicted-CHOP (rank < thr)
      const kept = inW.filter((t) => { const r = ratioBy.get(t.date); return r != null && pctRank(train, r) < thr; });
      keptPooled.push(...kept);
      const eA = exp(inW), eK = exp(kept);
      perWin.push({ w: W.name, nAll: inW.length, expAll: eA, totAll: inW.reduce((a, t) => a + t.pnl, 0), nKept: kept.length, expKept: eK, totKept: kept.reduce((a, t) => a + t.pnl, 0), better: (Number.isFinite(eK) ? eK : -1e9) > (Number.isFinite(eA) ? eA : 0) });
    }
    return { perWin, keptPooled };
  };

  const { perWin, keptPooled } = invGate(THR);
  console.log(`  ══ (1) INVERTED OOS LEAVE-ONE-OUT (read 9:35 · keep pctRank < ${THR} = predicted-CHOP, ranked vs the OTHER 4 windows) ══`);
  console.log(`  held-out window      ungated exp$/t (n)      inv-gated exp$/t (n)     gate better?`);
  let better = 0;
  for (const p of perWin) {
    if (p.better) better++;
    console.log(`  ${p.w.padEnd(18)} ${`${sgn(p.expAll)}${p.expAll.toFixed(1)} (${p.nAll})`.padStart(18)}   ${`${sgn(p.expKept)}${Number.isFinite(p.expKept) ? p.expKept.toFixed(1) : "—"} (${p.nKept})`.padStart(20)}     ${p.better ? "✓ better" : "✗ worse"}`);
  }
  const keptExp = exp(keptPooled), keptTot = keptPooled.reduce((a, t) => a + t.pnl, 0);
  console.log(`  POOLED (held-out)  ungated ${`${sgn(allExp)}${allExp.toFixed(1)}`}/t (${trades.length})   →   inv-gated ${`${sgn(keptExp)}${keptExp.toFixed(1)}`}/t (${keptPooled.length})`);
  console.log(`  n(all -> kept): ${trades.length} -> ${keptPooled.length}   (kept Σ ${usd(keptTot)})`);
  console.log(`  → inverted gate better on ${better}/5 held-out windows  ${better >= 4 ? "· PASS the OOS bar" : "· FAILS the OOS bar (≥4/5 needed)"}\n`);

  // ===================== (2) THRESHOLD SENSITIVITY =====================
  console.log(`  ══ (2) THRESHOLD SENSITIVITY — pooled held-out inv-gated exp$/t (robust = plateau) ══`);
  console.log(`  baseline ungated ${`${sgn(allExp)}${allExp.toFixed(1)}`}/t (${trades.length})`);
  for (const thr of [0.40, 0.50, 0.60]) {
    const { keptPooled: kp } = invGate(thr);
    console.log(`  keep < ${thr.toFixed(2)} (chop)   inv-gated ${`${sgn(exp(kp))}${exp(kp).toFixed(1)}`}/t (${kp.length})   Σ ${usd(kp.reduce((a, t) => a + t.pnl, 0))}`);
  }

  console.log(`\n  CAVEAT: the gate is SESSION-level read at 10:30 (realized leg); pb-ride entries start 10:00, so the`);
  console.log(`  earliest ~30 min of a session's entries technically precede the gate read — same session-gating`);
  console.log(`  convention as chop-ride-oos-probe. The straddle/realized read is otherwise look-ahead-free.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
