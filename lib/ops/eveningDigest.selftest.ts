import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildEveningDigest, EVENING_DIGEST_READ_FAILURE } from "./eveningDigest";

const digest = buildEveningDigest({
  session: "2026-08-06", totalPnl: -165, trades: 9,
  buckets: [
    { label: "PAPER 1", pnl: -106, trades: 2 },
    { label: "PAPER 2", pnl: 39, trades: 3 },
    { label: "PAPER 3", pnl: -98, trades: 4 },
  ],
  movers: [{ slug: "orb-qqq-trail", pnl: -140 }, { slug: "vb-macd-state", pnl: 105 }],
  workerNote: "stream-runtime-2026-08-03a cycle", workerAgeMinutes: 218, archiveReceipt: "75,346 quotes",
});
assert.equal(digest.title, "SEVE close · −$165 · 9t");
assert.match(digest.body, /9 closed trades · desk −\$165/);
assert.match(digest.body, /Data archive verified/);
assert.doesNotMatch(digest.body, /era-4|A6|NO HEARTBEAT|no closed trades/i);
const missingWorker = buildEveningDigest({ session: "2026-08-06", totalPnl: 0, trades: 0, buckets: [], movers: [], workerNote: null, workerAgeMinutes: null, archiveReceipt: null });
assert.match(missingWorker.body, /not proof the worker is offline/);
assert.match(EVENING_DIGEST_READ_FAILURE.body, /No zero-trade conclusion was made/);
const script = readFileSync(new URL("../../scripts/evening-digest.ts", import.meta.url), "utf8");
assert.match(script, /logicalTrades/);
assert.match(script, /immutable execution-account attribution/);
assert.doesNotMatch(script, /from\("positions"\)|strategists\(slug,account_id/);
console.log("evening digest selftest passed");
