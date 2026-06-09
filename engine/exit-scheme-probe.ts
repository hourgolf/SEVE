// ============================================================================
//  exit-scheme-probe — does a SCALE-OUT + BREAKEVEN + PROFIT-TRAIL scheme beat a
//  fixed bracket / ride on the live Tier 2 channels? (operator challenge 06-09)
//
//  tier2-target-probe only swept a SINGLE fixed take-profit target — a strawman for
//  the real alternative: "take half off at +50%, move the rest to breakeven, let the
//  runner go, protect it with a trailing profit-stop." That's the smart-layer management
//  scheme (engine/manage.ts), NOT a flat target. This probe runs that exact scheme through
//  the REAL tranched state machine on real NBBO, head-to-head with ride / fixed / breakeven.
//
//    npm run exit-scheme-probe                       # ungated, max-contracts sizing
//    npm run exit-scheme-probe -- --live             # + cost gate (3.0) + 0.20% underlying stop
//    npm run exit-scheme-probe -- --live --daily-stop 500   # + per-channel daily realized-loss halt
//
//  SCHEMES (all share the −50% premium hard-stop backstop; same entries per channel):
//    ride        — no take-profit; ride to the channel's live flatten. (the tier2 pick)
//    fix(live)   — the channel's live take-profit (+75/+90/+100) + −50% stop.
//    +100/BE     — take profit only at +100%; once green (+30%) ratchet stop to entry.
//                  (the "1-in-9 winner or breakeven" scheme, as a foil.)
//    trail·g35   — TRAIL-ONLY via manage.ts: engage the giveback trail at entry, scale
//                  NOTHING. Isolates the exit-ENGINE (manage trail+BE vs native exits) so
//                  trail·g35→scale·g35 = the pure effect of the scale-out.
//    scale·gNN   — OPERATOR SCHEME via manage.ts: at +50% (=+1R) sell HALF + engage trail;
//                  the runner is protected by a premium-giveback stop (give back NN% of
//                  peak gain → lock 100−NN%) PLUS a breakeven floor. g20 tighter than g35.
//
//  --live mirrors the LIVE worker: cost gate COST_GATE_RATIO=3.0 (none of these 5 is the
//  exempt `power` slug) + the per-channel 0.20% underlying initial stop (POWERHOUR=0) +
//  QQQ capped at max_contracts 4. NOTE: the engine's riskGovernor uses the LEGACY budget
//  (capital_pct% of $100k × aggression%), which at 100/100 pins qty to max_contracts — so
//  BOTH modes already size at ~live magnitude (6 contracts; QQQ 4), NOT $100-risk.
//
//  Reports per channel: pooled total$ · positions · win% (a scaled position is ONE
//  position, green if its tranches net > 0), then per-window total$. Faithful entries:
//  4 SPY channels embed their live strategists.spec_json (2026-06-09); breakout-qqq runs
//  the builtin bare ORB (worker base-slug rule). Real Databento NBBO.
// ============================================================================

import { simulateSession } from "./backtest";
import { specToStrategyDef } from "./specEvaluate";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Management, StrategySpec } from "../lib/desk/strategySpec";
import type { Bar, Evaluate, FundState, StrategistConfig, Trade } from "./types";

const LIVE = process.argv.includes("--live");
const dsi = process.argv.indexOf("--daily-stop");
const DAILY_STOP = dsi >= 0 && process.argv[dsi + 1] ? Number(process.argv[dsi + 1]) : 1e9;
const COST_GATE_RATIO = 3.0;

const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

// ── LIVE spec_json entries (strategists.spec_json, Supabase 2026-06-09) ──────────────
const ENTRIES_ORB: StrategySpec["entries"] = [
  { direction: "call", reason: "orb_up", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  { direction: "put", reason: "orb_dn", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
];
const ENTRIES_POWER: StrategySpec["entries"] = [
  { direction: "call", reason: "power_long", all: [{ kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
  { direction: "put", reason: "power_short", all: [{ kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.25, lookback: 3 }, { kind: "time_between", startET: "15:00", endET: "15:45" }] },
];
const ENTRIES_ALT: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 3 }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const ENTRIES_ALT_V3: StrategySpec["entries"] = [
  { direction: "call", reason: "break_high", all: [{ kind: "opening_range", side: "break_above", minutes: 30 }, { kind: "vwap_side", side: "above" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
  { direction: "put", reason: "break_low", all: [{ kind: "opening_range", side: "break_below", minutes: 30 }, { kind: "vwap_side", side: "below" }, { kind: "efficiency_ratio", op: ">=", value: 0.45, lookback: 20 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:25" }] },
];
const mkSpec = (id: string, entries: StrategySpec["entries"], timeET: string): StrategySpec => ({
  meta: { name: id, regime: "directional", dteRange: [0, 1], direction: "directional", structure: "single-leg", instrument: "SPX", strategyId: id } as StrategySpec["meta"],
  exits: [{ timeET }], entries, sizing: {},
});
const BUILTIN_BREAKOUT: Evaluate = (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS);

type Channel = { name: string; slug: string; underlying: string; live: number; eodMin: number; maxC: number; ustop: number; makeEval: (s: RealSession) => Evaluate };
const specEval = (spec: StrategySpec): ((s: RealSession) => Evaluate) => {
  const def = specToStrategyDef(spec);
  return (s) => def.build(s.bars as Bar[], def.timeframeMin, { pdh: s.pdh, pdl: s.pdl });
};
// eodMin = minutes-to-close of the channel's live flatten (15:25→35, 15:30→30, 15:55→5).
// maxC/ustop = live strategist_config max_contracts / underlying_stop_pct.
const CHANNELS: Channel[] = [
  { name: "ORB(base)",      slug: "orb-trend-rider",        underlying: "SPY", live: 75,  eodMin: 30, maxC: 6, ustop: 0.20, makeEval: specEval(mkSpec("orb", ENTRIES_ORB, "15:30")) },
  { name: "QQQ-Break-ORB",  slug: "breakout-qqq",           underlying: "QQQ", live: 90,  eodMin: 30, maxC: 4, ustop: 0.20, makeEval: () => BUILTIN_BREAKOUT },
  { name: "POWERHOUR(ALT)", slug: "power-smart-entries",    underlying: "SPY", live: 100, eodMin: 5,  maxC: 6, ustop: 0,    makeEval: specEval(mkSpec("pwr", ENTRIES_POWER, "15:55")) },
  { name: "BREAK(ALT)",     slug: "breakout-smart-entries", underlying: "SPY", live: 100, eodMin: 35, maxC: 6, ustop: 0.20, makeEval: specEval(mkSpec("alt", ENTRIES_ALT, "15:25")) },
  { name: "BREAK(ALT-V3)",  slug: "breakout-alt-v3",        underlying: "SPY", live: 100, eodMin: 35, maxC: 6, ustop: 0.20, makeEval: specEval(mkSpec("v3", ENTRIES_ALT_V3, "15:25")) },
];

const cfgFor = (ch: Channel): StrategistConfig => ({ slug: "ex", capital_pct: 100, aggression: 100, max_contracts: ch.maxC, daily_stop_usd: DAILY_STOP, muted: false, soloed: false });
const ustopOf = (ch: Channel) => (LIVE ? ch.ustop : 0);
const gate = () => (LIVE ? { minMoveToCostRatio: COST_GATE_RATIO } : undefined);

// manage.ts Management blocks. scale = half off @ +1R(+50%) then trail; trail-only =
// engage trail at entry (atR 0, fraction 0 → no scale-out, manage.ts owns the exit).
const baseMgmt = (eodMin: number): Pick<Management, "risk" | "trail" | "eodFlattenMinToClose" | "costGate"> => ({
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  eodFlattenMinToClose: eodMin,
  ...(LIVE ? { costGate: { minMoveToCostRatio: COST_GATE_RATIO } } : {}),
});
const scaleMgmt = (giveback: number, eodMin: number): Management => ({ ...baseMgmt(eodMin), scaleOut: [{ atR: 1.0, fraction: 0.5, then: "engage_trail" }], trail: { mode: "premium_giveback", premiumGivebackPct: giveback } });
// trail-only: engage the trail at the SAME +1R point as scale·gNN but sell NOTHING
// (fraction 0). Below +1R only the −50% premium stop binds — so scale·gNN vs trail·gNN
// isolates the SCALE-OUT alone (both trail the position from +1R; one halved it first).
const trailOnlyMgmt = (giveback: number, eodMin: number): Management => ({ ...baseMgmt(eodMin), scaleOut: [{ atR: 1.0, fraction: 0, then: "engage_trail" }], trail: { mode: "premium_giveback", premiumGivebackPct: giveback } });

type Scheme = { key: string; run: (ch: Channel, set: RealSession[], chainOf: (s: RealSession) => ChainProvider) => Trade[] };
const sim = (ch: Channel, set: RealSession[], chainOf: (s: RealSession) => ChainProvider,
  opts: { premiumExit?: { profitPct?: number; stopPct?: number }; breakevenExit?: { engagePct: number; lockPct?: number }; management?: Management }): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, cfgFor(ch), FUND, ch.makeEval(s), chainOf(s), false,
    opts.premiumExit, NBBO, opts.management, undefined, opts.breakevenExit,
    undefined /* lateGate */, ustopOf(ch), opts.management ? undefined : gate()));

const SCHEMES: Scheme[] = [
  { key: "ride",      run: (ch, set, c) => sim(ch, set, c, { premiumExit: { stopPct: 50 } }) },
  { key: "fix(live)", run: (ch, set, c) => sim(ch, set, c, { premiumExit: { stopPct: 50, profitPct: ch.live } }) },
  { key: "+100/BE",   run: (ch, set, c) => sim(ch, set, c, { premiumExit: { stopPct: 50, profitPct: 100 }, breakevenExit: { engagePct: 30, lockPct: 0 } }) },
  { key: "trail·g35", run: (ch, set, c) => sim(ch, set, c, { management: trailOnlyMgmt(35, ch.eodMin) }) },
  { key: "scale·g35", run: (ch, set, c) => sim(ch, set, c, { management: scaleMgmt(35, ch.eodMin) }) },
  { key: "scale·g20", run: (ch, set, c) => sim(ch, set, c, { management: scaleMgmt(20, ch.eodMin) }) },
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

function posStats(tr: Trade[]): { total: number; pos: number; winPct: number } {
  const byPos = new Map<string, number>();
  for (const t of tr) {
    const k = `${t.entryTs}|${t.strike}|${t.optType}`;
    byPos.set(k, (byPos.get(k) ?? 0) + t.pnl);
  }
  const pnls = [...byPos.values()];
  const total = tr.reduce((a, t) => a + t.pnl, 0);
  const wins = pnls.filter((p) => p > 0).length;
  return { total, pos: pnls.length, winPct: pnls.length ? (wins / pnls.length) * 100 : 0 };
}

const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
  { name: "TREND-OOS MA25", from: "2025-05-01", to: "2025-08-31" },
  { name: "TREND 24",       from: "2024-05-01", to: "2024-08-31" },
  { name: "CHOP-MIX 25-26", from: "2025-11-01", to: "2026-02-28" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const spy = await loadFor("SPY", sinceDaysAgo);
  const qqq = await loadFor("QQQ", sinceDaysAgo);
  const loadedOf = (u: string) => (u === "QQQ" ? qqq : spy);

  const mode = LIVE ? `LIVE (cost gate ${COST_GATE_RATIO} + 0.20% underlying stop${DAILY_STOP < 1e9 ? ` + $${DAILY_STOP} daily-stop` : ""})` : "ungated";
  console.log(`\n  EXIT-SCHEME head-to-head · real-NBBO · −50% hard stop on all · ${mode}`);
  console.log(`  SPY ${spy.real.length} sessions · QQQ ${qqq.real.length} sessions · sizing pinned to max_contracts (6; QQQ 4)`);
  console.log(`  scale·gNN = OPERATOR: half off @ +50% → trail (give back NN% of peak) + breakeven floor; trail·g35 = trail-only (no scale)\n`);
  const hdr = "  " + "window".padEnd(16) + SCHEMES.map((s) => s.key.padStart(12)).join("");

  for (const ch of CHANNELS) {
    const ld = loadedOf(ch.underlying);
    console.log(`  ══ ${ch.name}  [${ch.slug} · ${ch.underlying}${ch.underlying === "QQQ" ? " · builtin ORB" : ""} · live=+${ch.live}% · ustop ${LIVE ? ch.ustop : 0}] ══`);
    console.log(hdr);
    const pooled = SCHEMES.map((s) => posStats(s.run(ch, ld.real, ld.chainOf)));
    console.log("  " + "POOLED total$".padEnd(16) + pooled.map((p) => `${sgn(p.total)}${Math.round(p.total)}`.padStart(12)).join(""));
    console.log("  " + "  win% · pos".padEnd(16) + pooled.map((p) => `${p.winPct.toFixed(0)}w·${p.pos}`.padStart(12)).join(""));
    for (const w of WINDOWS) {
      const win = ld.real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
      if (!win.length) continue;
      const cells = SCHEMES.map((s) => posStats(s.run(ch, win, ld.chainOf)).total);
      console.log("  " + w.name.padEnd(16) + cells.map((v) => `${sgn(v)}${Math.round(v)}`.padStart(12)).join(""));
    }
    console.log("");
  }
  console.log("  READ: trail·g35→scale·g35 isolates the SCALE-OUT; ride→trail·g35 isolates the exit-ENGINE (manage vs native).");
  console.log("  scale WINS only if total$ beats ride AND holds across windows. Convex-tail channels (BREAK ALT/V3): expect");
  console.log("  ride to win (scaling caps the tail). Tail-less weak channels: expect scale to reduce loss (risk control).\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
