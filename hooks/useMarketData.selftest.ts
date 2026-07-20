import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useMarketData.ts", import.meta.url), "utf8");
const marketStart = source.indexOf("async function poll()");
const releaseStart = source.indexOf("async function pollRelease()");
const barsStart = source.indexOf("async function pollBars()");

assert.ok(marketStart >= 0 && releaseStart > marketStart && barsStart > releaseStart);
const marketPoll = source.slice(marketStart, releaseStart);
const releasePoll = source.slice(releaseStart, barsStart);

assert.doesNotMatch(marketPoll, /day1-release ACTIVE/, "market poll must not wait for release lookup");
assert.match(releasePoll, /\.gte\("created_at", cutoff\)/, "release lookup must be time bounded");
assert.match(releasePoll, /RELEASE_LOOKBACK_MS/, "release lookup must use the declared lookback");
assert.match(source, /if \(pollInFlight \|\| !live\(\)\) return;/, "market poll must reject overlap");
assert.match(source, /if \(releaseInFlight \|\| !live\(\)\) return;/, "release poll must reject overlap");
assert.match(source, /startVisibilityPoll\(pollRelease, RELEASE_POLL_MS\)/, "release polling must use its slow cadence");

console.log("market-data-read-selftest: 7/7 passed");
