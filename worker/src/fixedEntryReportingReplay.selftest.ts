import assert from "node:assert/strict";
import { fixedCoverageHarness } from "./fixedEntryCoverage.fixtures.js";
import { coordinateFixedCommand } from "./fixedEntryCommandCoordinator.js";
import { materializeFixedEntryCoverage } from "./fixedEntryCoverageMaterialization.js";
import { createFixedEntryServiceClient } from "./fixedEntryServiceClient.js";
import { makeFixedEntryReportingReplay } from "./fixedEntryReportingReplay.js";
import { buildFixedEntryReporting } from "./fixedEntryReporting.js";
async function main() {
  const h = fixedCoverageHarness(); await coordinateFixedCommand(h.commandPorts,h.intent,h.buy);
  await h.lateBuy(); await materializeFixedEntryCoverage(h.coverage,h.intent);
  const plan = buildFixedEntryReporting(h.intent, await h.coverage.snapshot(h.intent));
  const tables: Record<string,Map<string,Record<string,unknown>>> = { execution_observations: new Map(), position_outcome_events: new Map() };
  for (const [id,row] of h.db) tables.execution_observations.set(id, structuredClone(row) as unknown as Record<string,unknown>);
  let loseResponse = true, loseRead = false, cohortsReady = true, cohortCalls = 0;
  const writes: string[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const u = new URL(String(request)), table = u.pathname.split("/").at(-1)!;
    const method = init?.method ?? "GET";
    assert.ok(["GET","POST"].includes(method));
    if (method === "POST") {
      assert.ok(table === "execution_observations" || table === "position_outcome_events");
      assert.ok(new Headers(init?.headers).get("prefer")?.includes("resolution=ignore-duplicates"));
      const row = JSON.parse(String(init?.body)) as Record<string,unknown>;
      writes.push(table);
      if (!tables[table].has(String(row.id))) tables[table].set(String(row.id), structuredClone(row));
      if (loseResponse) { loseResponse = false; return new Response("{}", {status:503}); }
      return new Response(null,{status:201});
    }
    if (loseRead && u.searchParams.has("id")) return new Response("{}",{status:503});
    const all: Record<string,unknown>[] = table === "positions" ? [...h.positions.values()].map(r => ({...r}))
      : [...tables[table].values()];
    const selected = all.filter(row => [...u.searchParams].every(([key,value]) => {
      if (["select","order","offset","limit"].includes(key)) return true;
      let target: unknown = row;
      for (const part of key.split(/->>?/)) target = (target as Record<string,unknown> | null)?.[part];
      return value === `eq.${target}`;
    })).sort((a,b) => String(a.id).localeCompare(String(b.id)));
    // PostgreSQL's equivalent timestamp spelling must not create false drift.
    const normalized = selected.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) =>
      [k, ["event_at","source_bar_at"].includes(k) && typeof v === "string" ? v.replace(".000Z","+00:00") : v])));
    return new Response(JSON.stringify(normalized), {headers: {"content-type":"application/json",
      "content-range":`0-${Math.max(0,selected.length-1)}/${selected.length}`}});
  };
  const token = ["eyJhbGciOiJIUzI1NiJ9",Buffer.from('{"role":"service_role"}').toString("base64url"),"fixture"].join(".");
  const client = createFixedEntryServiceClient("https://fixture.supabase.co",token,fetcher);
  const replay = makeFixedEntryReportingReplay(client,"00000000-0000-4000-8000-000000000004",{
    cohorts: async (_intent,cohorts) => { cohortCalls++; assert.deepEqual(cohorts,plan.cohorts); return cohortsReady; } });
  await assert.rejects(replay(h.intent), /write_unconfirmed/);
  await replay(h.intent);
  assert.equal(tables.position_outcome_events.size,plan.outcomes.length);
  assert.equal(tables.execution_observations.size,h.db.size+plan.execution.length);
  const first = structuredClone([...tables.execution_observations.values()]);
  await replay(h.intent); assert.deepEqual([...tables.execution_observations.values()],first);
  const entry = tables.execution_observations.get(plan.execution[0].id)!;
  entry.event_at = "2026-09-08T14:30:00.999Z"; entry.payload = {decisionDetail:{contemporaneousQuote:true}};
  await replay(h.intent); // Existing original bar-loop detail is preserved.
  const broker = tables.execution_observations.get(plan.execution.find(r => r.event_kind === "broker_result")!.id)!;
  const prior = broker.filled_qty; broker.filled_qty = 1;
  await assert.rejects(replay(h.intent), /immutable_readback_conflict/); broker.filled_qty = prior;
  loseRead = true; await assert.rejects(replay(h.intent), /readback_unconfirmed/); loseRead = false;
  cohortsReady = false; await assert.rejects(replay(h.intent), /manager_cohort_unconfirmed/);
  cohortsReady = true; await replay(h.intent);
  assert.ok(cohortCalls >= 4); assert.ok(writes.length > 0);
  console.log("fixedEntryReportingReplay: PASS · exact SDK append-only writes/readback, response loss, replay, original decision preservation, economic conflict, equivalent database timestamps and cohort failure");
}
void main().catch(e => {console.error(e);process.exitCode=1;});
