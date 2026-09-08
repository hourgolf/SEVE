import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import { buildFixedEntryReporting } from "./fixedEntryReporting.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { buildFixedManagerEnrollment,persistFixedManagerEnrollment } from "./fixedEntryManagerEnrollment.js";
import { advanceManagerShadowRun,encodeManagerShadowRun,type ManagerShadowDbRow } from "./managerShadowBookModel.js";
async function main() {
  const h = fixedCoverageHarness(),submit = h.commandPorts.submitOnce;
  h.commandPorts.submitOnce = async (account,request) => {
    const result = await submit(account,request);
    const full = {...result,filled_qty:"4",status:"filled"};
    h.broker.set(request.client_order_id,full);h.setHeld(4);return full;
  };
  await coordinateFixedCommand(h.commandPorts,h.intent,h.buy);await materializeFixedEntryCoverage(h.coverage,h.intent);
  const cohorts = buildFixedEntryReporting(h.intent,await h.coverage.snapshot(h.intent)).cohorts;
  assert.equal(cohorts[0].censorCode,null);
  const boot = "00000000-0000-4000-8000-000000000004";
  const db = new Map<string,ManagerShadowDbRow & {configuration_epoch_id:string}>();
  let loseResponse = true,failRead = false,updates = 0;
  const fetcher:typeof fetch = async (request,init) => {
    const u = new URL(String(request));assert.ok(u.pathname.endsWith("/manager_shadow_runs"));
    const method = init?.method ?? "GET";assert.ok(["GET","POST","PATCH"].includes(method));
    if (method === "POST") {
      assert.ok(new Headers(init?.headers).get("prefer")?.includes("resolution=ignore-duplicates"));
      const rows = JSON.parse(String(init?.body)) as (ManagerShadowDbRow & {configuration_epoch_id:string})[];
      for (const row of rows) if (!db.has(row.id)) db.set(row.id,structuredClone(row));
      if (loseResponse) {loseResponse=false;return new Response("{}",{status:503});}
      return new Response(null,{status:201});
    }
    if (method === "PATCH") {
      assert.equal(u.searchParams.get("status"),"eq.active");
      const id = u.searchParams.get("id")!.slice(3),row = db.get(id)!;
      if (row.status === "active") {Object.assign(row,JSON.parse(String(init?.body)));updates++;}
      return new Response(null,{status:204});
    }
    if (failRead) return new Response("{}",{status:503});
    const rows = [...db.values()].filter(row => u.searchParams.get("position_id") === `eq.${row.position_id}`).sort((a,b) => a.id.localeCompare(b.id));
    return new Response(JSON.stringify(rows),{headers:{"content-type":"application/json","content-range":`0-${Math.max(0,rows.length-1)}/${rows.length}`}});
  };
  const token = ["eyJhbGciOiJIUzI1NiJ9",Buffer.from('{"role":"service_role"}').toString("base64url"),"fixture"].join(".");
  const client = createFixedEntryServiceClient("https://fixture.supabase.co",token,fetcher);
  const persist = (cs=cohorts,nowMs=h.coverage.now()) => persistFixedManagerEnrollment(client,boot,h.intent,cs,{nowMs,quoteMaxAgeMs:15_000});
  await assert.rejects(persist(),/enrollment_write_unconfirmed/);
  const first = await persist();assert.ok(first.length>0);assert.ok(first.every(r => r.run.status === "active"));
  assert.ok(first.every(r => r.run.accountId === h.intent.accountId && r.run.originalQty === 4 && r.run.entryPrice === 2));
  assert.ok([...db.values()].every(r => r.configuration_epoch_id === h.intent.writeStamp.configuration_epoch_id));
  assert.deepEqual(await persist(cohorts,h.coverage.now()+60_000),first,"replay retains original admission clock and eligibility");
  const bell = first.find(r => r.run.managerId === "BELL/no-stop")!;assert.ok(bell);
  const terminal = advanceManagerShadowRun(bell.run,{bid:3,ask:3.01,quoteAtMs:h.coverage.now()+1000,
    observedAtMs:h.coverage.now()+1000,snapshotFetchedAtMs:h.coverage.now()+1000,isBell:true}).run;
  assert.equal(terminal.status,"terminal");
  db.set(terminal.id,{...encodeManagerShadowRun(terminal,{sourceBootId:boot,terminalBootId:boot})!,
    configuration_epoch_id:h.intent.writeStamp.configuration_epoch_id});
  const frozenTerminal = structuredClone(db.get(terminal.id));
  const censored = cohorts.map(c => ({...c,censorCode:"fixed_partial_or_multiple_coverage_generations"}));
  const later = await persist(censored,h.coverage.now()+5_000);
  assert.deepEqual(db.get(terminal.id),frozenTerminal,"later exclusion does not rewrite terminal economics");
  assert.ok(later.filter(r => r.run.id!==terminal.id).every(r => r.run.status === "censored"));assert.ok(updates>0);
  const late = buildFixedManagerEnrollment(h.intent,cohorts[0],{admittedAt:new Date(h.coverage.now()+31_000).toISOString(),quoteMaxAgeMs:15_000});
  assert.ok(late.every(r => r.status === "censored" && r.censorCode === "fixed_recovery_missing_entry_quotes"));
  assert.ok(late.every(r => r.admissionSource === "recovery_open"));
  // Reproduce a partial append followed by an outage: a newly persisted arm
  // must not inherit the first arm's earlier admission timestamp.
  const saved = new Map([...db].map(([id,row]) => [id,structuredClone(row)]));
  db.clear();
  db.set(first[0].run.id,{...encodeManagerShadowRun(first[0].run,{sourceBootId:boot})!,
    configuration_epoch_id:h.intent.writeStamp.configuration_epoch_id});
  const delayedNow = h.coverage.now()+60_000;
  const recovered = await persist(cohorts,delayedNow);
  assert.equal(recovered.find(r => r.run.id===first[0].run.id)!.run.admittedAt,first[0].run.admittedAt);
  assert.ok(recovered.filter(r => r.run.id!==first[0].run.id).length>0);
  assert.ok(recovered.filter(r => r.run.id!==first[0].run.id).every(r =>
    r.run.admittedAt===new Date(delayedNow).toISOString() && r.run.status==="censored"
    && r.run.censorCode==="fixed_recovery_missing_entry_quotes"));
  assert.deepEqual(await persist(cohorts,delayedNow+1_000),recovered,"heterogeneous truthful clocks survive restart");
  db.clear();for(const [id,row] of saved) db.set(id,row);
  const row = [...db.values()][0],qty = row.original_qty;row.original_qty=1;
  await assert.rejects(persist(),/immutable_enrollment_conflict/);row.original_qty=qty;
  failRead=true;await assert.rejects(persist(),/inventory_unavailable/);
  console.log("fixedEntryManagerEnrollment: PASS · exact original cohort/account, durable readback, response loss/restart, late censor, active-only exclusion, preserved terminal economics and immutable conflict");
}
void main().catch(e => {console.error(e);process.exitCode=1;});
