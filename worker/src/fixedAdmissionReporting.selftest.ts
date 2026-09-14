import assert from "node:assert/strict";
import { fixedEntryIntentFixture } from "./fixedEntryLedger.fixtures.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import type { FixedRuntimeBindings } from "./fixedEntryRuntimeDriver.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";
async function main() {
  Object.assign(process.env,{ALPACA_KEY:"fixture",ALPACA_SECRET:"fixture",SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture"});
  const {makeFixedEntryRuntimeDriver}=await import("./fixedEntryRuntimeDriver.js");
  const intent=fixedEntryIntentFixture(); let now=Date.parse(intent.createdAt), calls=0;
  const token=["eyJhbGciOiJIUzI1NiJ9",Buffer.from('{"role":"service_role"}').toString("base64url"),"fixture"].join(".");
  const client=createFixedEntryServiceClient("https://fixture.supabase.co",token,async (input,init)=>{
    assert.equal(init?.method??"GET","GET","declines cannot write custody or submit an order");
    assert.equal(new URL(String(input)).pathname,"/rest/v1/rpc/fixed_entry_admission_snapshot_v1");
    calls++;now+=2001;
    return new Response(JSON.stringify({schema:"fixed-admission-snapshot-v1",complete:true,
      counts:{observations:0,positions:0,strategists:0},observations:[],positions:[],strategists:[]}),{headers:{"content-type":"application/json"}});
  });
  const rows:ExecutionObservationDraft[]=[];
  const runtime=makeFixedEntryRuntimeDriver(client,"fixture",{now:()=>now,status:async()=>{},onAdmission:r=>{rows.push(r);},
    submissionEnabled:()=>{throw Error("unexpected submission check");},
    broker:async()=>{throw Error("unexpected broker access");},
    exclusiveContract:async()=>{throw Error("unexpected contract authority");},
    management:async()=>{throw Error("unexpected management");},
    onCommand:async()=>{throw Error("unexpected command");},
    onCoverage:async()=>{throw Error("unexpected coverage");},
    onReporting:async()=>{throw Error("unexpected reporting replay");},
    executionSettings:()=>({spreadCapture:true,ladder:intent.executionPlan.ladder}),
    entryAuthority:async()=>{throw Error("stale history must decline before current authority");}
  } satisfies FixedRuntimeBindings);
  const d={action:"enter",qty:4,slug:intent.slug,occ:intent.occ,direction:"call",reason:intent.reason,status:"armed"};
  const ch={id:intent.strategistId,slug:intent.slug,account_id:intent.accountId,underlying:"SPY"};
  const ctx={accountId:intent.accountId,paperMode:true,configurationWriteStamp:intent.writeStamp,todayET:intent.sessionDateEt,
    decisionAtMs:Date.parse(intent.sourceBarAt),chain:{ageMs:0,quoteObservation:()=>({localAgeMs:0,bid:1,ask:1.01})}};
  await runtime.enter(d as any,ch as any,600,ctx as any);
  assert.equal(calls,1);assert.equal(rows.length,2);
  assert.equal(rows[0].trace_id,rows[1].trace_id);
  const outcome=rows[1].payload.fixed_entry_admission as any;
  assert.equal(outcome.state,"declined");assert.equal(outcome.reason,"global-history-stale");assert.equal(outcome.intentId,null);
  assert.equal(outcome.historyReads.length,1); assert.equal(outcome.historyReads[0].complete,true);
  assert.deepEqual(outcome.historyReads[0].counts,{observations:0,positions:0,strategists:0});
  assert.equal(outcome.completedAtMs-outcome.startedAtMs,2001);assert.equal(outcome.submissionConfirmed,false);
  const prior=calls;await runtime.enter({...d,qty:3} as any,ch as any,600,ctx as any);
  assert.equal(calls,prior);assert.equal((rows.at(-1)!.payload.fixed_entry_admission as any).reason,"fixed-entry-context-invalid");
  console.log("PASS: actual driver links pre-intent stale/context declines, preserves start clock, performs no broker requests or custody writes");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
