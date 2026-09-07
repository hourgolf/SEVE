// GET/SELECT-only consumer for B1 cutover inspection. Never invokes a worker or order.
import { readFileSync } from "node:fs";
import { readDecisionStageEvidence } from "../lib/research/decisionStageEvidence";
import { createServerSupabaseClient } from "./serverSupabase";
async function main() {
  const args = process.argv.slice(2), get = (key: string) => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  let rows: Record<string, any>[];
  const input = get("--input");
  if (input) rows = JSON.parse(readFileSync(input, "utf8"));
  else {
    const from = get("--from"), through = get("--through");
    if (!from || !through || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(through)) || Date.parse(through) <= Date.parse(from)) throw Error("Provide explicit --from and --through ISO timestamps or --input JSON.");
    const sb = createServerSupabaseClient("decision stage evidence SELECT"); rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await sb.from("execution_observations")
        .select("id,trace_id,event_kind,event_at,channel_slug,account_id,configuration_epoch_id,payload")
        .gte("event_at", from).lt("event_at", through).order("event_at").order("id").range(offset, offset + 499);
      if (error) throw Error("execution_observations SELECT failed: " + error.code);
      rows.push(...(data ?? [])); if ((data?.length ?? 0) < 500) break;
    }
  }
  const result = rows.map(readDecisionStageEvidence);
  console.log(JSON.stringify({ productionWrites: 0, rows: rows.length, traces: result.filter(x => x.state === "observed").length, evidence: result }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
