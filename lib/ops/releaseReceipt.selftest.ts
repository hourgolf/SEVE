import { strict as assert } from "node:assert";
import { findDay1ReleaseReceipt } from "./releaseReceipt";
import type { MarketEvent } from "../types";

const row = (id: string, message: string): MarketEvent => ({ id, message, level: "EXEC", strategist_id: null, meta: null, created_at: `2026-07-18T15:00:0${id}Z` });
const hash = "5a4112fd5991b470aa185d8c9271a57e82b975f9999d89096b29e76b9ad64eba";
const receipt = findDay1ReleaseReceipt([row("1", "other"), row("2", `stream: day1-release ACTIVE weekend-day1-2026-07-20-rc5 config=${hash}`)]);
assert.ok(receipt);
assert.equal(receipt.releaseId, "weekend-day1-2026-07-20-rc5");
assert.equal(receipt.configHash, hash);
assert.equal(findDay1ReleaseReceipt([row("3", "day1-release ACTIVE incomplete config=abc")]), null);
assert.equal(findDay1ReleaseReceipt([]), null);
console.log("release-receipt-selftest: 5/5 passed");
