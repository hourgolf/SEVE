import { strict as assert } from "node:assert";
import { findDay1ReleaseReceipt, findSealedReleaseReceipt } from "./releaseReceipt";
import type { MarketEvent } from "../types";

const row = (id: string, message: string, meta: unknown = null): MarketEvent => ({ id, message, level: "EXEC", strategist_id: null, meta, created_at: `2026-07-18T15:00:0${id}Z` });
const hash = "5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba";
const receipt = findDay1ReleaseReceipt([row("1", "other"), row("2", `stream: day1-release ACTIVE weekend-day1-2026-07-20-rc5 config=${hash}`, {
  dryRun: false, liveTrading: true, alpacaPaperOrigin: "https://paper-api.alpaca.markets",
})]);
assert.ok(receipt);
assert.equal(receipt.releaseId, "weekend-day1-2026-07-20-rc5");
assert.equal(receipt.configHash, hash);
assert.equal(receipt.dryRun, false);
assert.equal(receipt.liveTrading, true);
assert.equal(receipt.alpacaPaperOrigin, "https://paper-api.alpaca.markets");
assert.equal(receipt.meta?.dryRun, false);
assert.equal(receipt.lane, "day1");
const rc54 = findSealedReleaseReceipt([row("4", `stream: rc54-release ACTIVE week2-2026-07-27-rc5.4 config=${hash}`)]);
assert.ok(rc54);
assert.equal(rc54.lane, "rc54");
assert.equal(rc54.releaseId, "week2-2026-07-27-rc5.4");
const receiptBound = findSealedReleaseReceipt([
  row("5", `stream: rc54-release ACTIVE release:candidate:test config=sha256:${hash}`),
]);
assert.ok(receiptBound);
assert.equal(receiptBound.releaseId, "release:candidate:test");
assert.equal(receiptBound.configHash, hash);
const day1Old = row("1", `stream: day1-release ACTIVE weekend-day1-2026-07-21-rc5.3 config=${hash}`);
const rc54New = row("6", `stream: rc54-release ACTIVE week2-2026-07-27-rc5.4 config=${hash}`);
assert.equal(findSealedReleaseReceipt([day1Old, rc54New])?.lane, "rc54");
assert.equal(findSealedReleaseReceipt([rc54New, day1Old])?.lane, "rc54");
assert.equal(findDay1ReleaseReceipt([row("5", `stream: rc54-release ACTIVE week2-2026-07-27-rc5.4 config=${hash}`)]), null);
assert.equal(findDay1ReleaseReceipt([row("3", "day1-release ACTIVE incomplete config=abc")]), null);
assert.equal(findDay1ReleaseReceipt([]), null);
console.log("release-receipt-selftest: 19/19 passed");
