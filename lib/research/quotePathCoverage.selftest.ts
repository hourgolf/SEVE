import assert from "node:assert/strict";
import {quotePathCoverage} from "./quotePathCoverage";
const row = (s:number,bid=1,ask=2) => ({captured_at:new Date(s*1000).toISOString(),provider_quote_at:new Date(s*1000).toISOString(),option_feed:"opra",bid,ask});
assert.equal(quotePathCoverage([row(1)],0,10_000)?.causalEntry15s,false); // future quote cannot validate entry
assert.equal(quotePathCoverage([row(0),row(60),row(120)],0,120_000)?.sampledCoverage120s,true);
assert.equal(quotePathCoverage([row(0),row(60),row(120)],0,120_000)?.sampledCoverage15s,false);
assert.equal(quotePathCoverage([row(0),row(200)],0,200_000)?.sampledCoverage120s,false);
assert.equal(quotePathCoverage([row(0,0),row(1,3,2)],0,10_000)?.invalidPriceRows,2);
assert.equal(quotePathCoverage([{...row(0),provider_quote_at:null}],0,10_000)?.freshOpraRows,0);
assert.equal(quotePathCoverage([{...row(0),option_feed:"indicative"}],0,10_000)?.freshOpraRows,0);
assert.equal(quotePathCoverage([],0,10_000)?.maxSampleGapSeconds,null);
assert.equal(quotePathCoverage([row(0)],10_000,0),null);
console.log("Quote coverage: causal timing, gap thresholds, invalid prices, missing provenance and empty paths passed");
