import assert from "node:assert/strict";
import { buildFixedEntryExecutionPlan, parseFixedEntryExecutionPlan, fixedExecutionRungs } from "./fixedEntryExecutionPlan.js";
const input = { spreadCapture: true, ladder: { frac: 0.35, rungs: 3, rungSec: 1 },
  quote: { bid: 1, ask: 2, observedAt: "2026-09-08T14:30:00.000Z" } };
const plan = buildFixedEntryExecutionPlan(input);
assert.deepEqual(plan.buyRungs, [{ type: "limit", limitPrice: "1.68", cancelAfterMs: 1000 },
  { type: "limit", limitPrice: "1.98", cancelAfterMs: 1000 }, { type: "market", limitPrice: null, cancelAfterMs: null }]);
assert.deepEqual(fixedExecutionRungs("sell", true, input.ladder, input.quote), [
  { type: "limit", limitPrice: "1.33", cancelAfterMs: 1000 },
  // Preserve the existing ladder's floating-point tick rounding at this tie.
  { type: "limit", limitPrice: "1.02", cancelAfterMs: 1000 }, { type: "market", limitPrice: null, cancelAfterMs: null }]);
assert.deepEqual(parseFixedEntryExecutionPlan(JSON.parse(JSON.stringify(plan))), plan);
input.ladder.rungs = 9; input.quote.ask = 9;
assert.equal(plan.buyRungs.length, 3); assert.equal(plan.quote.ask, 2, "original plan does not follow mutable runtime settings");
assert.equal(buildFixedEntryExecutionPlan({ ...input, spreadCapture: false }).buyRungs.length, 1);
assert.equal(buildFixedEntryExecutionPlan({ ...input, quote: { ...input.quote, ask: 1 } }).buyRungs.length, 1);
for (const change of [
  (p: typeof plan) => { p.buyRungs.push(p.buyRungs[0]); },
  (p: typeof plan) => { p.buyRungs[0].limitPrice = "9.99"; },
  (p: typeof plan) => { p.buyRungs[0].cancelAfterMs = 0; },
  (p: typeof plan) => { p.ladder.rungs = Infinity; },
]) { const p = structuredClone(plan); change(p); assert.equal(parseFixedEntryExecutionPlan(p), null); }
console.log("fixedEntryExecutionPlan: PASS · original finite rungs, buy/sell price parity, market fallback and restart immutability");
