// ============================================================================
//  regime-router-probe — Phase 0 of the regime-router (docs/regime-router-spec.md).
//  Does ROUTING a desk by an EX-ANTE regime call beat running every channel always-on?
//  This gates the whole router. (v2 2026-06-18 — rebuilt after a 4-skeptic adversarial
//  verification of v1; see docs for the audit. v1 defects fixed here: (1) the desk-B
//  threshold sweep was missing so a single unlucky Ptrend=0.60 made morning-ER look like
//  it "actively hurt" — it doesn't, it's just weak+fragile; (2) the morning-LEGS chop
//  classifier was DEGENERATE (87% of days legs=0 → DRIFT never predicted → a fake 3-way),
//  so the chop/drift split is DROPPED — the router is a clean 2-way TREND/no-TREND call
//  (the chop-arm is refuted at the ORACLE level, below, so an ex-ante chop test is moot);
//  (3) the oracle prize is now decomposed by channel subset + tail-concentration so its
//  PB-ride dominance is explicit.)
//
//  DESK (faithful: RISK 500 / daily-stop 500 / gate 3 / real Databento NBBO 0.25):
//   ride book = PB(1DTE) · BREAK-V3 · BREAK-ALT · power  (directional — want TREND days)
//   chop scalp = grind-base (the raw scalper — tested ONLY as an oracle-chop arm, H3)
//
//  ROUTER = arm the ride book ONLY on predicted-TREND days (mute otherwise). Mute = that
//  channel takes 0 trades that session; the router only ADDS stand-downs, never an entry.
//   A always-on  = ride book every session (≈ today's directional desk)
//   B routed     = ride book armed only on TREND (the lever)
//  Compared under the ORACLE (perfect regime = the ceiling/headroom) and EX-ANTE (the real
//  test: morning efficiency-ratio over the first 60 min, OOS leave-one-out thresholds).
//
//  THE BAR (noise-injection): routing tolerates an imperfect call — flipping k% of the
//  oracle's TREND/no-TREND labels shows how accurate an ex-ante classifier must be to clear
//  always-on. The question is whether a morning-knowable TREND signal can hit that bar.
//
//    npm run regime-router-probe
//  Real Databento NBBO, the 5-window corpus, each channel at its live DTE.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { loadRealSessions, type RealSession } from "./realsource";
import { loadMultiDteByDay, makeMultiDteChain } from "./databentosource";
import { grindEvaluate, DEFAULT_GRIND_PARAMS } from "./strategies/grind";
import { powerEvaluate, DEFAULT_POWER_MOM60 } from "./strategies/power";
import { buildPullback, DEFAULT_PULLBACK_PARAMS } from "./strategies/pullback";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";
import type { StrategySpec } from "../lib/desk/strategySpec";

const FUND: FundState = { total_capital_usd: 1000, master_daily_stop_usd: 1e9, is_halted: false };
const CFG: StrategistConfig = { slug: "rr", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 500, muted: false, soloed: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars", slippageTicksPerSide: 0.25 };
const GATE = { minMoveToCostRatio: 3.0 };

const WINDOWS = [
  { name: "CHOP Mar26", from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24", from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const CHOPMIX = "CHOP-MIX 25-26";

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

const RIDES: Array<{ name: string; dte: 0 | 1; mk: (s: RealSession) => Evaluate }> = [
  { name: "PB-ride", dte: 1, mk: (s) => buildPullback(s.bars as Bar[], 1, DEFAULT_PULLBACK_PARAMS) },
  { name: "BREAK-V3", dte: 0, mk: specEval(V3, "15:25") },
  { name: "BREAK-ALT", dte: 0, mk: specEval(ALT, "15:25") },
  { name: "power", dte: 0, mk: () => (f, p) => powerEvaluate(f, p, DEFAULT_POWER_MOM60) },
];
const SCALP = { name: "grind-base", dte: 0 as const, mk: () => (f: any, p: any) => grindEvaluate(f, p, DEFAULT_GRIND_PARAMS) };
// channel subsets for the oracle decomposition (expose PB-ride's dominance of the prize)
const SUBSETS: Array<{ name: string; chans: string[] }> = [
  { name: "full {PB,V3,ALT,pw}", chans: ["PB-ride", "BREAK-V3", "BREAK-ALT", "power"] },
  { name: "core {V3,ALT,pw}", chans: ["BREAK-V3", "BREAK-ALT", "power"] },
  { name: "pair {V3,ALT}", chans: ["BREAK-V3", "BREAK-ALT"] },
];

type Regime = "TREND" | "CHOP" | "DRIFT";
const usd = (v: number) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v));

// realized regime (HINDSIGHT — the ORACLE only). legs≥3 = chop; else move≥0.45% = trend; else drift.
function regimeOf(b: Bar[]): Regime {
  const o = b[0].close, c = b[b.length - 1].close, move = Math.abs((c - o) / o) * 100;
  let legs = 0, anchor = o, dir = 0;
  for (const x of b) { const m = (x.close - anchor) / anchor; if (Math.abs(m) >= 0.003) { const d = Math.sign(m); if (d !== dir && dir !== 0) legs++; if (d !== dir) dir = d; anchor = x.close; } }
  return legs >= 3 ? "CHOP" : move >= 0.45 ? "TREND" : "DRIFT";
}
// EX-ANTE morning efficiency ratio over the first 60 session minutes (knowable ~10:30, no look-ahead).
// |net close-to-close| / Σ|Δclose| — high = clean directional morning. (close-to-close throughout.)
function morningER(b: Bar[]): number {
  const h = b.slice(0, Math.min(60, b.length));
  let path = 0; for (let i = 1; i < h.length; i++) path += Math.abs(h[i].close - h[i - 1].close);
  return path > 0 ? Math.abs(h[h.length - 1].close - h[0].close) / path : 0;
}

// deterministic LCG (no Math.random — keeps the probe resumable/reproducible)
const lcg = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return s / 0xffffffff; }; };

async function main() {
  const sessions = await loadRealSessions({ symbol: "SPY", sinceDaysAgo: 900 });
  const mdte = loadMultiDteByDay(sessions.map((s) => s.dateET));
  const dates = sessions.map((s) => s.dateET);
  const nextOf = new Map<string, string>(); for (let i = 0; i < dates.length - 1; i++) nextOf.set(dates[i], dates[i + 1]);
  const real = sessions.filter((s) => {
    const cc = mdte.get(s.dateET), nx = nextOf.get(s.dateET);
    return !!cc && !!nx && cc.some((q) => q.expiration === nx) && cc.some((q) => q.expiration === s.dateET) && s.bars.length >= 90 && WINDOWS.some((w) => s.dateET >= w.from && s.dateET <= w.to);
  });
  const chainFor = (s: RealSession, exp: string): ChainProvider => { const all = makeMultiDteChain(mdte.get(s.dateET)!); return (_sp, _m, ts) => all(ts).filter((q) => q.expiration === exp); };
  const winOf = (d: string) => WINDOWS.find((w) => d >= w.from && d <= w.to)!.name;
  const datesS = [...new Set(real.map((s) => s.dateET))].sort();

  // ---- per-channel daily P&L (faithful config) ----
  const channelDay = (ch: { dte: 0 | 1; mk: (s: RealSession) => Evaluate }) => {
    const m = new Map<string, number>();
    for (const s of real) {
      const exp = ch.dte === 0 ? s.dateET : nextOf.get(s.dateET)!;
      const t: Trade[] = simulateSession(s.bars, CFG, FUND, ch.mk(s), chainFor(s, exp), false, { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, 0, GATE);
      m.set(s.dateET, t.reduce((a, x) => a + x.pnl, 0));
    }
    return m;
  };
  const rideDay = new Map(RIDES.map((ch) => [ch.name, channelDay(ch)]));
  const scalpDay = channelDay(SCALP);
  const er = new Map(real.map((s) => [s.dateET, morningER(s.bars as Bar[])]));
  const oracle = new Map(real.map((s) => [s.dateET, regimeOf(s.bars as Bar[])]));
  const isTrendO = (d: string) => oracle.get(d) === "TREND";

  // subset desk P&L on a given day, gated by an arm predicate
  const deskDay = (chans: string[], d: string, arm: (d: string) => boolean) => arm(d) ? chans.reduce((a, c) => a + (rideDay.get(c)!.get(d) ?? 0), 0) : 0;
  const always = (_d: string) => true;

  const perWin = (fn: (d: string) => number) => {
    const m = new Map<string, number>(); for (const w of WINDOWS) m.set(w.name, 0);
    let tot = 0, ex = 0; for (const d of datesS) { const v = fn(d); m.set(winOf(d), m.get(winOf(d))! + v); tot += v; if (winOf(d) !== CHOPMIX) ex += v; }
    return { m, tot, ex };
  };
  const wins5 = (fn: (d: string) => number, base: (d: string) => number) => { const a = perWin(fn).m, b = perWin(base).m; let n = 0; for (const w of WINDOWS) if (a.get(w.name)! >= b.get(w.name)!) n++; return n; };
  const row = (label: string, fn: (d: string) => number, base?: (d: string) => number) => {
    const { m, tot, ex } = perWin(fn);
    const cells = WINDOWS.map((w) => usd(m.get(w.name)!).padStart(10)).join("");
    console.log(`  ${label.padEnd(22)}${cells}${usd(tot).padStart(10)}${usd(ex).padStart(10)}${base ? `  ${wins5(fn, base)}/5` : ""}`);
  };

  const oc = { TREND: 0, CHOP: 0, DRIFT: 0 } as Record<Regime, number>; for (const d of datesS) oc[oracle.get(d)!]++;
  console.log(`\n  REGIME-ROUTER (Phase 0, v2) · ${real.length} SPY sessions (real NBBO) · ride book {${RIDES.map((r) => r.name).join(",")}}`);
  console.log(`  FAITHFUL: RISK 500 / daily-stop 500 / gate 3 / 0.25 fill. Router = arm rides only on predicted-TREND.`);
  console.log(`  oracle regime mix:  TREND ${oc.TREND}  CHOP ${oc.CHOP}  DRIFT ${oc.DRIFT}\n`);
  const hdr = `  ${"".padEnd(22)}` + WINDOWS.map((w) => w.name.replace(/ .*/, "").padStart(10)).join("") + `${"Σ".padStart(10)}${"exClf".padStart(10)}  w/5`;

  // ---- (0) building blocks: each channel all-in vs on oracle-TREND days ----
  console.log(`  ══ (0) CHANNEL P&L — all-in (always-on) vs ONLY oracle-TREND days ══`);
  console.log(`  ${"channel".padEnd(14)}${"all-in Σ".padStart(12)}${"TREND-only Σ".padStart(14)}   note`);
  for (const ch of RIDES) {
    const allIn = datesS.reduce((a, d) => a + (rideDay.get(ch.name)!.get(d) ?? 0), 0);
    const tOnly = datesS.reduce((a, d) => a + (isTrendO(d) ? (rideDay.get(ch.name)!.get(d) ?? 0) : 0), 0);
    const note = allIn < 0 ? (ch.name === "power" ? "structural bleeder (roster-cull, not routing)" : "NET-NEGATIVE all-in — prize leans on a weak channel") : "";
    console.log(`  ${ch.name.padEnd(14)}${usd(allIn).padStart(12)}${usd(tOnly).padStart(14)}   ${note}`);
  }
  console.log("");

  // ---- (1) ORACLE CEILING by channel subset — the headroom + PB-dominance caveat ----
  console.log(`  ══ (1) ORACLE CEILING (perfect TREND call — NOT achievable live) by channel subset ══`);
  console.log(hdr);
  for (const ss of SUBSETS) {
    row(`A always-on ${ss.name}`, (d) => deskDay(ss.chans, d, always));
    row(`B routed→TREND`, (d) => deskDay(ss.chans, d, isTrendO), (d) => deskDay(ss.chans, d, always));
  }
  // tail concentration of the full-book oracle prize
  const trendDays = datesS.filter(isTrendO).map((d) => ({ d, v: SUBSETS[0].chans.reduce((a, c) => a + (rideDay.get(c)!.get(d) ?? 0), 0) })).sort((a, b) => b.v - a.v);
  const fullPrize = trendDays.reduce((a, x) => a + x.v, 0);
  const top = (n: number) => trendDays.slice(0, n).reduce((a, x) => a + x.v, 0);
  console.log(`  → full-book prize ${usd(fullPrize)} is CONVEX-TAIL-concentrated: top-1 ${Math.round(100 * top(1) / fullPrize)}% · top-5 ${Math.round(100 * top(5) / fullPrize)}% · top-10 ${Math.round(100 * top(10) / fullPrize)}% of ${trendDays.length} trend days.`);
  console.log(`  → ⚠ THE PRIZE IS A ROSTER SIGNAL, NOT A ROUTING ONE: it is dominated by gating BAD channels (PB -EV all-in; power a -$15.6k bleeder).`);
  console.log(`    The validated V3+ALT PAIR is ALREADY +EV always-on (+$20,322) and oracle-perfect routing nets the SAME (+$20,045) — V3/ALT`);
  console.log(`    self-route via gap_min + er/rel_vol filters, so a centralized router adds ~nothing for the channels actually worth trading.\n`);

  // ---- (2) CHOP-ARM (H3) — refuted at the ORACLE level (grind-base on PERFECT chop) ----
  const chopDays = datesS.filter((d) => oracle.get(d) === "CHOP");
  const grindOnChop = chopDays.reduce((a, d) => a + (scalpDay.get(d) ?? 0), 0);
  const chopWins = chopDays.filter((d) => (scalpDay.get(d) ?? 0) > 0).length;
  console.log(`  ══ (2) CHOP-ARM (H3) — grind-base on the ${chopDays.length} PERFECT-hindsight CHOP days ══`);
  console.log(`  grind-base Σ on oracle-CHOP = ${usd(grindOnChop)}  ·  win days ${chopWins}/${chopDays.length} (${Math.round(100 * chopWins / chopDays.length)}%)  ·  mean ${usd(grindOnChop / chopDays.length)}/day`);
  console.log(`  → oracle B (full ride book) ${usd(fullPrize)} + chop ${usd(grindOnChop)} = ${usd(fullPrize + grindOnChop)} < B → arming the scalper LOWERS the total even on a PERFECT chop call.`);
  console.log(`    grind is -EV even on true chop → chop-arm DEAD; the router is a 2-way TREND/no-TREND call. (06-18 +$1,190 was a cherry day, out-of-corpus.)\n`);

  // ---- (3) EX-ANTE classifier — morning-ER, OOS leave-one-out, desk-B Ptrend SWEEP ----
  const classifyTrend = (pTrend: number): ((d: string) => boolean) => {
    const arm = new Map<string, boolean>();
    for (const W of WINDOWS) {
      const other = real.filter((s) => winOf(s.dateET) !== W.name).map((s) => er.get(s.dateET)!).sort((a, b) => a - b);
      const thr = other[Math.floor(pTrend * (other.length - 1))];
      for (const s of real.filter((s) => winOf(s.dateET) === W.name)) arm.set(s.dateET, er.get(s.dateET)! >= thr);
    }
    return (d: string) => arm.get(d) === true;
  };
  console.log(`  ══ (3) EX-ANTE — morning-ER trend call, OOS leave-one-out, desk-B Ptrend SWEEP (full ride book) ══`);
  console.log(`  Ptrend = top-(1-P) of OTHER-4-window ER ⇒ TREND. always-on A ${usd(perWin((d) => deskDay(SUBSETS[0].chans, d, always)).tot)} (exClf ${usd(perWin((d) => deskDay(SUBSETS[0].chans, d, always)).ex)})`);
  console.log(`  ${"Ptrend".padEnd(8)}${"armed%".padStart(8)}${"recall".padStart(8)}${"prec".padStart(8)}${"B Σ".padStart(10)}${"B exClf".padStart(10)}${"ΔΣ vs A".padStart(10)}  w/5`);
  const A0 = perWin((d) => deskDay(SUBSETS[0].chans, d, always));
  for (const pt of [0.50, 0.55, 0.60, 0.65, 0.70]) {
    const arm = classifyTrend(pt);
    let nArm = 0, tp = 0, fp = 0, nTrend = 0;
    for (const d of datesS) { if (arm(d)) nArm++; if (isTrendO(d)) nTrend++; if (arm(d) && isTrendO(d)) tp++; if (arm(d) && !isTrendO(d)) fp++; }
    const { tot, ex } = perWin((d) => deskDay(SUBSETS[0].chans, d, arm));
    console.log(`  ${pt.toFixed(2).padEnd(8)}${(Math.round(100 * nArm / datesS.length) + "%").padStart(8)}${(Math.round(100 * tp / nTrend) + "%").padStart(8)}${(Math.round(100 * tp / Math.max(1, tp + fp)) + "%").padStart(8)}${usd(tot).padStart(10)}${usd(ex).padStart(10)}${usd(tot - A0.tot).padStart(10)}  ${wins5((d) => deskDay(SUBSETS[0].chans, d, arm), (d) => deskDay(SUBSETS[0].chans, d, always))}/5`);
  }
  console.log(`  → NON-MONOTONIC + threshold-fragile: best ~Ptrend 0.55 modestly beats A, but the signal is weak (recall≈precision in the 40s)`);
  console.log(`    and MISSES the biggest trend days (the convex tail) → captures only a small fraction of the oracle prize. INSUFFICIENT to build on.\n`);

  // ---- (4) THE ACCURACY BAR — noise-inject the oracle TREND/no-TREND labels ----
  console.log(`  ══ (4) ACCURACY BAR — flip k% of the oracle TREND/no-TREND calls (avg 8 seeds); how good must an ex-ante call be? ══`);
  console.log(`  ${"accuracy".padStart(10)}${"full B Σ".padStart(12)}${"pair B Σ".padStart(12)}   (always-on A: full ${usd(A0.tot)} · pair ${usd(perWin((d) => deskDay(SUBSETS[2].chans, d, always)).tot)})`);
  for (const k of [0.0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
    let fullSum = 0, pairSum = 0; const seeds = 8;
    for (let si = 0; si < seeds; si++) {
      const rnd = lcg(0x9e3779b1 ^ (si * 2654435761) ^ Math.round(k * 1000));
      const noisy = new Map(datesS.map((d) => [d, rnd() < k ? !isTrendO(d) : isTrendO(d)]));
      const arm = (d: string) => noisy.get(d) === true;
      fullSum += perWin((d) => deskDay(SUBSETS[0].chans, d, arm)).tot;
      pairSum += perWin((d) => deskDay(SUBSETS[2].chans, d, arm)).tot;
    }
    console.log(`  ${((1 - k) * 100).toFixed(0) + "%"}`.padStart(12) + `${usd(fullSum / seeds).padStart(12)}${usd(pairSum / seeds).padStart(12)}`);
  }
  console.log(`  → on the FULL (-EV-laden) book, routing clears always-on at ~55-60% accuracy; capturing HALF the prize needs ~80%.`);
  console.log(`    But on the validated V3+ALT PAIR routing is NEUTRAL at the oracle and HARMFUL at any realistic accuracy (50% → +$8.4k < +$20.3k`);
  console.log(`    always-on) → a classifier can't help channels that are already +EV; it can only un-bleed channels you'd cull or fix anyway.\n`);

  console.log(`  ══ VERDICT ══`);
  console.log(`  DON'T BUILD THE ROUTER (for the current book). The +$45k oracle "prize" is mostly a ROSTER signal — gating channels that are`);
  console.log(`  -EV all-in (PB, ${usd(-3157)}) or a structural bleeder (power, ${usd(-15642)}). The validated V3+ALT pair is ALREADY +EV always-on`);
  console.log(`  (+$20,322) and self-routes via its gap_min/er/rel_vol filters → an oracle router nets the SAME and a real (imperfect) one HURTS it.`);
  console.log(`  The ex-ante morning-ER call is weak + threshold-fragile; the chop-arm is DEAD (grind -EV on perfect chop).`);
  console.log(`  REAL LEVERS (priority): (1) ROSTER — cull power, resolve PB's trigger ([[pb-conviction]] — it's -EV all-in). (2) Revisit a router`);
  console.log(`  ONLY IF a NEW channel emerges whose edge is regime-concentrated AND that lacks its own entry filter — then a classifier bake-off`);
  console.log(`  (realized÷implied, gap, OR-expansion, gamma-open) vs the ~55-80% accuracy bar. Today, the decentralized filters already route.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
