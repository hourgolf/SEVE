import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/migrations/20260903233000_channel_collection_state_new_channel_bootstrap.sql", import.meta.url),
  "utf8",
);

assert.match(sql, /after insert on public\.strategists/i);
assert.match(sql, /channel_collection_state_receipts/i);
assert.match(sql, /'active'/i);
assert.match(sql, /execution and order authority remain false/i);
assert.match(sql, /fomc-event-follow/);
assert.match(sql, /pm-momentum-follow/);
assert.match(sql, /not exists/i);
assert.doesNotMatch(sql, /update\s+public\.strategists/i);
assert.doesNotMatch(sql, /delete\s+from/i);

console.log("channel collection bootstrap selftest: PASS");
