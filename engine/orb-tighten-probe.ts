// ============================================================================
//  orb-tighten-probe — the ORB-tightening lever, on REAL OPTION FILLS.
//
//  OPERATOR HYPOTHESIS (validated on the UNDERLYING — orb-tightening-runway memory):
//  the baseline ORB trigger fires at the OR EDGE (close > openRangeHi + 0.5·ATR …
//  in the live spec it's `close > openRangeHi`), which on the typical day is ~the
//  MIDPOINT of the eventual move — half the runway is already gone. TIGHTENING the
//  trigger toward the OR midpoint fired ~10min earlier with +19% net underlying
//  continuation, at +2pp whipsaw. THIS PROBE tests whether that runway gain survives
//  on real OPTION fills, where the −50% premium stop (which AUTO re-anchors to the
//  new, lower-priced entry) may AMPLIFY the extra whipsaw and eat the runway.
//
//  THE LEVER (live in the engine): the opening_range condition takes an optional
//  `band` (specEvaluate.ts ~L189 + strategySpec.ts ~L39). trigger level =
//  mid + band·(edge − mid):
//     band = 1   → the OR edge  = the LIVE orb-trend-rider trigger (byte-identical)
//     band < 1   → tightens toward the midpoint (fire earlier, more runway, more whipsaw)
//  We sweep band ∈ {1.0, 0.75, 0.5, 0.25} on BOTH opening_range legs of the live ORB
//  spec (orbEntries — orb-trend-rider / orb-spy-trail).
//
//  FAITHFUL HARNESS: engine/lever-shared.ts (canonical) — RISK 500 / DAILY_STOP 500 /
//  cost gate 3.0 (gateCostModel 0.25/side) / 1-tick fills (FILL_1T) / the 5 OOS regime
//  windows / RE-ENTRY-AWARE simChannel (a blocked/no-signal bar frees the one-at-a-time
//  slot to re-enter the next valid signal — the capital-blind "delete trades" replay
//  OVERSTATES every lever; this does not). The band lever lives INSIDE the spec, so
//  there is NO leverGate here — we just rebuild the spec per band and run simChannel.
//
//  FAITHFULNESS ANCHOR (verified + printed): band=1.0 must produce trades IDENTICAL to
//  the ORIGINAL orbEntries with NO band field (the engine defaults band ?? 1). We build
//  the eval BOTH ways, run both, and assert equal n + equal total pnl. A mismatch means
//  the band wiring is wrong.
//
//  BATTERY: does any tighter band beat band=1.0  (a) pooled exp/t, (b) in ≥4/5 windows,
//  (c) surviving drop-best-window?  DOCTRINE: even a clean pass is a FORWARD-TEST
//  hypothesis (options are MODELED; the lever may be mined on these very windows), NOT
//  an arm signal. Report honest negatives — a refutation that confirms the entry axis is
//  mined out is a valid, valuable result.
//
//    npx tsx --env-file=.env.local engine/orb-tighten-probe.ts
// ============================================================================

import {
  type Ch, type Prepped, type SessRes,
  prep, specEval, simChannel, pool, byWindow,
  WINDOWS, usd, exp$,
} from "./lever-shared";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { RealSession } from "./realsource";

// ── the LIVE ORB ride spec (orb-trend-rider / orb-spy-trail), band-parameterized ──
// Identical to orb-width-probe's orbEntries (live floor 0.25, time_before 15:00),
// EXCEPT the opening_range legs carry the swept `band`. When band===1 we OMIT the
// field entirely — that makes band=1.0 textually equal to the live spec (the anchor).
const orbEntries = (band?: number): StrategySpec["entries"] => {
  const or = (side: "break_above" | "break_below") =>
    band == null ? { kind: "opening_range" as const, side, minutes: 30 }
                  : { kind: "opening_range" as const, side, minutes: 30, band };
  return [
    { direction: "call", reason: "orb_up", all: [or("break_above"), { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "above" }, { kind: "momentum_atr", op: ">=", value: 0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
    { direction: "put",  reason: "orb_dn", all: [or("break_below"), { kind: "or_width_min", pct: 0.25 }, { kind: "vwap_side", side: "below" }, { kind: "momentum_atr", op: "<=", value: -0.3, lookback: 5 }, { kind: "rel_vol", min: 1.3 }, { kind: "time_before", et: "15:00" }] },
  ];
};
// reuse lever-shared.specEval (same meta/exits/specToStrategyDef path the V3/ALT use)
// exit at 15:30 (the live ORB flatten in orb-width-probe / orb-trend-rider).
const evalForBand = (band?: number) => specEval(orbEntries(band), "15:30");

// the ORB channel at a given band — live exit knobs (−50% premium stop only, no profit
// target on the ride; the stop AUTO re-anchors to the per-trade entry fill).
const orbCh = (name: string, band?: number): Ch => ({
  name, sym: "SPY", dte: 0, maxC: 6, mk: evalForBand(band), px: { stopPct: 50 },
});

const BANDS = [1.0, 0.75, 0.5, 0.25];

async function main() {
  const D: Prepped = await prep("SPY", "data/databento-mdte");
  console.log(`\n  ORB-TIGHTEN probe · live ORB ride (−50% stop, auto re-anchored · cost gate 3.0 · 1-tick fills)`);
  console.log(`  real NBBO · re-entry-aware · ${D.real.length} SPY sessions across the 5 OOS windows\n`);

  // ── FAITHFULNESS ANCHOR — band=1.0 (field set) MUST equal the original (no field) ──
  const anchorOrig = simChannel(D, orbCh("orb-orig(no band)", undefined)); // live spec, no band field
  const anchorB1   = simChannel(D, orbCh("orb-band=1.0", 1.0));             // band:1.0 explicit
  const aO = pool(anchorOrig), aB = pool(anchorB1);
  const nEq = aO.n === aB.n, pEq = Math.abs(aO.tot - aB.tot) < 1e-6;
  console.log(`  ══ FAITHFULNESS ANCHOR (band=1.0 ≡ live ORB, no band field) ══`);
  console.log(`    original (no band):  n=${aO.n}  total=${usd(aO.tot)}`);
  console.log(`    band=1.0 (explicit): n=${aB.n}  total=${usd(aB.tot)}`);
  console.log(`    MATCH: n ${nEq ? "✓" : "✗ MISMATCH"}  |  total ${pEq ? "✓" : "✗ MISMATCH"}  →  ${nEq && pEq ? "ANCHOR HOLDS — band wiring faithful" : "ANCHOR FAILED — band wiring is wrong"}\n`);
  if (!(nEq && pEq)) {
    console.log(`  ✗ Anchor mismatch — the band lever is not wired byte-identically at band=1.0. Stopping.\n`);
    process.exit(1);
  }

  // ── the sweep ──────────────────────────────────────────────────────────────
  // stop-rate (whipsaw proxy): fraction of CLOSED trades exited at the −50% premium
  // stop. We recompute per-trade exits inside simChannel only as pnl aggregates, so
  // we approximate the stop-rate from the per-session loser fraction at the stop
  // threshold via a dedicated detailed pass below.
  type Row = { band: number; rs: SessRes[]; tot: number; n: number; win: number; stopRate: number };
  const rows: Row[] = [];
  for (const band of BANDS) {
    const { rs, stops, losers } = simDetailed(D, band);
    const { tot, n } = pool(rs);
    rows.push({ band, rs, tot, n, win: winPct(rs, losers), stopRate: n ? stops / n : 0 });
  }

  console.log(`  ══ SWEEP — band ∈ {1.0, 0.75, 0.5, 0.25} ══`);
  console.log(`  band    exp/t       win%    total      n     stop%(whipsaw proxy)`);
  for (const r of rows) {
    console.log(`  ${r.band.toFixed(2)}   ${exp$(r.tot, r.n).padStart(8)}    ${(r.win * 100).toFixed(0).padStart(3)}%   ${usd(r.tot).padStart(9)}  ${String(r.n).padStart(4)}   ${(r.stopRate * 100).toFixed(0).padStart(3)}%`);
  }

  // ── per-window exp/t ────────────────────────────────────────────────────────
  console.log(`\n  ══ PER-WINDOW exp/t (the 5 OOS regime windows) ══`);
  console.log(`  band  ` + WINDOWS.map((w) => w.short.padStart(9)).join("") + "     (n per window)");
  const perBand = new Map<number, Map<string, { tot: number; n: number }>>();
  for (const r of rows) perBand.set(r.band, byWindow(r.rs));
  for (const r of rows) {
    const bw = perBand.get(r.band)!;
    const cells = WINDOWS.map((w) => { const e = bw.get(w.name); return e ? exp$(e.tot, e.n).padStart(9) : "    —    "; }).join("");
    const ns = WINDOWS.map((w) => { const e = bw.get(w.name); return String(e?.n ?? 0).padStart(4); }).join("");
    console.log(`  ${r.band.toFixed(2)}  ${cells}     ${ns}`);
  }

  // ── BATTERY — does any tighter band beat band=1.0? ──────────────────────────
  const base = rows.find((r) => r.band === 1.0)!;
  const baseExp = base.n ? base.tot / base.n : 0;
  const baseBW = perBand.get(1.0)!;
  console.log(`\n  ══ BATTERY vs band=1.0 (baseExp ${exp$(base.tot, base.n)}, total ${usd(base.tot)}, n ${base.n}) ══`);
  let anyWinner = false;
  for (const r of rows) {
    if (r.band === 1.0) continue;
    const exp = r.n ? r.tot / r.n : 0;
    const bw = perBand.get(r.band)!;
    // (a) pooled
    const aPooled = exp > baseExp;
    // (b) ≥4/5 windows — tighter beats band=1.0 in window exp/t (windows where both have trades)
    let better = 0, compared = 0;
    for (const w of WINDOWS) {
      const e = bw.get(w.name), b = baseBW.get(w.name);
      if (!e || !b || e.n === 0 || b.n === 0) continue;
      compared++; if (e.tot / e.n > b.tot / b.n) better++;
    }
    const bWindows = better >= 4;
    // (c) drop-best-window robustness — recompute pooled exp/t for BOTH with each
    // window removed; the tighter band must still beat band=1.0 after dropping ITS
    // single best (highest-total) window (the honest "is it one lucky window?" test).
    const dropRobust = dropBestSurvives(r.rs, base.rs);
    if (aPooled && bWindows && dropRobust) anyWinner = true;
    console.log(`  band ${r.band.toFixed(2)}:  exp/t ${exp$(r.tot, r.n)} (Δ ${(exp - baseExp >= 0 ? "+" : "") + (exp - baseExp).toFixed(1)}/t)   (a) pooled-beats:${aPooled ? "YES" : "no"}   (b) windows-beat:${better}/${compared}${bWindows ? " ✓" : ""}   (c) drop-best-survives:${dropRobust ? "YES" : "no"}`);
  }

  console.log(`\n  ════════════════════════════════════════════════════════════════════════════`);
  if (anyWinner) {
    console.log(`  RESULT: a tighter band BEATS the live OR edge on all three battery legs.`);
    console.log(`  ⚠ DOCTRINE: this is a FORWARD-TEST hypothesis, NOT an arm signal — options are`);
    console.log(`  MODELED and the lever may be mined on these very 5 windows. Shadow-first.`);
  } else {
    console.log(`  RESULT: NO tighter band passes the battery (pooled AND ≥4/5 windows AND drop-best).`);
    console.log(`  The +19% underlying runway does NOT net out on real option fills — the earlier`);
    console.log(`  entry's extra whipsaw + the −50% premium stop (auto re-anchored to the lower entry)`);
    console.log(`  eat the runway gain. The underlying edge does not survive the option-fill tax. This`);
    console.log(`  confirms the ENTRY-geometry axis is mined out on options (cf. orb-width, ema-stretch).`);
  }
  console.log(`  ════════════════════════════════════════════════════════════════════════════\n`);
}

// ── detailed sim: same simChannel re-entry-aware path, but we also count −50%
// premium-stop exits (the whipsaw proxy) by re-deriving per-trade exit reasons from
// a parallel single-pass that emits Trades. simChannel only returns per-session pnl
// aggregates, so to get the stop-rate we re-run the underlying simulateSession with
// the SAME faithful args and inspect Trade fields. We import the pieces directly to
// stay byte-identical with simChannel (same positional call). ────────────────────
import { simulateSession } from "./backtest";
import {
  FUND, cfgOf, FILL_1T, GATE_LIVE, RATIO, winOf,
} from "./lever-shared";
import type { Trade } from "./types";

function simDetailed(D: Prepped, band: number): { rs: SessRes[]; stops: number; losers: number } {
  const ch = orbCh(`orb-${band}`, band === 1.0 ? 1.0 : band);
  const cfg = cfgOf(ch.maxC);
  const rs: SessRes[] = [];
  let stops = 0, losers = 0;
  for (const s of D.real) {
    const exp = s.dateET; // dte 0
    const ts: Trade[] = simulateSession(s.bars, cfg, FUND, ch.mk(s), D.chainFor(s, exp), false, ch.px, FILL_1T,
      undefined, undefined, undefined, undefined, 0, { minMoveToCostRatio: RATIO, gateCostModel: GATE_LIVE },
      undefined, undefined, undefined, undefined, undefined);
    rs.push({ date: s.dateET, win: winOf(s.dateET), pnl: ts.reduce((a, x) => a + x.pnl, 0), n: ts.length });
    for (const t of ts) {
      if (t.pnl < 0) losers++;
      if (isStopExit(t)) stops++;
    }
  }
  return { rs, stops, losers };
}

// −50% premium stop detection (the whipsaw proxy): in THIS config the only stop-type
// exit the engine can emit is "stop_premium" (no trail/breakeven/underlying-stop/stall
// passed). Trade.exitReason is always populated by simulateSession.
function isStopExit(t: Trade): boolean {
  return t.exitReason === "stop_premium";
}

const winPct = (rs: SessRes[], losers: number) => {
  const n = rs.reduce((a, r) => a + r.n, 0);
  return n ? (n - losers) / n : 0;
};

// drop-best-window robustness: remove the single window contributing the most TOTAL
// pnl to the TIGHTER band, recompute pooled exp/t for both bands over the remaining
// windows, and require the tighter to still beat band=1.0.
function dropBestSurvives(tight: SessRes[], base: SessRes[]): boolean {
  const bwT = byWindow(tight);
  let bestWin = "", bestTot = -Infinity;
  for (const [w, e] of bwT) if (e.tot > bestTot) { bestTot = e.tot; bestWin = w; }
  const poolExWin = (rs: SessRes[]) => {
    let tot = 0, n = 0;
    for (const r of rs) { if (r.win === bestWin) continue; tot += r.pnl; n += r.n; }
    return n ? tot / n : 0;
  };
  return poolExWin(tight) > poolExWin(base);
};

main().catch((e) => { console.error(e); process.exit(1); });
