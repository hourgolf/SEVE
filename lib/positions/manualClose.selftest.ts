import assert from "node:assert/strict";
import { MANUAL_CLOSE_REASONS, normalizeManualCloseTag } from "./manualClose";

assert.deepEqual(MANUAL_CLOSE_REASONS.map((reason) => reason.value), ["target", "reversal", "risk", "stall", "test", "correction"]);
assert.equal(normalizeManualCloseTag("TARGET"), "target");
assert.equal(normalizeManualCloseTag(" risk "), "risk");
assert.equal(normalizeManualCloseTag("TEST"), "test");
assert.equal(normalizeManualCloseTag(" correction "), "correction");
assert.equal(normalizeManualCloseTag("manual"), null);
assert.equal(normalizeManualCloseTag("stop_premium"), null);
assert.equal(normalizeManualCloseTag(null), null);

console.log("manual-close-selftest: 8/8 checks passed ✓");
