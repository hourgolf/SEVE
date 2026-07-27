import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useMarketData.ts", import.meta.url), "utf8");
const strategySource = readFileSync(new URL("../lib/desk/strategySpec.ts", import.meta.url), "utf8");
const spotSource = readFileSync(new URL("../app/api/spot/route.ts", import.meta.url), "utf8");
const marksSource = readFileSync(new URL("./usePositionMarks.ts", import.meta.url), "utf8");
const marketStart = source.indexOf("async function poll()");
const releaseStart = source.indexOf("async function pollRelease()");
const barsStart = source.indexOf("async function pollBars()");
const historyStart = source.indexOf("async function loadHistory()");
const dailyStart = source.indexOf("async function loadDaily()");

assert.ok(marketStart >= 0 && releaseStart > marketStart && barsStart > releaseStart && historyStart > barsStart && dailyStart > historyStart);
const marketPoll = source.slice(marketStart, releaseStart);
const releasePoll = source.slice(releaseStart, barsStart);
const historyLoad = source.slice(historyStart, dailyStart);

assert.doesNotMatch(marketPoll, /day1-release ACTIVE/, "market poll must not wait for release lookup");
assert.match(releasePoll, /\.gte\("created_at", cutoff\)/, "release lookup must be time bounded");
assert.match(releasePoll, /RELEASE_LOOKBACK_MS/, "release lookup must use the declared lookback");
assert.match(releasePoll, /day1-release ACTIVE/, "release lookup must retain RC5.3 compatibility");
assert.match(releasePoll, /rc54-release ACTIVE/, "release lookup must follow the RC5.4 runtime handoff");
assert.match(releasePoll, /\.order\("created_at", \{ ascending: false \}\)/, "release lookup must prefer the newest startup receipt");
assert.match(source, /if \(pollInFlight \|\| !live\(\)\) return;/, "market poll must reject overlap");
assert.match(source, /if \(releaseInFlight \|\| !live\(\)\) return;/, "release poll must reject overlap");
assert.match(source, /startVisibilityPoll\(pollRelease, RELEASE_POLL_MS\)/, "release polling must use its slow cadence");
assert.match(source, /const HISTORY_LIMIT = 2340;/, "intraday startup history should cover 1W without loading 15 sessions");
assert.match(source, /select\(OPTION_QUOTE_FIELDS\)/, "live chain should transfer only displayed/modeling fields");
assert.match(source, /const BARS_POLL_MS = 60000;/, "closed-bar safety polling should match the minute write cadence");
assert.match(source, /const RECENT_BARS = 60;/, "recurring chart reads should transfer only the merge tail");
assert.match(source, /POLL_INTERVAL_MS = 300000/, "heavy chain fallback should not duplicate the normal minute realtime refresh");
assert.match(source, /MARKET_POLL_DEDUPE_MS = 30_000/, "near-simultaneous realtime and safety triggers must coalesce");
assert.match(source, /filter: `symbol=eq\.\$\{symbol\}`/, "realtime bar trigger must be scoped to the selected symbol");
assert.doesNotMatch(marketPoll, /from\("underlying_bars"\)/, "chain/event poll must not duplicate the dedicated bar poll");
assert.match(source.slice(barsStart), /bars: markReadSuccess/, "dedicated bar poll must own its success health");
assert.match(source.slice(barsStart), /bars: markReadFailure/, "dedicated bar poll must own its failure health");
assert.match(historyLoad, /if \(live\(\)\) pollBars\(\);/, "deep history must merge through the dedicated bars poll");
assert.doesNotMatch(historyLoad, /if \(live\(\)\) poll\(\);/, "deep history must not call the chain/event poll");
assert.match(strategySource, /SUPPORTED_UNDERLYINGS = \["SPY", "QQQ", "IWM"\]/, "desktop and mobile must expose the full ingested ticker set");
assert.match(spotSource, /new Set\(SUPPORTED_UNDERLYINGS\)/, "fast spot allowlist must share the UI capability contract");
assert.match(marksSource, /SUPPORTED_UNDERLYINGS\.map\(\(sym\) => fetchSpot/, "open-position marks must refresh every supported underlying");

console.log("market-data-read-selftest: 25/25 passed");
