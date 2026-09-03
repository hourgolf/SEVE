import assert from "node:assert/strict";
import { capabilityCheck, type StrategySpec } from "../lib/desk/strategySpec";
import { specToStrategyDef } from "./specEvaluate";
import type { Bar, Features } from "./types";

function barsFor(date: string): Bar[] {
  const start = Date.parse(`${date}T18:00:00Z`); // 14:00 ET while DST is active.
  return Array.from({ length: 20 }, (_, minute) => ({
    ts: start + minute * 60_000,
    open: 100,
    high: 100.1,
    low: 99.9,
    close: 100,
    volume: 1_000,
    vwap: 100,
  }));
}

function spec(present: boolean): StrategySpec {
  return {
    meta: {
      strategyId: present ? "fomc-event-follow" : "pm-momentum-follow",
      name: "event-day evaluator selftest",
      instrument: "SPY",
      structure: "single-leg",
      dteRange: [0, 0],
      regime: "test",
      direction: "call",
    },
    entries: [{
      direction: "call",
      all: [{ kind: "event_day", event: "fomc", present }],
      reason: "event_day_selftest",
    }],
    exits: [{ timeET: "15:25" }],
    sizing: {},
  };
}

function evaluate(date: string, present: boolean) {
  const bars = barsFor(date);
  const built = specToStrategyDef(spec(present));
  const evaluateBar = built.build(bars, 1);
  const features: Features = {
    minute: 15,
    minutesToClose: 90,
    close: 100,
    vwap: 100,
    openRangeHi: null,
    openRangeLo: null,
    atr: 0.1,
    mom: 0,
    er: 0,
    relVol: 1,
  };
  return evaluateBar(features, null);
}

assert.equal(capabilityCheck(spec(true)).runnable, true);
assert.equal(evaluate("2026-09-16", true)?.kind, "enter", "FOMC-required fork must fire on an FOMC date");
assert.equal(evaluate("2026-09-15", true), null, "FOMC-required fork must reject a calm date");
assert.equal(evaluate("2026-09-16", false), null, "generic PM fork must reject an FOMC date");
assert.equal(evaluate("2026-09-15", false)?.kind, "enter", "generic PM fork must fire on a calm date");

console.log("spec event-day selftest: PASS");
