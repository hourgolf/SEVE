import assert from "node:assert/strict";
import {
  GATE_SHADOW_ALL_BLOCKS,
  GATE_SHADOW_SEQUENTIAL_BLOCKS,
  isGateShadowBlockReason,
} from "./gateShadowPolicy.js";
import { readFileSync } from "node:fs";

const releaseSuppressions = [
  "day1_spy_same_clock_collision",
  "day1_reentry_disabled",
  "day1_same_occ_open",
  "day1_underlying_concurrency",
  "day1_global_concurrency",
] as const;

for (const reason of releaseSuppressions) {
  assert.equal(isGateShadowBlockReason(reason), true, `${reason} must enter after-close reconstruction`);
  assert.equal(GATE_SHADOW_SEQUENTIAL_BLOCKS.has(reason), true, `${reason} must be de-duplicated sequentially`);
}

assert.equal(isGateShadowBlockReason("day1_admission_closed"), false, "post-admission signals are not admitted opportunities");
assert.equal(isGateShadowBlockReason("day1_session_ledger_unavailable"), false, "missing control truth must remain censored");
assert.equal(new Set(GATE_SHADOW_ALL_BLOCKS).size, GATE_SHADOW_ALL_BLOCKS.length, "block policy must not contain duplicates");
const script = readFileSync(new URL("../../scripts/gate-shadow.ts", import.meta.url), "utf8");
assert.match(script, /if \(HAS_SERVICE\) await bank\(s, prior, false\)/, "publication must not skip rows first reconstructed read-only");

console.log(`gate-shadow-policy-selftest: ${releaseSuppressions.length + 4}/${releaseSuppressions.length + 4} passed`);
