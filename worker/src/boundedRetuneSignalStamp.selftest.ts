import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boundedRetuneSignalStamp } from "./boundedRetuneSignalStamp.js";

const baseline = boundedRetuneSignalStamp({
  slug: "vb-vwap-revert",
  spec_json: {
    entries: [{ direction: "call", all: [{ kind: "vwap_distance", atr: 2 }] }],
  },
  max_contracts: 6,
  premium_stop_pct: 30,
  take_profit_pct: 15,
});
// A synthetic spec cannot masquerade as the preregistered production source.
assert.equal(baseline?.baselineMatches, false);
assert.deepEqual(baseline?.mismatches, ["sourceContentHash"]);

const registry = boundedRetuneSignalStamp({
  slug: "power",
  spec_json: null,
  max_contracts: 6,
  premium_stop_pct: null,
  take_profit_pct: 75,
});
assert.equal(registry?.baselineMatches, true);
assert.equal(registry?.executionAuthority, false);
assert.equal(registry?.alternativeValue, 20);

const drift = boundedRetuneSignalStamp({
  slug: "power",
  spec_json: null,
  max_contracts: 6,
  premium_stop_pct: null,
  take_profit_pct: 70,
});
assert.equal(drift?.baselineMatches, false);
assert.deepEqual(drift?.mismatches, ["takeProfitPct"]);
assert.equal(boundedRetuneSignalStamp({
  slug: "not-registered",
  spec_json: null,
  max_contracts: 1,
  premium_stop_pct: 30,
  take_profit_pct: 20,
}), null);

const execute = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
assert.equal((execute.match(/bounded_retune_experiment/g) ?? []).length, 1,
  "the experiment stamp belongs only in durable signal rationale");
assert.match(execute, /rationale:\s*\{[\s\S]*bounded_retune_experiment: boundedRetuneSignalStamp\(ch\)/);

console.log("bounded retune signal stamp self-test: PASS");
