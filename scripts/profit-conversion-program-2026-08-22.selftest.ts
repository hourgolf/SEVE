import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./profit-conversion-program-2026-08-22.ts", import.meta.url), "utf8");
assert.doesNotMatch(script, /createServerSupabaseClient|fetch\(|PutObjectCommand|\.from\(|\.insert\(|\.upsert\(|\.delete\(/,
  "the proposal builder must remain local and read-only");
assert.match(script, /momo-shape/);
assert.match(script, /qqq-thrust-trail/);
assert.match(script, /unchangedExistingChannelAdmissions/);
assert.match(script, /productionWrites: 0/);

const packet = JSON.parse(readFileSync(new URL("../data/weekend-optimization/2026-08-22/profit-conversion-program/packet.json", import.meta.url), "utf8"));
assert.equal(packet.channels.length, 68);
assert.deepEqual(packet.proposedRosterMoves.map((row: any) => [row.channel, row.decision]), [
  ["momo-shape", "GO"],
  ["qqq-thrust-trail", "CONDITIONAL GO"],
]);
assert.equal(packet.capacityReplay.unchangedExistingChannelAdmissions, true);
assert.equal(packet.authority.productionWrites, 0);
assert.equal(packet.authority.orderAuthority, false);
assert.equal(packet.authority.configurationAuthority, false);
assert.equal(packet.holds.sizingChanges.length, 0);
assert.equal(packet.holds.entryChanges.length, 0);
console.log("profit-conversion-program-selftest: PASS");
