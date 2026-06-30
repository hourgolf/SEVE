// ============================================================================
//  ratchet-probe — the EXIT side of the fan-out. The entry axis came up mined-out
//  (0/10 candidates survived pattern-verify); the fan-out's real signal is the
//  premium-peak RATCHET (every archetype's MFE→giveback board: mid-MFE [20,50)
//  round-trips into losers; ≥50 barely gives back). The desk has a −50% premium
//  stop + an UNDERLYING chandelier but no PREMIUM-peak-giveback exit.
//
//  Tests ride-to-close vs the ARM-HIGH ratchet (trailExit.premiumGivebackPct +
//  armPct: arm only after the mark clears +armPct%, then give back X% of the peak
//  GAIN) — re-entry-aware, per OOS window — on the ROUND-TRIP channels (where it
//  should help) AND the CONVEX-TAIL channels V3/ALT/breakout (where it must NOT
//  cap the tail). ⚠ Backtest premium marks at 0DTE are noisy → this is a
//  DIRECTIONAL read, NOT a verdict; the live peak_mark shadow is the validator
//  (desk doctrine: forward-test exits). Prior: breakeven-stop = don't-wire,
//  premium-giveback = noisy — this re-tests the arm-HIGH refinement + new MFE evidence.
//
//    npm run ratchet-probe
// ============================================================================

import { CH, WINDOWS, prep, simChannel, pool, byWindow, exp$, usd, specEval, type Ch, type Exits } from "./lever-shared";

const padR = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);
const f1 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);

// MOMO Continuation — the desk's #1 keep-the-peak RIDE channel (giveback probe: peak +51%, exit +12.9%
// = surrenders ~75% of its peak). Not in the shared CH; build it locally from its live spec (ride exit,
// NO profit cap) so the ratchet can be tested on the prime harvest target.
const MOMO_LEGS: any = [
  { direction: "call", reason: "u", all: [{ kind: "range_break", dir: "up", bars: 8 }, { kind: "strong_trend", dir: "up" }, { kind: "vwap_side", side: "above" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
  { direction: "put", reason: "d", all: [{ kind: "range_break", dir: "down", bars: 8 }, { kind: "strong_trend", dir: "down" }, { kind: "vwap_side", side: "below" }, { kind: "gap_min", pct: 0.25 }, { kind: "time_before", et: "14:00" }] },
];
const momoCh: Ch = { name: "MOMO Cont", sym: "SPY", dte: 0, maxC: 6, mk: specEval(MOMO_LEGS, "15:25"), px: { stopPct: 50 } };

// the channels worth the exit test: ride-harvest (giveback surrendered) + convex-tail (must not cap) + round-trip
const TARGETS = ["MOMO Cont", "BREAK(ALT V3)", "BREAK(ALT)", "ORB(breakout)", "POWERHOUR", "POWER Final30", "PB RIDER 1DTE", "GRIND v3"];
const KIND: Record<string, string> = { "MOMO Cont": "ride-harvest", "BREAK(ALT V3)": "convex-tail", "BREAK(ALT)": "convex-tail", "ORB(breakout)": "round-trip", "POWERHOUR": "round-trip", "POWER Final30": "round-trip", "PB RIDER 1DTE": "round-trip", "GRIND v3": "scalper" };

// ride (baseline = channel's native px exits) vs arm-high ratchet configs (arm HIGH = let the tail develop, then trail)
const CONFIGS: Array<{ key: string; exits?: Exits }> = [
  { key: "ride" },
  { key: "gb50/arm20", exits: { trailExit: { premiumGivebackPct: 50, armPct: 20 } } },
  { key: "gb50/arm30", exits: { trailExit: { premiumGivebackPct: 50, armPct: 30 } } },
  { key: "gb40/arm50", exits: { trailExit: { premiumGivebackPct: 40, armPct: 50 } } },
  { key: "gb30/arm50", exits: { trailExit: { premiumGivebackPct: 30, armPct: 50 } } },
  { key: "gb60/arm30", exits: { trailExit: { premiumGivebackPct: 60, armPct: 30 } } },
];

async function main() {
  const SPY = await prep("SPY", "data/databento-mdte");
  console.log(`\n  RATCHET-PROBE · ${SPY.real.length} SPY sessions (real NBBO) · ride-to-close vs ARM-HIGH premium-peak ratchet · re-entry-aware`);
  console.log(`  gbX/armY = arm the giveback trail once the mark clears +Y%, then exit on a giveback of X% of the peak GAIN.`);
  console.log(`  GOAL: lift the ROUND-TRIP channels' expectancy WITHOUT capping the CONVEX-TAIL channels (V3/ALT/breakout).`);
  console.log(`  ⚠ 0DTE premium marks are MODELED+noisy → directional read; live peak_mark shadow is the real validator.\n`);
  const winHdr = WINDOWS.map((w) => padL(w.short, 8)).join("");

  for (const name of TARGETS) {
    const ch = name === "MOMO Cont" ? momoCh : (CH.find((c) => c.name === name) as Ch);
    const rows = CONFIGS.map((C) => { const rs = simChannel(SPY, ch, undefined, C.exits); return { key: C.key, ...pool(rs), bw: byWindow(rs) }; });
    const base = rows[0];
    console.log(`  ━━ ${name} (${KIND[name]}) ━━  ride ${usd(base.tot)} (${base.n}t, ${exp$(base.tot, base.n)}/t)`);
    for (const r of rows.slice(1)) {
      let helped = 0;
      for (const w of WINDOWS) { const b = base.bw.get(w.name), l = r.bw.get(w.name); const be = b && b.n ? b.tot / b.n : 0, le = l && l.n ? l.tot / l.n : 0; if (le > be) helped++; }
      const dExp = (r.n ? r.tot / r.n : 0) - (base.n ? base.tot / base.n : 0);
      const flag = dExp > 0 && helped >= 4 ? "  ⭐ lifts+OOS" : dExp > 0 ? "  (lifts, not OOS)" : KIND[name] === "convex-tail" && dExp < -2 ? "  ⚠ CAPS TAIL" : "";
      console.log(`     ${padR(r.key, 11)} ${padL(usd(r.tot), 9)}  Δ${padL(usd(r.tot - base.tot), 8)}  ${exp$(r.tot, r.n)}/t  Δexp ${f1(dExp)}  helps ${helped}/5${flag}`);
    }
    // per-window expectancy grid (ride vs the best-looking ratchet for the eye)
    console.log(`        per-window $/t  ${winHdr}`);
    for (const r of [rows[0], rows[2]]) { // ride + gb50/arm30
      const cells = WINDOWS.map((w) => { const e = r.bw.get(w.name); return padL(e && e.n ? exp$(e.tot, e.n) : "—", 8); }).join("");
      console.log(`        ${padR(r.key, 14)}${cells}`);
    }
    console.log("");
  }
  console.log(`  READ: ⭐ = the ratchet lifts pooled expectancy AND helps ≥4/5 OOS windows. ⚠CAPS TAIL = it hurt a convex-tail channel (the thing to avoid).`);
  console.log(`  If the round-trip channels light up ⭐ and V3/ALT/breakout do NOT cap → the premium-peak ratchet is worth a LIVE peak_mark shadow (not an arm).\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
