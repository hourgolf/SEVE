// Read-only coverage audit for the Event Tape / Review contract.
// SELECT only: this script never inserts, updates, deletes, or calls an RPC.
import { createClient } from "@supabase/supabase-js";
import { pageAll } from "../engine/pageAll";

type ExecRow = {
  id: string;
  trace_id: string;
  schema_version: number;
  event_kind: "decision" | "broker_result";
  event_at: string;
  recorded_at: string;
  strategist_id: string;
  account_id: string;
  source_boot_id: string | null;
  channel_slug: string;
  action: string;
  reason: string;
  opportunity_id: string | null;
  position_id: string | null;
  occ_symbol: string | null;
  blocked_reason: string | null;
  broker_order_id: string | null;
};

type OutcomeRow = {
  id: string;
  schema_version: number;
  event_kind: string;
  event_at: string;
  recorded_at: string;
  position_id: string;
  plan_id: string | null;
  opportunity_id: string | null;
  source_boot_id: string | null;
};

type EventRow = { id: string; created_at: string; message: string; meta: unknown };
type ShadowRow = { id: string; position_id: string; schema_version: number; status: string };

const pct = (n: number, d: number) => d ? `${Math.round(1000 * n / d) / 10}%` : "—";
const count = <T>(rows: T[], predicate: (row: T) => boolean) => rows.filter(predicate).length;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hasAny = (value: unknown, keys: string[]) => isRecord(value) && keys.some((key) => value[key] != null);
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the operator-only evidence tables");

  const since = arg("--since") ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [execution, outcomes, events, shadows] = await Promise.all([
    pageAll<ExecRow>((from) => sb.from("execution_observations")
      .select("id,trace_id,schema_version,event_kind,event_at,recorded_at,strategist_id,account_id,source_boot_id,channel_slug,action,reason,opportunity_id,position_id,occ_symbol,blocked_reason,broker_order_id")
      .gte("event_at", since).order("event_at").order("id"), { max: 100_000 }),
    pageAll<OutcomeRow>((from) => sb.from("position_outcome_events")
      .select("id,schema_version,event_kind,event_at,recorded_at,position_id,plan_id,opportunity_id,source_boot_id")
      .gte("event_at", since).order("event_at").order("id"), { max: 100_000 }),
    pageAll<EventRow>((from) => sb.from("events")
      .select("id,created_at,message,meta")
      .gte("created_at", since).order("created_at").order("id"), { max: 100_000 }),
    pageAll<ShadowRow>((from) => sb.from("manager_shadow_runs")
      .select("id,position_id,schema_version,status")
      .gte("created_at", since).order("created_at").order("id"), { max: 100_000 }),
  ]);

  const tracePhases = new Map<string, Set<string>>();
  for (const row of execution) {
    const phases = tracePhases.get(row.trace_id) ?? new Set<string>();
    phases.add(row.event_kind);
    tracePhases.set(row.trace_id, phases);
  }
  const traces = [...tracePhases.values()];
  const completeTraces = traces.filter((phases) => phases.has("decision") && phases.has("broker_result")).length;
  const decisions = execution.filter((row) => row.event_kind === "decision");
  const blockedDecisions = decisions.filter((row) => !!row.blocked_reason);
  const orderEligibleTraceIds = new Set(decisions.filter((row) => !row.blocked_reason).map((row) => row.trace_id));
  const orderEligibleComplete = [...orderEligibleTraceIds].filter((traceId) => tracePhases.get(traceId)?.has("broker_result")).length;
  const missingBroker = decisions.filter((row) => !row.blocked_reason && !tracePhases.get(row.trace_id)?.has("broker_result"));
  const brokerRows = execution.filter((row) => row.event_kind === "broker_result");
  const receiptLag = [...execution.map((row) => Date.parse(row.recorded_at) - Date.parse(row.event_at)), ...outcomes.map((row) => Date.parse(row.recorded_at) - Date.parse(row.event_at))]
    .filter(Number.isFinite).sort((a, b) => a - b);
  const p95Lag = receiptLag.length ? receiptLag[Math.min(receiptLag.length - 1, Math.floor(receiptLag.length * 0.95))] : null;

  const structuredMeta = count(events, (row) => isRecord(row.meta));
  const metaKind = count(events, (row) => hasAny(row.meta, ["kind"]));
  const metaTradeRef = count(events, (row) => hasAny(row.meta, ["position_id", "positionId", "signal_id", "signalId", "opportunity_id", "opportunityId", "occ", "occ_symbol"]));
  const manualEvents = events.filter((row) => row.message.startsWith("manual:"));
  const manualLinked = count(manualEvents, (row) => hasAny(row.meta, ["position_id", "positionId"]));
  const manualReasonOutcomes = outcomes.filter((row) => row.event_kind === "manual_reason_tagged");

  console.log(`EVENT / REVIEW LINKAGE AUDIT · since ${since}`);
  console.log(`execution observations  ${execution.length}`);
  console.log(`  traces                ${traces.length}`);
  console.log(`  all decision+broker   ${completeTraces}/${traces.length} (${pct(completeTraces, traces.length)})`);
  console.log(`  blocked decisions     ${blockedDecisions.length}/${decisions.length} (${pct(blockedDecisions.length, decisions.length)})`);
  console.log(`  eligible+broker       ${orderEligibleComplete}/${orderEligibleTraceIds.size} (${pct(orderEligibleComplete, orderEligibleTraceIds.size)})`);
  console.log(`  opportunity linked    ${count(execution, (row) => !!row.opportunity_id)}/${execution.length} (${pct(count(execution, (row) => !!row.opportunity_id), execution.length)})`);
  console.log(`  position linked       ${count(execution, (row) => !!row.position_id)}/${execution.length} (${pct(count(execution, (row) => !!row.position_id), execution.length)})`);
  console.log(`  boot linked           ${count(execution, (row) => !!row.source_boot_id)}/${execution.length} (${pct(count(execution, (row) => !!row.source_boot_id), execution.length)})`);
  console.log(`  contract linked       ${count(execution, (row) => !!row.occ_symbol)}/${execution.length} (${pct(count(execution, (row) => !!row.occ_symbol), execution.length)})`);
  console.log(`  broker order linked   ${count(brokerRows, (row) => !!row.broker_order_id)}/${brokerRows.length} (${pct(count(brokerRows, (row) => !!row.broker_order_id), brokerRows.length)})`);
  if (missingBroker.length) {
    console.log("  eligible gaps");
    for (const row of missingBroker.slice(0, 20)) console.log(`    ${row.event_at} · ${row.channel_slug} · ${row.action}/${row.reason} · ${row.occ_symbol}`);
  }
  console.log(`position outcomes       ${outcomes.length}`);
  console.log(`  plan linked           ${count(outcomes, (row) => !!row.plan_id)}/${outcomes.length} (${pct(count(outcomes, (row) => !!row.plan_id), outcomes.length)})`);
  console.log(`  opportunity linked    ${count(outcomes, (row) => !!row.opportunity_id)}/${outcomes.length} (${pct(count(outcomes, (row) => !!row.opportunity_id), outcomes.length)})`);
  console.log(`  boot linked           ${count(outcomes, (row) => !!row.source_boot_id)}/${outcomes.length} (${pct(count(outcomes, (row) => !!row.source_boot_id), outcomes.length)})`);
  console.log(`system receipts         ${events.length}`);
  console.log(`  structured meta       ${structuredMeta}/${events.length} (${pct(structuredMeta, events.length)})`);
  console.log(`  typed kind            ${metaKind}/${events.length} (${pct(metaKind, events.length)})`);
  console.log(`  durable trade ref     ${metaTradeRef}/${events.length} (${pct(metaTradeRef, events.length)})`);
  console.log(`  manual close linked   ${manualLinked}/${manualEvents.length} (${pct(manualLinked, manualEvents.length)})`);
  console.log(`  reason-tag outcomes   ${manualReasonOutcomes.length}`);
  console.log(`manager shadow runs     ${shadows.length} (${shadows.filter((row) => row.status === "terminal").length} terminal, ${shadows.filter((row) => row.status === "censored").length} censored)`);
  console.log(`receipt lag p95         ${p95Lag == null ? "—" : `${Math.round(p95Lag)}ms`}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
