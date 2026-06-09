// ============================================================================
//  tier2-target-probe — CONSERVATIVE take-profit sweep on the LIVE "Tier 2" roster
//
//  The agenda (operator thesis 06-09, confirmed by mfe-probe hit-rates): the Tier 2
//  channels run ASPIRATIONAL premium targets (+75/+90/+100%) that almost never fire —
//  only ~11% of lean trades ever pop +100%, ~21% reach +50%, ~30% reach +30% (the
//  mfe-probe MFE-survival curve). A +100% target therefore triggers ~1-in-9; for the
//  other 8 it never fires and the channel effectively RIDES TO CLOSE, giving back every
//  sub-target gain. So Tier 2 ≈ Tier 1 in practice. This probe asks, per channel: does
//  a REALISTIC conservative target (+30/+40/+50) genuinely lift PER-TRADE EXPECTANCY
//  across multiple windows (a real keeper), or only reduce loss mechanically by cutting
//  average trades on a −EV book (the same mirage breakeven-stop / late-leans-gate hit)?
//
//    npm run tier2-probe -- --days 800
//
//  KEY TENSION (likely a per-channel SPLIT): scalp-edge-probe showed the genuine breakout
//  EDGE *is* the convex tail (BREAK(ALT) Mar26 +100% = +$2,271, +15% = −$56 — a tight
//  target CAPS what pays). So we expect: RIDE the real-edge channels (BREAK(ALT)/V3);
//  BANK the weaker Tier 2 with no real tail (ORB-base, QQQ-Break-ORB, POWERHOUR-ALT) at
//  a conservative target. Falsifiable: if a +30–50% target lifts the weak channels'
//  exp$/t across windows → keeper; if it only caps the BREAK tail → those stay aspirational.
//
//  Reads the WRONG-vs-RIGHT tell three ways per channel:
//    • exp$/t pooled      — does a tighter target raise per-trade EV? (scale-invariant)
//    • hit%               — frac reaching the target = MFE survival (how often it fires)
//    • per-window total$   AND per-window exp$/t  — total$ can rise from fewer trades on a
//      −EV book (mechanical); exp$/t rising across MULTIPLE windows is the real signal.
//
//  Faithful to LIVE: the 4 SPY channels are compiled-spec channels — their ENTRY specs
//  are embedded VERBATIM from the live strategists.spec_json (pulled 2026-06-09). The
//  worker's base-slug resolver routes `breakout-qqq` to the BUILTIN `breakout` (ORB) on
//  QQQ — its spec_json is dormant live — so we run the builtin here too. We override the
//  exit with {−50% stop + swept target}, isolating the TARGET (entries held fixed). Cost
//  gate + underlying-stop omitted (both only help) → conservative. Sizing matches
//  scalp-edge-probe (RISK $100/trade, 6-contract cap) so BREAK(ALT)/V3 cross-check its
//  documented numbers; live runs RISK $500 → multiply total$ by ~5 for live magnitude.
// ============================================================================

import { simulateSession, metrics } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const CFG: StrategistConfig = { slug: "t2", capital_pct: 100, aggression: 100, max_contracts: 6, daily_stop_usd: 1e9, muted: false, soloed: false };
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

// ── LIVE spec_json (strategists.spec_json, pulled from Supabase 2026-06-09) ──────────
// Only the ENTRY conditions matter here (exits are overridden by the target sweep).
const SPEC_ORB_TREND: StrategySpec = {
  meta: { name: "ORB Trend Rider", regime: "trending / momentum", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "orb-trend-rider", sessionWindow: "09:45-15:00 ET" } as StrategySpec["meta"],
  exits: [{ profitPct: 75 }, { stopPct: 50 }, { timeET: "15:30" }],
  entries: [
    { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
    { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  ],
  sizing: {},
};
const SPEC_POWER_SMART: StrategySpec = {
  meta: { name: "Power Hour (Smart Entries)", regime: "final hour", dteRange: [0, 0], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "power-smart-entries", sessionWindow: "15:00-15:45 ET" } as StrategySpec["meta"],
  exits: [{ profitPct: 100 }, { stopPct: 50 }, { timeET: "15:55" }],
  entries: [
    { direction: "call", reason: "power_long", all: [{ kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
    { direction: "put", reason: "power_short", all: [{ kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
  ],
  sizing: {},
};
const SPEC_BREAK_ALT: StrategySpec = {
  meta: { name: "Breakout (Smart Entries)", regime: "trending / momentum", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "breakout-smart-entries", sessionWindow: "10:00-15:25 ET" } as StrategySpec["meta"],
  exits: [{ profitPct: 100 }, { stopPct: 50 }, { timeET: "15:25" }],
  entries: [
    { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
    { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  ],
  sizing: {},
};
const SPEC_BREAK_ALT_V3: StrategySpec = {
  meta: { name: "Breakout (Smart Entries V3)", regime: "trending / momentum", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: "breakout-alt-v3", sessionWindow: "10:00-15:25 ET" } as StrategySpec["meta"],
  exits: [{ profitPct: 100 }, { stopPct: 50 }, { timeET: "15:25" }],
  entries: [
    { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
    { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  ],
  sizing: {},
};

// Builtin breakout (ORB) — what the live worker actually runs for breakout-qqq.
const BUILTIN_BREAKOUT: Evaluate = (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS);

type Channel = { name: string; slug: string; underlying: string; live: number | "ride"; makeEval: (s: RealSession) => Evaluate };
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
// Order: weak-tier candidates (bank?) first, real-edge channels (ride?) last.
const CHANNELS: Channel[] = [
  { name: "ORB(base)",      slug: "orb-trend-rider",        underlying: "SPY", live: 75,  makeEval: specEval(SPEC_ORB_TREND) },
  { name: "QQQ-Break-ORB",  slug: "breakout-qqq",           underlying: "QQQ", live: 90,  makeEval: () => BUILTIN_BREAKOUT },
  { name: "POWERHOUR(ALT)", slug: "power-smart-entries",    underlying: "SPY", live: 100, makeEval: specEval(SPEC_POWER_SMART) },
  { name: "BREAK(ALT)",     slug: "breakout-smart-entries", underlying: "SPY", live: 100, makeEval: specEval(SPEC_BREAK_ALT) },
  { name: "BREAK(ALT-V3)",  slug: "breakout-alt-v3",        underlying: "SPY", live: 100, makeEval: specEval(SPEC_BREAK_ALT_V3) },
];

const TARGETS: (number | null)[] = [null, 100, 75, 50, 40, 30];
const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",       from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];

interface Loaded { real: RealSession[]; chainOf: (s: RealSession) => ChainProvider }
async function loadFor(u: string, sinceDaysAgo: number): Promise<Loaded> {
  const sessions = await loadRealSessions({ symbol: u, sinceDaysAgo });
  const byDay = loadDatabentoByDay(sessions.map((s) => s.dateET), u) as unknown as Map<string, unknown[]>;
  const real = sessions.filter((s) => (byDay.get(s.dateET)?.length ?? 0) > 0);
  const chainOf = (s: RealSession): ChainProvider => {
    const c = byDay.get(s.dateET);
    if (c && c.length) return makeDatabentoChain(c as Parameters<typeof makeDatabentoChain>[0]);
    return (spot, mtc) => priceChain(spot, mtc, s.ivAnnual);
  };
  return { real, chainOf };
}

interface Cell { exp: number; hit: number; win: number; n: number; total: number }
function sweep(ch: Channel, ld: Loaded, set: RealSession[]): Cell[] {
  return TARGETS.map((t) => {
    const tr: Trade[] = set.flatMap((s) => simulateSession(s.bars, CFG, FUND, ch.makeEval(s), ld.chainOf(s), false,
      { stopPct: 50, ...(t != null ? { profitPct: t } : {}) }, NBBO));
    const m = metrics(tr, set.length);
    const hit = tr.length ? (tr.filter((x) => x.exitReason === "target_premium").length / tr.length) * 100 : 0;
    return { exp: tr.length ? m.totalPnl / tr.length : 0, hit, win: m.winRate * 100, n: tr.length, total: m.totalPnl };
  });
}

const sgn = (v: number) => (v >= 0 ? "+" : "");
async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const spy = await loadFor("SPY", sinceDaysAgo);
  const qqq = await loadFor("QQQ", sinceDaysAgo);
  const loadedOf = (u: string) => (u === "QQQ" ? qqq : spy);

  console.log(`\n  TIER 2 · conservative take-profit sweep · real-NBBO · −50% stop · RISK $100/t (×5 for live)`);
  console.log(`  SPY ${spy.real.length} sessions · QQQ ${qqq.real.length} sessions · targets: ride / +100 / +75 / +50 / +40 / +30`);
  console.log(`  per cell where shown: exp$/t · hit% · win%·w · n     [ride = ride-to-close; "live" marks the channel's current target]\n`);
  const hdr = "          " + TARGETS.map((t) => (t == null ? "ride" : `+${t}%`).padStart(13)).join("");

  for (const ch of CHANNELS) {
    const ld = loadedOf(ch.underlying);
    const liveTag = TARGETS.map((t) => ((t == null ? "ride" : t) === ch.live ? "↑live" : "")).map((x) => x.padStart(13)).join("");
    console.log(`  ══ ${ch.name}  [${ch.slug} · ${ch.underlying} · ${ch.underlying === "QQQ" ? "builtin ORB" : "spec"}] ══`);
    console.log("          " + liveTag);
    console.log(hdr);
    const pooled = sweep(ch, ld, ld.real);
    console.log("  exp$/t  " + pooled.map((c) => `${sgn(c.exp)}${c.exp.toFixed(1)}`.padStart(13)).join(""));
    console.log("  hit%    " + pooled.map((c, i) => (i === 0 ? "—" : `${c.hit.toFixed(0)}%`).padStart(13)).join(""));
    console.log("  win%    " + pooled.map((c) => `${c.win.toFixed(0)}w`.padStart(13)).join(""));
    console.log("  n       " + pooled.map((c) => `${c.n}`.padStart(13)).join(""));
    console.log("  total$  " + pooled.map((c) => `${sgn(c.total)}${Math.round(c.total)}`.padStart(13)).join(""));
    console.log("  ── per-window  total$  (mechanical loss-reduction shows here) ──");
    for (const w of WINDOWS) {
      const win = ld.real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const cells = sweep(ch, ld, win);
      console.log("  " + w.name.padEnd(8) + cells.map((c) => `${sgn(c.total)}${Math.round(c.total)}`.padStart(13)).join(""));
    }
    console.log("  ── per-window  exp$/t·n  (the REAL tell — does per-trade EV rise across windows?) ──");
    for (const w of WINDOWS) {
      const win = ld.real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const cells = sweep(ch, ld, win);
      console.log("  " + w.name.padEnd(8) + cells.map((c) => `${sgn(c.exp)}${c.exp.toFixed(0)}·${c.n}`.padStart(13)).join(""));
    }
    console.log("");
  }
  console.log("  READ: a conservative target is a KEEPER only if exp$/t RISES (pooled AND across multiple windows) vs ride/live.");
  console.log("  If total$ rises but exp$/t is flat-to-worse, it's the mechanical mirage (fewer trades on a −EV book), not edge.");
  console.log("  If exp$/t PEAKS at ride/+100 (convex tail), keep the channel aspirational and RIDE it.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
