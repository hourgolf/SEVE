// ============================================================================
//  qqq-orb-armtrail-probe — can the ARMABLE atr_chandelier trail be TUNED to
//  capture the exit-scheme-probe benefit on QQQ-Break-ORB using ONLY a live-
//  deployable exit? (06-15 lane)
//
//  CONTEXT: exit-scheme-probe found QQQ-Break-ORB (the breakout-qqq builtin bare
//  ORB on QQQ chains) is a tail-LESS bleeder: RIDE pooled ≈ −$5,118, but a SCALE-OUT
//  + premium-giveback scheme (scale·g35) flipped it to ≈ +$3,848. PROBLEM: scale-out
//  is NOT armable — strategySpec.ts isArmableManagement() returns false for any
//  scaleOut, and the live worker (decide.ts) only runs the underlying ATR-chandelier
//  trail (trailK = specTrail(spec.management).atrChandelierK). So the winning scheme
//  CAN'T be deployed.
//
//  THIS LANE: is the protection benefit reachable with the ONE armable protective
//  exit? Run QQQ-Break-ORB with the ARMABLE atr_chandelier trail (trailExit.
//  atrChandelierK — byte-identical to decide.ts L198-203), sweeping baseK
//  {0.5,1.0,1.5,2.0,2.5}, head-to-head vs:
//    • ride        — anchor ≈ −$5,118 (the exit-scheme-probe RIDE number; SANITY)
//    • scale·g35   — anchor ≈ +$3,848 (the NON-ARMABLE target, via manage.ts)
//
//  ALL share the −50% premium hard stop + the --live cost gate (3.0) + the live
//  ustop (breakout-qqq = 0.20%). The armable-trail schemes route through the SIMPLE
//  exit path (trailExit), exactly as the worker does — NOT manage.ts.
//
//  CLEARS BAR if any armable trailK flips QQQ-Break-ORB to +EV (>0) on the available
//  windows → the protection benefit is reachable with an armable exit.
//
//    npx tsx engine/qqq-orb-armtrail-probe.ts          # cost gate + ustop ON (live)
//
//  ⚠ QQQ has ONLY 2 in-corpus windows (Mar26, AprMay26) — THIN data. breakout-qqq
//  is BENCHED (06-12 cull). Real Databento NBBO.
// ============================================================================

import { simulateSession } from "./backtest";
import { breakoutEvaluate, DEFAULT_BREAKOUT_PARAMS } from "./strategies/breakout";
import { loadRealSessions, type RealSession } from "./realsource";
import { makeDatabentoChain, loadDatabentoByDay } from "./databentosource";
import { priceChain } from "./market";
import { DEFAULT_COST_MODEL, type CostModel } from "./cost";
import type { ChainProvider } from "./optionsource";
import type { Management, StrategySpec } from "../lib/desk/strategySpec";
import { specTrail } from "../lib/desk/strategySpec";
import type { Evaluate, FundState, StrategistConfig, Trade } from "./types";

const COST_GATE_RATIO = 3.0;
const FUND: FundState = { total_capital_usd: 100000, master_daily_stop_usd: 1e9, is_halted: false };
const NBBO: CostModel = { ...DEFAULT_COST_MODEL, spreadSource: "option_bars" };

// ── QQQ-Break-ORB = the breakout-qqq builtin bare ORB on QQQ (worker base-slug rule) ──
// Faithful to exit-scheme-probe's CHANNELS[1]: underlying QQQ, live=+90%, eodMin 30,
// maxC 4, ustop 0.20. Same builtin evaluator, same cost gate, same ustop.
const BUILTIN_BREAKOUT: Evaluate = (f, pos) => breakoutEvaluate(f, pos, DEFAULT_BREAKOUT_PARAMS);
const CH = { name: "QQQ-Break-ORB", slug: "breakout-qqq", underlying: "QQQ", live: 90, eodMin: 30, maxC: 4, ustop: 0.20 };
const cfg: StrategistConfig = { slug: "ex", capital_pct: 100, aggression: 100, max_contracts: CH.maxC, daily_stop_usd: 1e9, muted: false, soloed: false };

// ── the NON-ARMABLE target: scale·g35 via manage.ts (mirror of exit-scheme-probe) ──
const baseMgmt = (eodMin: number): Pick<Management, "risk" | "trail" | "eodFlattenMinToClose" | "costGate"> => ({
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  eodFlattenMinToClose: eodMin,
  costGate: { minMoveToCostRatio: COST_GATE_RATIO },
});
const scaleMgmt = (giveback: number, eodMin: number): Management => ({
  ...baseMgmt(eodMin),
  scaleOut: [{ atR: 1.0, fraction: 0.5, then: "engage_trail" }],
  trail: { mode: "premium_giveback", premiumGivebackPct: giveback },
});

// ── the ARMABLE atr_chandelier spec.management at a given baseK ──
//  This is EXACTLY the shape an uploaded/armed .md channel declares. specTrail()
//  extracts baseK → trailExit.atrChandelierK, which the live worker (decide.ts) and
//  the backtest run identically. Asserting it is armable proves deployability.
const armTrailMgmt = (baseK: number): Management => ({
  risk: { defineR: "premium_stop", premiumStopPct: 50 },
  eodFlattenMinToClose: CH.eodMin,
  trail: { mode: "atr_chandelier", atrChandelier: { baseK, kMin: baseK, rTighten: 0, timeTighten: 0 } },
});

// run helpers — both paths carry the −50% premium hard stop + live ustop + cost gate.
//   ride:      premiumExit { stopPct:50 } + entryCostGate (simple path)
//   armK:      trailExit { atrChandelierK } + premiumExit { stopPct:50 } + entryCostGate (simple path)
//   scale·g35: management (manage.ts owns exits incl. its own costGate)
const runRide = (set: RealSession[], chainOf: (s: RealSession) => ChainProvider): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, cfg, FUND, BUILTIN_BREAKOUT, chainOf(s), false,
    { stopPct: 50 }, NBBO, undefined, undefined, undefined, undefined, CH.ustop, { minMoveToCostRatio: COST_GATE_RATIO }));

const runArm = (baseK: number, set: RealSession[], chainOf: (s: RealSession) => ChainProvider): Trade[] => {
  const trail = specTrail(armTrailMgmt(baseK)); // proves the block is ARMABLE + extracts baseK
  if (!trail?.atrChandelierK) throw new Error(`armable trail did not resolve at baseK=${baseK}`);
  return set.flatMap((s) => simulateSession(s.bars, cfg, FUND, BUILTIN_BREAKOUT, chainOf(s), false,
    { stopPct: 50 }, NBBO, undefined, { atrChandelierK: trail.atrChandelierK }, undefined, undefined,
    CH.ustop, { minMoveToCostRatio: COST_GATE_RATIO }));
};

const runScale = (giveback: number, set: RealSession[], chainOf: (s: RealSession) => ChainProvider): Trade[] =>
  set.flatMap((s) => simulateSession(s.bars, cfg, FUND, BUILTIN_BREAKOUT, chainOf(s), false,
    undefined, NBBO, scaleMgmt(giveback, CH.eodMin), undefined, undefined, undefined, CH.ustop, undefined));

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

// QQQ has ONLY these 2 in-corpus regime windows (Databento NBBO).
const WINDOWS = [
  { name: "CHOP Mar26",     from: "2026-03-01", to: "2026-03-31" },
  { name: "TREND AprMay26", from: "2026-04-01", to: "2026-05-31" },
];
const sgn = (v: number) => (v >= 0 ? "+" : "");

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

const RIDE_ANCHOR = -5118;   // exit-scheme-probe RIDE pooled (the SANITY target)
const SCALE_ANCHOR = 3848;   // exit-scheme-probe scale·g35 pooled (the non-armable target)
const TRAIL_KS = [0.5, 1.0, 1.5, 2.0, 2.5];

async function main() {
  const di = process.argv.indexOf("--days");
  const sinceDaysAgo = di >= 0 && process.argv[di + 1] ? Number(process.argv[di + 1]) : 800;
  const ld = await loadFor(CH.underlying, sinceDaysAgo);

  console.log(`\n  QQQ-ORB ARMABLE-TRAIL probe · real-NBBO · −50% hard stop · LIVE (cost gate ${COST_GATE_RATIO} + ${CH.ustop}% ustop)`);
  console.log(`  ${CH.name} [${CH.slug} · QQQ · builtin bare ORB · live=+${CH.live}% · maxC ${CH.maxC}] — sizing pinned to max_contracts (4)`);
  console.log(`  QQQ ${ld.real.length} Databento sessions · ⚠ THIN: only 2 in-corpus windows (Mar26, AprMay26)`);
  console.log(`  Q: can the ONLY armable protective exit (atr_chandelier trail) flip this bleeder +EV?`);
  console.log(`  anchors → ride ${sgn(RIDE_ANCHOR)}${RIDE_ANCHOR} (SANITY) · scale·g35 ${sgn(SCALE_ANCHOR)}${SCALE_ANCHOR} (NON-armable target)\n`);

  // columns: ride | armK0.5 | armK1.0 | armK1.5 | armK2.0 | armK2.5 | scale·g35
  const cols = ["ride", ...TRAIL_KS.map((k) => `armK${k.toFixed(1)}`), "scale·g35"];
  const hdr = "  " + "window".padEnd(16) + cols.map((c) => c.padStart(11)).join("");
  console.log(hdr);

  // pooled
  const ridePooled = posStats(runRide(ld.real, ld.chainOf));
  const armPooled = TRAIL_KS.map((k) => posStats(runArm(k, ld.real, ld.chainOf)));
  const scalePooled = posStats(runScale(35, ld.real, ld.chainOf));
  const pooledCells = [ridePooled, ...armPooled, scalePooled];
  console.log("  " + "POOLED total$".padEnd(16) + pooledCells.map((p) => `${sgn(p.total)}${Math.round(p.total)}`.padStart(11)).join(""));
  console.log("  " + "  win% · pos".padEnd(16) + pooledCells.map((p) => `${p.winPct.toFixed(0)}w·${p.pos}`.padStart(11)).join(""));

  // per-window
  for (const w of WINDOWS) {
    const win = ld.real.filter((s) => s.dateET >= w.from && s.dateET <= w.to);
    if (!win.length) { console.log(`  ${w.name.padEnd(16)}${"(no sessions)".padStart(11)}`); continue; }
    const cells = [
      posStats(runRide(win, ld.chainOf)).total,
      ...TRAIL_KS.map((k) => posStats(runArm(k, win, ld.chainOf)).total),
      posStats(runScale(35, win, ld.chainOf)).total,
    ];
    console.log("  " + `${w.name} (${win.length}d)`.padEnd(16) + cells.map((v) => `${sgn(v)}${Math.round(v)}`.padStart(11)).join(""));
  }

  // verdict
  const sane = Math.abs(ridePooled.total - RIDE_ANCHOR) <= 400; // ≈ reproduces the exit-scheme-probe ride
  const bestArm = armPooled.reduce((b, p, i) => (p.total > b.total ? { total: p.total, k: TRAIL_KS[i] } : b), { total: -Infinity, k: 0 });
  const clears = bestArm.total > 0;
  console.log("");
  console.log(`  SANITY: ride pooled ${sgn(ridePooled.total)}${Math.round(ridePooled.total)} vs exit-scheme-probe ${RIDE_ANCHOR} → ${sane ? "MATCH ✓ (QQQ wiring sound)" : "MISMATCH ✗ (wiring suspect)"}`);
  console.log(`  BEST ARMABLE: armK${bestArm.k.toFixed(1)} = ${sgn(bestArm.total)}${Math.round(bestArm.total)} pooled  →  ${clears ? "FLIPS +EV with an armable exit ✓" : "still −EV; armable trail can't recover the scale-out benefit ✗"}`);
  console.log(`  vs ride ${sgn(ridePooled.total)}${Math.round(ridePooled.total)} (Δ ${sgn(bestArm.total - ridePooled.total)}${Math.round(bestArm.total - ridePooled.total)}) · vs non-armable scale·g35 ${sgn(scalePooled.total)}${Math.round(scalePooled.total)} target`);
  console.log(`  ⚠ THIN 2-window QQQ data (no pre-2026 OOS) · breakout-qqq is BENCHED (06-12 cull).\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
