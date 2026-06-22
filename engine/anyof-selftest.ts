/**
 * Selftest for the mandatory+counted-optional confluence entry (`anyOf`), vocab #2.
 * Uses only `time_before` conditions — each is deterministically true/false by the
 * bar's ET minute — so we can assert the exact firing set per spec, no market luck.
 *
 *   npm run anyof-selftest
 *
 * Bars: contiguous 1-min from 09:30 ET (= 13:30 UTC, EDT). Test minutes (index =
 * minutes since open): 09:45=15, 10:30=60, 11:30=120, 12:30=180.
 *   A = time_before 10:00  → true at {15}        (idx<30)
 *   B = time_before 11:00  → true at {15,60}     (idx<90)
 *   C = time_before 12:00  → true at {15,60,120} (idx<150)
 *   M = time_before 15:00  → true everywhere here (mandatory always-on)
 */
import { specToStrategyDef } from "./specEvaluate";
import { computeFeatures } from "./engine";
import type { StrategySpec, Condition, SpecEntry } from "../lib/desk/strategySpec";
import type { Bar } from "./types";

function buildSession(n: number): Bar[] {
  const start = Date.parse("2026-06-08T13:30:00Z"); // 09:30 ET (EDT)
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const base = 700 + (i % 2) * 0.5; // oscillate so ATR > 0
    bars.push({ ts: start + i * 60_000, open: base, high: base + 0.3, low: base - 0.3, close: base, volume: 1000 });
  }
  return bars;
}

const tb = (et: string): Condition => ({ kind: "time_before", et });
const A = tb("10:00"), B = tb("11:00"), C = tb("12:00"), M = tb("15:00");

function mkSpec(entry: SpecEntry): StrategySpec {
  return {
    meta: { strategyId: "anyof-test", name: "anyof", instrument: "SPY", structure: "single-leg", dteRange: [0, 0], regime: "test", direction: "call" },
    entries: [entry], exits: [], sizing: {},
  };
}

const bars = buildSession(200);
const feats = bars.map((_, i) => computeFeatures(bars, i));
const TEST_IDX = [15, 60, 120, 180];

interface Case { name: string; entry: SpecEntry; expect: Record<number, boolean> }
const cases: Case[] = [
  { name: "strict AND [A,B,C]",                         entry: { direction: "call", reason: "t", all: [A, B, C] },
    expect: { 15: true, 60: false, 120: false, 180: false } },
  { name: "atLeast 2 of [A,B,C]",                        entry: { direction: "call", reason: "t", all: [A, B, C], atLeast: 2 },
    expect: { 15: true, 60: true, 120: false, 180: false } },
  { name: "anyOf trivial-mandatory: all=[M] +≥2 of[A,B,C]", entry: { direction: "call", reason: "t", all: [M], anyOf: { atLeast: 2, of: [A, B, C] } },
    expect: { 15: true, 60: true, 120: false, 180: false } },           // ≡ atLeast 2
  { name: "anyOf load-bearing: all=[A] +≥1 of[B,C]",    entry: { direction: "call", reason: "t", all: [A], anyOf: { atLeast: 1, of: [B, C] } },
    expect: { 15: true, 60: false, 120: false, 180: false } },          // mandatory A gates everything to idx15
  { name: "pure pool: all=[] +≥2 of[A,B,C]",            entry: { direction: "call", reason: "t", all: [], anyOf: { atLeast: 2, of: [A, B, C] } },
    expect: { 15: true, 60: true, 120: false, 180: false } },           // empty all → pure ≥2 of pool
];

let pass = 0, fail = 0;
for (const c of cases) {
  const ev = specToStrategyDef(mkSpec(c.entry)).build(bars, 1, {});
  const got: Record<number, boolean> = {};
  let ok = true;
  for (const idx of TEST_IDX) {
    const fired = ev(feats[idx], null)?.kind === "enter";
    got[idx] = fired;
    if (fired !== c.expect[idx]) ok = false;
  }
  if (ok) { pass++; console.log(`PASS  ${c.name}`); }
  else { fail++; console.log(`FAIL  ${c.name}\n      expect ${JSON.stringify(c.expect)}\n      got    ${JSON.stringify(got)}`); }
}

console.log(`\n${pass}/${pass + fail} cases passed`);
if (fail) process.exit(1);
