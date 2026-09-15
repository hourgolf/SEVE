import assert from "node:assert/strict";
import { ChainStore } from "./state.js";
import { freshExecutableBid } from "./quoteValidation.js";
import type { ChainQuote } from "./alpaca.js";
const realNow = Date.now;
let now = Date.parse("2026-09-14T14:00:00Z");
Date.now = () => now;
const occ = "SPY260914C00760000";
const q: ChainQuote = {occ,strike:760,optType:"call",expiration:"2026-09-14",bid:2,ask:2.05,mid:2.025,delta:null,last:null};
try {
 const chain = new ChainStore(); chain.seed([q]);
 assert.equal(chain.executableBid(occ),2);
 assert.equal(chain.executableQuote(occ)?.clockBasis,"local-receipt");
 now += 120001; chain.update([{...q,occ:"SPY260914C00761000",strike:761}]);
 assert.equal(chain.ageMs,0); assert.equal(chain.executableBid(occ),null);
 for (const bad of [{bid:2,ask:1.9},{bid:Infinity},{bid:NaN},{bid:0},{ask:Infinity},
   {providerQuoteAt:"bad"},{providerQuoteAt:new Date(now+1).toISOString()},
   {providerQuoteAt:new Date(now-120001).toISOString()}]) {
   chain.seed([{...q,...bad}]); assert.equal(chain.executableBid(occ),null,JSON.stringify(bad));
 }
 chain.seed([{...q,providerQuoteAt:new Date(now-1000).toISOString()}]);
 assert.equal(chain.executableQuote(occ)?.ageMs,1000);
 now+=120000; chain.update([{...q,providerQuoteAt:new Date(now-121000).toISOString()}]);
 assert.equal(chain.executableBid(occ),null,"GET cannot freshen provider time");
 chain.seed([q]); assert.equal(chain.executableBid(occ,now-1),null);
 assert.equal(chain.executableBid("SPY260914P00760000"),null);
 assert.equal(freshExecutableBid(Infinity,0),null); assert.equal(freshExecutableBid(1,-1),null);
 assert.equal(freshExecutableBid(1,0,Infinity),null);
 // Same valid bid is exposed to cycle, sweep, and order-pricing consumers.
 chain.seed([{...q,ask:q.bid}]); assert.equal(chain.executableBid(occ),2);
 console.log("executable-quote: valid paths and adversarial contract clocks passed");
} finally {Date.now=realNow;}
