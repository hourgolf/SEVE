import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { fixedCustodyBoundaryFromCompleteHistory } from "./fixedEntryCustodyBoundary.js";
import { requestFixedIntentExit } from "./fixedEntryExitRequest.js";
import { sealFixedEntryBuys,settleFixedEntryIntent } from "./fixedEntryIntentSettlement.js";
async function main(){
  const h=fixedCoverageHarness();
  const history=async()=>({intent:h.intent,...await h.coverage.snapshot(h.intent)});
  assert.equal(fixedCustodyBoundaryFromCompleteHistory([]).allSettled,true);
  assert.equal(fixedCustodyBoundaryFromCompleteHistory([await history()]).allSettled,false,
    "zero position rows and no submitted order cannot extinguish original entry authority");
  await requestFixedIntentExit(h.coverage.storage,h.intent,{source:"manual",reason:"manual",requestedAt:new Date(h.coverage.now()).toISOString()});
  await sealFixedEntryBuys(h.coverage.storage,h.intent,(await history()).records,"exit-required",new Date(h.coverage.now()).toISOString());
  assert.equal(fixedCustodyBoundaryFromCompleteHistory([await history()]).allSettled,false,"buy seal alone is not global settlement");
  await settleFixedEntryIntent(h.coverage.storage,h.intent,await h.coverage.snapshot(h.intent),h.coverage.now());
  const settled=await history();const proof=fixedCustodyBoundaryFromCompleteHistory([settled]);assert.equal(proof.allSettled,true);
  assert.ok(proof.originals[0].settlementHash);assert.throws(()=>fixedCustodyBoundaryFromCompleteHistory([settled,settled]),/duplicate_original/);
  console.log("fixedEntryCustodyBoundary: PASS · zero-row authority and sealed-but-unsettled histories block rollback; only verified global settlement is clear");
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
