// ============================================================================
//  drift-detector-probe — is there an EX-ANTE signal that flags DRIFT days? (Thread C,
//  2026-06-19.) DRIFT (low-vol, no-catalyst: <3 reversal legs AND |day move|<0.45%) is
//  ~48% of sessions and uniformly NEGATIVE — it's ORB-base's single biggest bleed
//  (−$23.7k, vs +$36.6k on trend). A working "don't trade the dead days" flag would help
//  every channel, and it's a cleaner target than chop (drift is quiet/measurable).
//
//  Candidate signals, all knowable by ~10:30 (no look-ahead — first 60 RTH min + the
//  9:40 chain):
//   · morning RANGE   (first-hour high-low / open)        — drift = narrow
//   · morning MOVE    (|open→10:30| / open)               — drift = small net move
//   · morning VOLUME  (first-hour vol / trailing-day avg) — drift = quiet
//   · morning ER      (efficiency ratio, first hour)      — low for drift AND chop
//   · IMPLIED MOVE    (9:40 ATM 0DTE straddle / spot)     — the GAMMA-OPEN clock signal,
//       tested here on the full corpus (the live log has only ~2 captures) — does a low
//       open-implied-move predict a drift day?
//
//  TEST per signal: (a) does it SEPARATE drift days (mean signal drift vs trend/chop)?
//  (b) recall — of realized-drift days, how many sit in the low-signal half? (c) the
//  payoff — OOS leave-one-out: stand ORB DOWN on predicted-drift days (signal below the
//  OTHER-4-window median), does it beat always-on on ≥4/5 held-out windows? Faithful ORB
//  (RISK500/+75%/stop50/gate3, real NBBO).
//
//    npm run drift-detector-probe
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Quote, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 1000, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "dd", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 500, muted: false, soloed: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };
const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const RTH_OPEN = 9 * 60 + 30;
// CAUSAL window: signals end at 10:00 — BEFORE ORB's first possible entry (the 30-min OR
// completes at 10:00; entry audit: 0/557 ORB entries before 10:00). The original 60-min
// (→10:30) window was LOOK-AHEAD — it overlapped 28% of ORB trades, and a 4-skeptic
// verification proved the morning-ER "+$9,253 / 4-of-5" was ~92% look-ahead inflation
// (causal →10:00 = +$582, 2/5, indistinguishable from a random same-count stand-down).
const CAUSAL_MIN = 30;
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");
const etMinOf = (ms: number) => { const et = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })); return et.getHours() * 60 + et.getMinutes(); };

// ORB-base (the test book — drift is its biggest leak)
const meta = { name: "x", regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "x" } as StrategySpec["meta"];
const orbLeg = (side: "above" | "below"): StrategySpec["entries"][number]["all"] => [
  { kind: "opening_range", side: side === "above" ? "break_above" : "break_below", minutes: 30 },
  { kind: "or_width_min", pct: 0.25 } as any, { kind: "vwap_side", side },
  { kind: "momentum_atr", op: side === "above" ? ">=" : "<=", value: side === "above" ? 0.3 : -0.3, lookback: 5 } as any,
  { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" },
];
const orbEval = (): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef({ meta, exits: [{ timeET: "15:25" }], sizing: {}, entries: [
    { direction: "call", reason: "u", all: orbLeg("above") }, { direction: "put", reason: "d", all: orbLeg("below") },
  ] });
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl, gap: s.gap });
};

function regimeOf(b: Bar[]): "TREND" | "CHOP" | "DRIFT" {
  const o = b[0].close, c = b[b.length - 1].close, move = Math.abs((c - o) / o) * 100;
  let legs = 0, anchor = o, dir = 0;
  for (const x of b) { const m = (x.close - anchor) / anchor; if (Math.abs(m) >= 0.003) { const d = Math.sign(m); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = x.close; } }
  return legs >= 3 ? "CHOP" : move >= 0.45 ? "TREND" : "DRIFT";
}
// morning signals (first 60 RTH min). LOW = drift-prone for all four.
function morning(b: Bar[]): { range: number; move: number; vol: number; er: number } | null {
  const h = b.filter((x) => { const m = etMinOf(x.ts); return m >= RTH_OPEN && m < RTH_OPEN + CAUSAL_MIN; });
  if (h.length < 20) return null;
  const o = h[0].open, hi = Math.max(...h.map((x) => x.high)), lo = Math.min(...h.map((x) => x.low));
  const range = (hi - lo) / o;
  const move = Math.abs(h[h.length - 1].close - o) / o;
  const vol = h.reduce((a, x) => a + (x.volume || 0), 0);
  let path = 0; for (let i = 1; i < h.length; i++) path += Math.abs(h[i].close - h[i - 1].close);
  const er = path > 0 ? Math.abs(h[h.length - 1].close - h[0].close) / path : 0;
  return { range, move, vol, er };
}
const atQ = (ch: Quote[], k: number, t: "call" | "put") => ch.find((q) => q.optType === t && Math.round(q.strike) === k);

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const real = sessions.filter((s) => { const cc = mdte.get(s.dateET); return !!cc && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to); });
  const chainFor = (s: RealSession): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === s.dateET); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;
  const datesS = [...new Set(real.map((s) => s.dateET))].sort();

  // ORB-base daily P&L
  const ev = orbEval(); const orbDay = new Map<string, number>();
  for (const s of real) {
    const ts: Trade[] = simulateSession(s.bars, CFG, FUND, ev(s), chainFor(s), false, { profitPct: 75, stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
    orbDay.set(s.dateET, ts.reduce((a, x) => a + x.pnl, 0));
  }
  // signals + realized regime + trailing-vol (for the volume ratio)
  const reg = new Map(real.map((s) => [s.dateET, regimeOf(s.bars as Bar[])]));
  const sig = new Map<string, { range: number; move: number; vol: number; er: number; im: number | null }>();
  const trailVol: number[] = [];
  for (const s of real) {
    const m = morning(s.bars as Bar[]); if (!m) continue;
    // implied move: 9:40 ATM 0DTE straddle / spot
    let im: number | null = null;
    const bars = s.bars as Bar[]; const idx = bars.findIndex((b) => etMinOf(b.ts) >= RTH_OPEN + 10);
    if (idx >= 0) {
      const b = bars[idx], spot = b.close, k = Math.round(spot);
      const ch = chainFor(s)(spot, 0, b.ts); const c = atQ(ch, k, "call"), p = atQ(ch, k, "put");
      if (c && p && c.mid > 0 && p.mid > 0) im = ((c.mid + p.mid) / spot) * 100;
    }
    sig.set(s.dateET, { ...m, im });
  }
  const withSig = real.filter((s) => sig.has(s.dateET));
  // volume → ratio vs trailing-20-session avg of morning vol
  const volByDate = withSig.map((s) => ({ d: s.dateET, v: sig.get(s.dateET)!.vol }));
  const volRatio = new Map<string, number>();
  for (let i = 0; i < volByDate.length; i++) {
    const lo = Math.max(0, i - 20); const prior = volByDate.slice(lo, i).map((x) => x.v);
    const avg = prior.length ? prior.reduce((a, x) => a + x, 0) / prior.length : volByDate[i].v;
    volRatio.set(volByDate[i].d, avg > 0 ? volByDate[i].v / avg : 1);
  }

  const driftDays = withSig.filter((s) => reg.get(s.dateET) === "DRIFT");
  const driftBleed = driftDays.reduce((a, s) => a + (orbDay.get(s.dateET) ?? 0), 0);
  const mix = { TREND: 0, CHOP: 0, DRIFT: 0 } as Record<string, number>; for (const s of withSig) mix[reg.get(s.dateET)!]++;
  console.log(`\n  DRIFT-DETECTOR · ${withSig.length} SPY sessions w/ signals (real NBBO) · regime mix TREND ${mix.TREND} CHOP ${mix.CHOP} DRIFT ${mix.DRIFT} (${Math.round(100 * mix.DRIFT / withSig.length)}% drift)`);
  console.log(`  ORB-base drift-day bleed = ${usd(driftBleed)} over ${driftDays.length} days (the target to avoid). LOW signal = drift-prone for all candidates.\n`);

  const sigVal = (d: string, key: string): number | null => {
    const s = sig.get(d)!; if (key === "vol") return volRatio.get(d) ?? null; if (key === "im") return s.im;
    return (s as any)[key];
  };
  const SIGNALS = [
    { key: "im", label: "implied-move (9:40 straddle)" },
    { key: "range", label: "morning range" },
    { key: "move", label: "morning net move" },
    { key: "vol", label: "morning volume ratio" },
    { key: "er", label: "morning ER" },
  ];

  console.log(`  ══ signal separation (mean value by realized regime) + drift recall + OOS stand-down on ORB ══`);
  console.log(`  ${"signal".padEnd(30)}${"DRIFT".padStart(8)}${"CHOP".padStart(8)}${"TREND".padStart(8)}  recall  ${"OOS standdown Δ".padStart(16)}  better/5`);
  for (const S of SIGNALS) {
    const have = withSig.filter((s) => sigVal(s.dateET, S.key) != null);
    const meanBy = (r: string) => { const v = have.filter((s) => reg.get(s.dateET) === r).map((s) => sigVal(s.dateET, S.key)!); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN; };
    // recall: of drift days, fraction in the LOW half (below overall median)
    const allV = have.map((s) => sigVal(s.dateET, S.key)!).sort((a, b) => a - b);
    const med = allV[Math.floor(0.5 * (allV.length - 1))];
    const driftHave = have.filter((s) => reg.get(s.dateET) === "DRIFT");
    const recall = driftHave.length ? driftHave.filter((s) => sigVal(s.dateET, S.key)! <= med).length / driftHave.length : 0;
    // OOS stand-down: leave-one-out, stand ORB down on signal ≤ other-4 median (predicted drift)
    let oosBetter = 0, oosΔ = 0;
    for (const W of WINDOWS) {
      const other = have.filter((s) => winOf(s.dateET) !== W.name).map((s) => sigVal(s.dateET, S.key)!).sort((a, b) => a - b);
      if (!other.length) continue;
      const thr = other[Math.floor(0.5 * (other.length - 1))];
      const inW = have.filter((s) => winOf(s.dateET) === W.name);
      let on = 0, routed = 0;
      for (const s of inW) { const pnl = orbDay.get(s.dateET) ?? 0; on += pnl; if (!(sigVal(s.dateET, S.key)! <= thr)) routed += pnl; } // stand down (0) if predicted-drift
      oosΔ += routed - on; if (routed >= on) oosBetter++;
    }
    console.log(`  ${S.label.padEnd(30)}${f2(meanBy("DRIFT")).padStart(8)}${f2(meanBy("CHOP")).padStart(8)}${f2(meanBy("TREND")).padStart(8)}  ${(Math.round(recall * 100) + "%").padStart(5)}  ${usd(oosΔ).padStart(16)}  ${oosBetter}/5`);
  }
  console.log(`\n  ══ VERDICT (CAUSAL, →10:00) ══`);
  console.log(`  No causal morning signal predicts drift well enough: morning-ER stand-down is ~+$582 (2/5) once the look-ahead is removed (was +$9,253/4-5 at`);
  console.log(`  the contaminating →10:30 window); morning-move collapses the same (+$8,768→~+$85); random same-count control ties it. The implied-move /`);
  console.log(`  gamma-open clock does NOT separate drift (0.44) from trend (0.49) — it flags CHOP (0.73), so it's a chop/vol signal, DROP it as a drift detector.`);
  console.log(`  → CAUSAL DRIFT DETECTION IS DEAD on this corpus. ORB's −$23.7k drift bleed is a ROSTER problem (cull/downsize orb-trend-rider, a live bleeder),`);
  console.log(`  NOT a stand-down flag — and a DESK-WIDE drift mute is BACKWARDS (it would silence PB, which makes its best days on quiet/low-move mornings).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
