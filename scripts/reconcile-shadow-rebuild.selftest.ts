import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../lib/research/legacyShadowRepairGuard.selftest";

const source = readFileSync(new URL("./reconcile-shadow-rebuild.ts", import.meta.url), "utf8");
assert.match(source, /expected-verification-sha256/);
assert.match(source, /payload-mismatch-only repair/);
assert.match(source, /refusing to rewrite.*provenance-stamped/);
assert.match(source, /allowedTables: \["virtual_trades"\]/);
assert.match(source, /eventInserts: 0/);
assert.match(source, /deletes: 0/);
assert.match(source, /inserts: 0/);
assert.match(source, /compareAndSetLegacyRepair/);
assert.match(source, /expected-authorization-sha256/);
assert.match(source, /assertExactLegacySession/);
assert.match(source, /request-outcome-unconfirmed/);
assert.doesNotMatch(source, /\.upsert\(/);
assert.match(source, /configurationAuthority: false/);
assert.doesNotMatch(source, /from\("events"\)|placeOrder|submitOrder|worker\/src/);

console.log("reconcile-shadow-rebuild-selftest: PASS");
