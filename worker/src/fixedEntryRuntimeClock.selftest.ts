import assert from "node:assert/strict";
import { makeFixedEntryRuntimeClock } from "./fixedEntryRuntimeClock.js";
import { makeFixedManagementQuoteCache } from "./fixedEntryManagementQuoteCache.js";
import type { TargetedOptionQuote } from "./managerShadowQuoteModel.js";
async function main(){
  let now=0,active=true,complete=true,fail=false,calls=0,failures=0,release:(()=>void)|null=null;
  const sources:string[]=[];
  const loop=makeFixedEntryRuntimeClock({now:()=>now,failure:()=>{failures++;},recoverAll:async source=>{
    calls++;sources.push(source);loop.kick("sweep");if(fail) throw new Error("fixture");
    if(release) await new Promise<void>(r=>{release=r;});
    return {complete,unresolved:active?["original-zero-row-intent"]:[]};}});
  await loop.poll();assert.equal(calls,0);
  loop.kick("cycle");await loop.poll();assert.deepEqual(sources,["cycle"]);
  now=499;await loop.poll();assert.equal(calls,1);
  now=500;await loop.poll();assert.deepEqual(sources,["cycle","sweep"]);
  release=()=>{};now=1_000;const pending=loop.poll();await Promise.resolve();
  loop.kick("cycle");await loop.poll();assert.equal(calls,3,"no overlap even if a cycle kicks mid-request");
  (release as ()=>void)();release=null;await pending;
  now=1_499;await loop.poll();assert.equal(calls,3);now=1_500;await loop.poll();assert.equal(sources.at(-1),"cycle");
  now=31_000;await loop.poll();const pastBurst=calls;
  now=31_500;await loop.poll();assert.equal(calls,pastBurst,"prompt followups end after bounded burst");
  now=36_000;await loop.poll();assert.equal(calls,pastBurst+1);
  active=false;now=41_000;await loop.poll();now=41_500;await loop.poll();assert.equal(calls,pastBurst+2);
  complete=false;now=46_000;await loop.poll();now=46_500;await loop.poll();assert.equal(calls,pastBurst+3);
  fail=true;now=51_000;await loop.poll();assert.equal(failures,1);
  const stoppedCalls=calls;loop.stop();now+=10_000;loop.kick("cycle");await loop.poll();assert.equal(calls,stoppedCalls);
  // Original-contract quotes work without current bars, roster or open rows.
  const occ="SPY260908C00650000";let reads=0,quoteFail=false;
  const quote:TargetedOptionQuote={occSymbol:occ,bid:2,ask:2.1,quoteAtMs:50_500,feed:"opra",bidSize:1,askSize:1};
  const cache=makeFixedManagementQuoteCache({now:()=>now,read:async symbols=>{
    reads++;assert.deepEqual(symbols,[occ]);if(quoteFail)throw new Error("fixture");return new Map([[occ,quote]]);}});
  assert.equal(cache(occ,now),null,"first read is nonblocking, not a made-up quote");
  await new Promise<void>(r=>setImmediate(r));assert.equal(reads,1);
  assert.deepEqual(cache(occ,now),{bid:2,ask:2.1,observedAtMs:50_500});
  now+=1_000;cache(occ,now);await new Promise<void>(r=>setImmediate(r));
  assert.equal(cache(occ,now)?.observedAtMs,50_500,"GET completion cannot freshen provider clock");
  quoteFail=true;now+=1_000;cache(occ,now);await new Promise<void>(r=>setImmediate(r));assert.equal(cache(occ,now),null);
  console.log("fixedEntryRuntimeClock: PASS · independent original-intent recovery, single flight, bounded prompt continuation, idle/outage discovery and exact OCC nonblocking provider-clock quotes");
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
