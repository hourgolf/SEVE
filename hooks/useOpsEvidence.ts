"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { startVisibilityPoll } from "@/lib/pollControl";
import type {
  CaptureHealthRow,
  CaptureReceiptRow,
  ExecutionEvidenceRow,
  ManagerEvidenceRow,
  OpsEvidence,
  OpsEvidenceRead,
  PositionOutcomeEvidenceRow,
  PublisherEvidenceRow,
} from "@/lib/ops/readiness";
import type { BrokerReconciliationReceipt } from "@/lib/ops/brokerReconciliation";

const initial = <T,>(): OpsEvidenceRead<T> => ({
  state: "loading", rows: [], error: "", fetchedAtMs: null, lastOkAtMs: null,
});

const INITIAL: OpsEvidence = {
  execution: initial<ExecutionEvidenceRow>(),
  managers: initial<ManagerEvidenceRow>(),
  captures: initial<CaptureReceiptRow>(),
  captureHealth: initial<CaptureHealthRow>(),
  publisher: initial<PublisherEvidenceRow>(),
  outcomes: initial<PositionOutcomeEvidenceRow>(),
  broker: initial<BrokerReconciliationReceipt>(),
};

const message = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error ?? "read rejected");
};

interface QueryResult { data: unknown; error: unknown }

async function readBrokerReceipt(): Promise<QueryResult> {
  const sb = getSupabase();
  const { data: { session }, error } = await sb.auth.getSession();
  if (error || !session?.access_token) return { data: null, error: error ?? new Error("operator sign-in required") };
  try {
    const response = await fetch("/api/broker-reconciliation", {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; receipt?: BrokerReconciliationReceipt; error?: string };
    if (!response.ok || !body.ok || !body.receipt) return { data: null, error: new Error(body.error ?? `broker read failed (${response.status})`) };
    return { data: [body.receipt], error: null };
  } catch (readError) {
    return { data: null, error: readError };
  }
}

function applyRead<T>(previous: OpsEvidenceRead<T>, settled: PromiseSettledResult<QueryResult>, nowMs: number): OpsEvidenceRead<T> {
  if (settled.status === "rejected") return { ...previous, state: "error", error: message(settled.reason), fetchedAtMs: nowMs };
  if (settled.value.error) return { ...previous, state: "error", error: message(settled.value.error), fetchedAtMs: nowMs };
  return { state: "ok", rows: (settled.value.data ?? []) as T[], error: "", fetchedAtMs: nowMs, lastOkAtMs: nowMs };
}

/**
 * One compact, operator-scoped evidence poll for the Ops workspace. The
 * research tables remain RLS protected and the broker comparison is served by
 * an operator-authenticated, read-only route; unauthenticated reads surface as
 * independent errors and never become fabricated empty ledgers. Leaves receive
 * this result through SurfaceProps and do not subscribe on their own.
 */
export function useOpsEvidence(pollMs = 120_000, enabled = true): OpsEvidence {
  const [state, setState] = useState<OpsEvidence>(INITIAL);

  useEffect(() => {
    // These are deliberately deeper operational ledgers, not shell telemetry.
    // Loading them from every PLAY/STUDIO/BOOK/REVIEW surface multiplied a
    // multi-table read across every open dashboard even though only OPS renders
    // the result. Keep the hook at the page-owned seam, but activate its remote
    // reads only while the operator is actually in OPS.
    if (!enabled) return;
    let alive = true;
    const poll = async () => {
      const sb = getSupabase();
      const since = new Date(Date.now() - 36 * 3600_000).toISOString();
      const results = await Promise.allSettled([
        sb.from("execution_observations")
          .select("id,event_kind,event_at,source_bar_at,channel_slug,opportunity_id,position_id,action,blocked_reason,occ_symbol,filled_qty,broker_status,payload")
          .gte("event_at", since).order("event_at", { ascending: false }).limit(150),
        sb.from("manager_shadow_runs")
          .select("id,position_id,channel_slug,manager_id,status,evidence_state,entry_at,last_observed_at,manager_policy_version,shadow_book_version,censor_code")
          .gte("entry_at", since).order("entry_at", { ascending: false }).limit(150),
        sb.from("held_contract_capture_receipts")
          .select("id,position_id,channel_slug,occ_symbol,session_date_et,sample_count,successful_quote_count,dropped_samples,completed_at")
          .gte("completed_at", since).order("completed_at", { ascending: false }).limit(100),
        sb.from("held_contract_capture_health")
          .select("id,observed_at,severity,code,position_id,affected_samples")
          .gte("observed_at", since).order("observed_at", { ascending: false }).limit(50),
        sb.from("events").select("id,message,created_at")
          .ilike("message", "%shadow-publish:%").gte("created_at", since)
          .order("created_at", { ascending: false }).limit(12),
        sb.from("position_outcome_events")
          .select("id,event_kind,event_at,position_id,opportunity_id,quantity,exit_price,realized_pnl,close_reason")
          .gte("event_at", since).order("event_at", { ascending: false }).limit(150),
        readBrokerReceipt(),
      ]);
      if (!alive) return;
      const nowMs = Date.now();
      setState((previous) => ({
        execution: applyRead(previous.execution, results[0] as PromiseSettledResult<QueryResult>, nowMs),
        managers: applyRead(previous.managers, results[1] as PromiseSettledResult<QueryResult>, nowMs),
        captures: applyRead(previous.captures, results[2] as PromiseSettledResult<QueryResult>, nowMs),
        captureHealth: applyRead(previous.captureHealth, results[3] as PromiseSettledResult<QueryResult>, nowMs),
        publisher: applyRead(previous.publisher, results[4] as PromiseSettledResult<QueryResult>, nowMs),
        outcomes: applyRead(previous.outcomes, results[5] as PromiseSettledResult<QueryResult>, nowMs),
        broker: applyRead(previous.broker, results[6] as PromiseSettledResult<QueryResult>, nowMs),
      }));
    };
    void poll();
    const stop = startVisibilityPoll(() => void poll(), pollMs);
    return () => { alive = false; stop(); };
  }, [enabled, pollMs]);

  return state;
}
