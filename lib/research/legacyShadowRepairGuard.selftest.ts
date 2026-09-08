import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { assertExactLegacySession, buildLegacyRepairPlan, compareAndSetLegacyRepair,
  type LegacyRepairAuthorization, type LegacyRepairClient, type LegacyRepairRow } from "./legacyShadowRepairGuard";

const before: LegacyRepairRow = { signal_id: "fixture-target", slug: "fixture-channel", occ: "fixture-occ",
  signal_at: "2026-09-04T15:00:00Z", entry_px: 2, exit_reason: "would_target", exit_px: 2.2,
  exit_at: "2026-09-04T15:10:00Z", pnl_per_contract: 20, stop_pct: 30, tp_pct: 10,
  n_quotes: 25, mfe_pct: 10, giveback_pct: 0, inserted_at: "2026-09-04T20:00:00Z",
  channel_spec_version_id: null, release_manifest_id: null, configuration_epoch_id: null,
  native_manager_policy_version: null, research_publisher_version: null };
const untouched = { ...before, signal_id: "fixture-unscoped" };
const authorization: LegacyRepairAuthorization = { version: "legacy-shadow-repair-authorization-v1",
  session: "2026-09-04", verificationFileSha256: "1".repeat(64), sourceProposalSha256: "2".repeat(64),
  expectedSessionRows: [before, untouched], repairs: [{ signal_id: before.signal_id, changes: { tp_pct: 12 } }] };
const input = { authorization, session: authorization.session, verificationFileSha256: authorization.verificationFileSha256,
  repairIds: [before.signal_id], observedSessionRows: [before, untouched] };
const plan = buildLegacyRepairPlan(input);
assert.equal(plan.length, 1);
assert.deepEqual(plan[0].changes, { tp_pct: 12 });
for (const altered of [[], [before], [before,before], [before,untouched,{...before,signal_id:"new"}],
  [{...before,entry_px:3},untouched], [before,{...untouched,inserted_at:"changed"}],
  [{...before,configuration_epoch_id:"new-stamp"},untouched], [{...before,new_column:null},untouched]]) {
  assert.throws(()=>buildLegacyRepairPlan({...input, observedSessionRows:altered}));
}
assert.throws(()=>buildLegacyRepairPlan({...input,session:"2026-09-03"}));
assert.throws(()=>buildLegacyRepairPlan({...input,verificationFileSha256:"3".repeat(64)}));
assert.throws(()=>buildLegacyRepairPlan({...input,repairIds:[before.signal_id,"extra"]}));
assert.throws(()=>buildLegacyRepairPlan({...input,authorization:{...authorization,repairs:[{signal_id:before.signal_id,changes:{entry_px:3}}]}}));
const stamped = {...before,research_publisher_version:"stamp"};
assert.throws(()=>buildLegacyRepairPlan({...input,observedSessionRows:[stamped,untouched],authorization:{...authorization,expectedSessionRows:[stamped,untouched]}}));
assert.throws(()=>assertExactLegacySession([before,untouched],[{...before,tp_pct:12},untouched]));

async function mockedPatch(race: "none"|"economic"|"stamp"|"deleted"|"unknown"|"unknown-after-write"|"unexpected-return") {
  let rows: LegacyRepairRow[] = structuredClone([before,untouched]);
  let mutations=0;
  const requests: Array<{method:string;path:string;keys:string[];filters:number}> = [];
  const client=createClient("https://offline-test.invalid","offline-fixture-key",{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(url,init)=>{
      const parsed=new URL(String(url));
      assert.equal(init?.method,"PATCH");assert.equal(parsed.pathname,"/rest/v1/virtual_trades");
      const changes=JSON.parse(String(init.body));assert.deepEqual(changes,{tp_pct:12});
      const filters=[...parsed.searchParams.entries()].filter(([k])=>k!=="select");
      assert.equal(filters.length,Object.keys(before).length);
      for(const [k,v] of Object.entries(before))assert.equal(parsed.searchParams.get(k),v===null?"is.null":"eq."+String(v));
      requests.push({method:init.method,path:parsed.pathname,keys:Object.keys(changes),filters:filters.length});
      if(race==="economic")rows[0].entry_px=3;
      if(race==="stamp")rows[0].research_publisher_version="concurrent-stamp";
      if(race==="deleted")rows=rows.slice(1);
      if(race==="unknown")throw new Error("Synthetic transport uncertainty");
      const matched=rows.filter(r=>filters.every(([k,v])=>v==="is.null"?r[k]===null:v==="eq."+String(r[k])));
      for(const row of matched){Object.assign(row,changes);mutations++;}
      if(race==="unknown-after-write")throw new Error("Synthetic response loss after commit");
      if(race==="unexpected-return")matched[0].research_publisher_version="unexpected-trigger-stamp";
      return new Response(JSON.stringify(matched),{status:200,headers:{"content-type":"application/json"}});
    }}
  });
  if(race==="none")await compareAndSetLegacyRepair(client as unknown as LegacyRepairClient,plan[0]);
  else await assert.rejects(compareAndSetLegacyRepair(client as unknown as LegacyRepairClient,plan[0]));
  assert.deepEqual(rows.find(r=>r.signal_id===untouched.signal_id),untouched);
  assert.equal(mutations,["none","unknown-after-write","unexpected-return"].includes(race)?1:0);
  return {race,requests:requests.length,mutations};
}
async function main(){
 const transport=[];
 for(const race of ["none","economic","stamp","deleted","unknown","unknown-after-write","unexpected-return"] as const)transport.push(await mockedPatch(race));
 console.log(JSON.stringify({suite:"legacy-shadow-repair-guard",passed:true,transport,productionNetworkCalls:0}));
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
