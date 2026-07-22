// Bounded, SELECT-only live-position evidence check.
//
// This intentionally avoids the legacy health command's broad event/signal
// scans. It starts from at most 24 currently-open positions and follows indexed
// position_id joins into the evidence ledgers. It never contacts an order route
// and never writes Supabase or R2.

import { managerIdsForChannel } from "@/engine/managerPolicy";
import { createServerSupabaseClient } from "./serverSupabase";

interface PositionRow {
  id: string;
  occ_symbol: string;
  qty: number | string;
  avg_entry_price: number | string;
  opened_at: string;
  peak_mark: number | string | null;
  strategists: { slug?: string; account_id?: string } | Array<{ slug?: string; account_id?: string }> | null;
}

const relation = (value: PositionRow["strategists"]): { slug?: string; account_id?: string } =>
  Array.isArray(value) ? value[0] ?? {} : value ?? {};

const age = (at: string): number => Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000));
const state = (ok: boolean, pending = false): string => ok ? "GREEN" : pending ? "YELLOW" : "RED";

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("live-position-evidence");
  const positionsRead = await sb.from("positions")
    .select("id,occ_symbol,qty,avg_entry_price,opened_at,peak_mark,strategists!inner(slug,account_id)")
    .eq("status", "open").order("opened_at", { ascending: true }).limit(24);
  if (positionsRead.error) throw new Error(`open position read failed: ${positionsRead.error.message}`);
  const positions = (positionsRead.data ?? []) as unknown as PositionRow[];

  console.log("\n══ LIVE POSITION EVIDENCE · SELECT ONLY ══");
  console.log(`Open positions: ${positions.length}`);
  if (!positions.length) return;

  let hardFailures = 0;
  for (const position of positions) {
    const channel = relation(position.strategists).slug ?? "unknown";
    const expectedManagers = managerIdsForChannel(channel).length;
    const since = position.opened_at;
    const [outcomes, managers, captures, captureHealth] = await Promise.all([
      sb.from("position_outcome_events")
        .select("event_kind,event_at,plan_id,opportunity_id,quantity,avg_entry_price,close_reason")
        .eq("position_id", position.id).order("event_at", { ascending: true }).limit(8),
      sb.from("manager_shadow_runs")
        .select("manager_id,status,evidence_state,entry_at,first_quote_at,last_quote_at,last_observed_at,consecutive_quote_misses,quote_max_age_ms,censor_code,economic_mode,original_qty")
        .eq("position_id", position.id).order("manager_id", { ascending: true }).limit(12),
      sb.from("held_contract_capture_receipts")
        .select("sample_count,successful_quote_count,dropped_samples,first_fetch_at,last_fetch_at,completed_at,gap_count,max_observation_gap_ms")
        .eq("position_id", position.id).order("completed_at", { ascending: false }).limit(3),
      sb.from("held_contract_capture_health")
        .select("severity,code,observed_at,affected_samples")
        .eq("position_id", position.id).gte("observed_at", since)
        .order("observed_at", { ascending: false }).limit(20),
    ]);

    const reads = { outcomes, managers, captures, captureHealth };
    const errors = Object.entries(reads).filter(([, read]) => read.error).map(([label, read]) => `${label}:${read.error?.message}`);
    if (errors.length) {
      hardFailures += 1;
      console.log(`\nRED ${channel} · ${position.occ_symbol} · evidence read failed`);
      for (const error of errors) console.log(`  ${error}`);
      continue;
    }

    const outcomeRows = outcomes.data ?? [];
    const openedOutcome = outcomeRows.find((row) => row.event_kind === "position_opened");
    const opportunityId = openedOutcome?.opportunity_id;
    const [opportunityObservations, plan] = await Promise.all([
      opportunityId
        ? sb.from("execution_observations")
          .select("trace_id,event_kind,event_at,action,reason,blocked_reason,occ_symbol,requested_qty,broker_status,filled_qty,fill_price,quote_age_ms")
          .eq("opportunity_id", opportunityId).order("event_at", { ascending: true }).limit(8)
        : Promise.resolve({ data: [], error: null }),
      opportunityId
        ? sb.from("position_plans")
          .select("id,state,created_at,activated_at,policy_epoch_id,opportunity_id")
          .eq("opportunity_id", opportunityId).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (opportunityObservations.error || plan.error) {
      hardFailures += 1;
      console.log(`\nRED ${channel} · ${position.occ_symbol} · opportunity evidence read failed`);
      if (opportunityObservations.error) console.log(`  observations:${opportunityObservations.error.message}`);
      if (plan.error) console.log(`  plan:${plan.error.message}`);
      continue;
    }
    const observationRows = opportunityObservations.data ?? [];
    const decision = observationRows.some((row) => row.event_kind === "decision" && row.action === "enter");
    const fill = observationRows.some((row) => row.event_kind === "broker_result" && Number(row.filled_qty ?? 0) > 0);
    const outcomeOpen = Boolean(openedOutcome);
    const planBound = Boolean(plan.data && openedOutcome?.plan_id === plan.data.id);
    const managerRows = managers.data ?? [];
    const managerIds = new Set(managerRows.map((row) => row.manager_id));
    const managerComplete = managerIds.size === expectedManagers;
    const observing = managerRows.filter((row) => row.evidence_state === "observing").length;
    const managerEvidenceReady = managerComplete && observing === expectedManagers;
    const managerEvidencePending = managerComplete && !managerEvidenceReady;
    const captureRows = captures.data ?? [];
    const captureFailures = (captureHealth.data ?? []).reduce((sum, row) => sum + Number(row.affected_samples ?? 0), 0);
    const openAgeSec = age(position.opened_at);
    const capturePending = captureRows.length === 0 && openAgeSec < 120;
    const captureOk = captureRows.length > 0 && captureFailures === 0;
    // Position plans are observe-only in Phase 1C: they intentionally remain
    // `planned` and position_id remains null. The opportunity and plan_id carried
    // by the immutable opened outcome are the authoritative analytical joins.
    const entryOk = Boolean(opportunityId) && decision && fill && planBound && outcomeOpen;

    if (!entryOk || !managerComplete || (!captureOk && !capturePending)) hardFailures += 1;
    console.log(`\n${channel} · ${position.occ_symbol} · qty ${position.qty} · open ${openAgeSec}s`);
    console.log(`  ${state(entryOk)} entry lineage · opportunity=${opportunityId ? "bound" : "missing"} decision=${decision} fill=${fill} plan=${plan.data?.state ?? "missing"}/${planBound ? "bound" : "unbound"} outcome=${outcomeOpen}`);
    console.log(`  ${state(managerEvidenceReady, managerEvidencePending)} manager arms · ${managerIds.size}/${expectedManagers} · observing=${observing} · states=${[...new Set(managerRows.map((row) => `${row.status}/${row.evidence_state}`))].join(",") || "none"}`);
    if (managerRows.length) {
      const misses = managerRows.reduce((sum, row) => sum + Number(row.consecutive_quote_misses ?? 0), 0);
      console.log(`    quote evidence: first=${managerRows[0].first_quote_at ?? "none"} last=${managerRows[0].last_quote_at ?? "none"} misses=${misses} maxAgeMs=${managerRows[0].quote_max_age_ms}`);
    }
    console.log(`  ${state(captureOk, capturePending)} held capture · receipts=${captureRows.length} affected=${captureFailures}${capturePending ? " · first segment pending" : ""}`);
    if (captureRows[0]) {
      console.log(`    latest: samples=${captureRows[0].sample_count} good=${captureRows[0].successful_quote_count} dropped=${captureRows[0].dropped_samples} gaps=${captureRows[0].gap_count}`);
    }
  }

  if (hardFailures) {
    console.log(`\nRESULT: RED · ${hardFailures} position(s) have missing or failed durable evidence`);
    process.exitCode = 2;
  } else {
    console.log("\nRESULT: GREEN/YELLOW · durable entry and capture evidence are present; yellow denotes an admitted manager arm awaiting durable first-quote proof or bounded first-segment capture latency");
  }
}

main().catch((error) => {
  console.error(`live-position-evidence failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
