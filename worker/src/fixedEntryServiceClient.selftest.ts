import assert from "node:assert/strict";
import { boundedFixedStoreFetch,createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
async function main(){
  const deadlines:AbortController[]=[];
  const hung:typeof fetch=async(_input,init)=>new Promise<Response>((_resolve,reject)=>{
    assert.ok(init?.signal);const signal=init.signal;
    const abort=()=>reject(signal.reason);
    if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
  });
  const bounded=boundedFixedStoreFetch(hung,()=>{const controller=new AbortController();deadlines.push(controller);return controller.signal;});
  const wait=bounded("https://fixture.supabase.co/rest/v1/positions");
  deadlines[0].abort(new Error("deadline"));await assert.rejects(wait,/deadline/);
  const caller=new AbortController();const callerWait=bounded("https://fixture.supabase.co/rest/v1/positions",{signal:caller.signal});
  caller.abort(new Error("caller"));await assert.rejects(callerWait,/caller/);
  const requestCaller=new AbortController();const requestWait=bounded(new Request("https://fixture.supabase.co/rest/v1/positions",{signal:requestCaller.signal}));
  requestCaller.abort(new Error("request"));await assert.rejects(requestWait,/request/);
  let sdkSignal=false;
  const token=["eyJhbGciOiJIUzI1NiJ9",Buffer.from('{"role":"service_role"}').toString("base64url"),"fixture"].join(".");
  const client=createFixedEntryServiceClient("https://fixture.supabase.co",token,async(_input,init)=>{
    sdkSignal=init?.signal instanceof AbortSignal;
    return new Response("[]",{headers:{"content-type":"application/json"}});
  });
  const read=await client.from("positions").select("id");assert.equal(read.error,null);assert.equal(sdkSignal,true);
  Object.assign(process.env,{ALPACA_KEY:"fixture",ALPACA_SECRET:"fixture",SUPABASE_URL:"https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:token,DRY_RUN:"true",LIVE_TRADING:"false"});
  const {loadConfig,loadReceiptBoundControlPlane,realizedTodayByChannel}=await import("./store.js");
  const {makeFixedEntryLiveAuthority}=await import("./fixedEntryLiveAuthority.js");
  const {fixedEntryIntentFixture}=await import("./fixedEntryLedger.fixtures.js");
  const tables:string[]=[];
  const routed=createFixedEntryServiceClient("https://fixture.supabase.co",token,async(input,init)=>{
    assert.ok(init?.signal instanceof AbortSignal,"all original authority store reads use the bounded client");
    const table=new URL(String(input)).pathname.split("/").at(-1)!;tables.push(table);
    const data=table==="fund_state"?{id:1,mode:"paper",is_halted:false,total_capital_usd:100_000}:[];
    return new Response(JSON.stringify(data),{headers:{"content-type":"application/json","content-range":"0-0/0"}});
  });
  const globalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error("unbounded store fallback forbidden");};
  try{
    assert.equal((await loadConfig(routed)).accountsFresh,true);
    assert.equal((await loadReceiptBoundControlPlane(routed)).state,"not-adopted");
    assert.equal(await realizedTodayByChannel("fixture","2026-09-08",routed),0);
    const authority=makeFixedEntryLiveAuthority(routed,{now:Date.now,liveMode:()=>true,infrastructureReady:()=>true,
      workerCompatibilityVersion:"fixture",apiForAccount:()=>null,bars:()=>[],chain:()=>null});
    assert.equal((await authority.exclusiveContract(fixedEntryIntentFixture())).allowed,true);
    assert.ok(["fund_state","strategists","accounts","release_manifests","positions"].every(table=>tables.includes(table)));
  }finally{globalThis.fetch=globalFetch;}
  console.log("fixedEntryServiceClient: PASS · real SDK receives deadline, underlying request aborted, caller and Request cancellation retained without detached races");
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
