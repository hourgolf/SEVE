// Add a ledger companion to one existing completed report. Default is read-only.
// Preserve every existing research payload and its original generation timestamp.
import { createServerSupabaseClient } from "./serverSupabase";
import { pageAll } from "../engine/pageAll";
import { etWallMinuteUtc, afterCloseReadyAtMs } from "../lib/research/afterCloseResearch";
import { latestImmutableExecutionAccountRoutes, type ExecutionAccountObservation } from "../lib/ops/brokerReconciliation";
import { buildForensicsExecutionSummary, readForensicsExecutionSummary } from "../lib/research/forensicsExecutionSummary";
import { canonicalJson } from "../lib/channels/channelControlPlane";

async function main() {
  const dateIndex = process.argv.indexOf("--date");
  const date = dateIndex >= 0 ? process.argv[dateIndex + 1] : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date YYYY-MM-DD required");
  if (Date.now() < afterCloseReadyAtMs(date)) throw new Error("Session close evidence is not ready");
  const apply = process.argv.includes("--apply"), sb = createServerSupabaseClient("forensics execution summary");
  const { data: report, error } = await sb.from("forensics_reports").select("report_date,generated_at,payload")
    .eq("report_date", date).single();
  if (error || !report || Date.parse(report.generated_at) < afterCloseReadyAtMs(date)) throw new Error("Completed report required");
  const nextDate = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const from = etWallMinuteUtc(date, 0), toExclusive = etWallMinuteUtc(nextDate, 0);
  const rows = await pageAll<any>(() => sb.from("positions")
    .select("id,qty,realized_pnl,runner_of,strategists(slug)").eq("status", "closed")
    .gte("closed_at", from).lt("closed_at", toExclusive).order("id"), { max: 50_000 });
  const routes: ExecutionAccountObservation[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    routes.push(...await pageAll<ExecutionAccountObservation>(() => sb.from("execution_observations")
      .select("id,position_id,account_id,event_at").in("position_id", rows.slice(i, i + 200).map(p => p.id))
      .eq("reason", "position_account_route_bound").order("id"), { max: 50_000 }));
  }
  const accounts = latestImmutableExecutionAccountRoutes(routes);
  const executionSummary = buildForensicsExecutionSummary({ date, observedAt: new Date().toISOString(), from, toExclusive,
    rows: rows.map(p => ({ ...p, account_id: accounts.get(p.id)?.accountId ?? null })) });
  const payload = { ...report.payload, executionSummary };
  if (apply) {
    const updated = await sb.from("forensics_reports").update({ payload }).eq("report_date", date)
      .eq("generated_at", report.generated_at).filter("payload", "eq", JSON.stringify(report.payload))
      .select("report_date,generated_at,payload");
    if (updated.error || updated.data?.length !== 1) throw new Error("Report changed or update failed; reread before retry");
    const actual = updated.data[0];
    if (actual.generated_at !== report.generated_at || canonicalJson(actual.payload) !== canonicalJson(payload)
      || !readForensicsExecutionSummary(actual.payload.executionSummary, date)) throw new Error("Report readback mismatch");
  }
  console.log(JSON.stringify({ apply, reportGeneratedAt: report.generated_at, executionSummary }, null, 2));
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
