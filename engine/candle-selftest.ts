/**
 * Selftest for the candle-shape vocab (#3), two parts:
 *  1. PARITY — engine/candle-shapes.ts must match the validated Nakamoto port
 *     (momentum-patterns.ts isPinBar/isEngulfing/isStrongTrendBar +
 *     detectors.ts barsSinceSessionExtreme) bit-for-bit over many random bars.
 *  2. WIRING — a spec gating on `pin_bar` fires through the real specEvaluate path
 *     exactly at a constructed pin bar (proves ctx.bars reaches condHolds).
 *
 *   npm run candle-selftest
 */
import { pinBar, engulfing, strongTrendBar, sessionSince } from "./candle-shapes";
import { isPinBar, isEngulfing, isStrongTrendBar } from "./nakamoto/momentum-patterns";
import { barsSinceSessionExtreme } from "./nakamoto/detectors";
import { specToStrategyDef } from "./specEvaluate";
import { computeFeatures } from "./engine";
import type { StrategySpec } from "../lib/desk/strategySpec";
import type { Bar } from "./types";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}`); } };

// ---- 1. PARITY vs the nakamoto port (deterministic LCG-generated bars) -------
let seed = 0x2b1c5;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const randBars: Bar[] = [];
for (let i = 0; i < 400; i++) {
  const o = 700 + (rnd() - 0.5) * 4;
  const c = o + (rnd() - 0.5) * 3;
  const hi = Math.max(o, c) + rnd() * 1.5;
  const lo = Math.min(o, c) - rnd() * 1.5;
  randBars.push({ ts: 1e12 + i * 60_000, open: o, high: hi, low: lo, close: c, volume: 1000 });
}
for (let i = 0; i < randBars.length; i++) {
  const b = randBars[i];
  for (const dir of ["up", "down"] as const) {
    check(`pin parity[${i}/${dir}]`, pinBar(b, dir) === isPinBar(b, dir));
    check(`strong parity[${i}/${dir}]`, strongTrendBar(b, dir) === isStrongTrendBar(b, dir));
    if (i > 0) check(`engulf parity[${i}/${dir}]`, engulfing(randBars[i - 1], b, dir) === isEngulfing(randBars[i - 1], b, dir));
  }
}
// sessionSince vs barsSinceSessionExtreme (recomputed per prefix)
const ss = sessionSince(randBars);
for (let i = 0; i < randBars.length; i++) {
  const ext = barsSinceSessionExtreme(randBars.slice(0, i + 1));
  check(`sinceHod parity[${i}]`, ss.sinceHod[i] === ext.since_hod);
  check(`sinceLod parity[${i}]`, ss.sinceLod[i] === ext.since_lod);
}

// ---- 2. WIRING — a pin_bar spec fires through specEvaluate at the pin bar -----
const session: Bar[] = [];
const start = Date.parse("2026-06-08T13:30:00Z"); // 09:30 ET
for (let i = 0; i < 40; i++) {
  // normal bar: mid close (NOT a pin: closePos≈0.5), oscillating base so ATR>0.
  const base = 700 + (i % 2) * 0.3;
  session.push({ ts: start + i * 60_000, open: base, high: base + 0.2, low: base - 0.2, close: base, volume: 1000 });
}
// index 20 = clean BULLISH pin (long lower wick, close near high)
session[20] = { ts: start + 20 * 60_000, open: 700, high: 700.2, low: 699.0, close: 700.1, volume: 1000 };

const spec: StrategySpec = {
  meta: { strategyId: "pin-test", name: "pin", instrument: "SPY", structure: "single-leg", dteRange: [0, 0], regime: "test", direction: "call" },
  entries: [{ direction: "call", reason: "pin", all: [{ kind: "pin_bar", dir: "up" }] }],
  exits: [], sizing: {},
};
const ev = specToStrategyDef(spec).build(session, 1, {});
const feats = session.map((_, i) => computeFeatures(session, i));
check("pin fires at the pin bar (idx20)", ev(feats[20], null)?.kind === "enter");
check("pin silent at a normal bar (idx19)", ev(feats[19], null)?.kind !== "enter");
check("pin silent at a normal bar (idx25)", ev(feats[25], null)?.kind !== "enter");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
