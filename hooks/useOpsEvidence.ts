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

interface QueryResult {
  data: unknown;
  error: unknown;
  summary?: { candidates: number; suppressed: number };
}

const rowsOrError = (results: Array<{ data: unknown; error: unknown }>): QueryResult => {
  const failed = results.find((result) => result.error);
  if (failed) return { data: null, error: failed.error };
  return { data: results.flatMap((result) => Array.isArray(result.data) ? result.data : []), error: null };
};

async function readAccessToken(): Promise<string> {
  const read = getSupabase().auth.getSession().then(({ data: { session }, error }) => {
    if (error) throw error;
    if (!session?.access_token) throw new Error("operator sign-in required");
    return session.access_token;
  });
  return Promise.race([
    read,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("operator session read timed out")), 3_000)),
  ]);
}

async function readExecutions(accountIds: string[], token: string): Promise<QueryResult> {
  if (!accountIds.length) return { data: [], error: null, summary: { candidates: 0, suppressed: 0 } };
  try {
    const response = await fetch("/api/ops-execution-evidence", {
      headers: { authorization: `Bearer ${token}` }, cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean; rows?: ExecutionEvidenceRow[]; summary?: { candidates: number; suppressed: number }; error?: string;
    };
    if (!response.ok || !body.ok) return { data: null, error: new Error(body.error ?? `OPS evidence failed (${response.status})`) };
    return { data: body.rows ?? [], error: null, summary: body.summary ?? { candidates: 0, suppressed: 0 } };
  } catch (readError) {
    return { data: null, error: readError };
  }
}

async function readManagers(accountIds: string[], since: string): Promise<QueryResult> {
  if (!accountIds.length) return { data: [], error: null };
  const sb = getSupabase();
  const reads = await Promise.all(accountIds.map((accountId) => sb.from("manager_shadow_runs")
    .select("id,position_id,channel_slug,manager_id,status,evidence_state,entry_at,last_observed_at,manager_policy_version,shadow_book_version,censor_code")
    .eq("account_id", accountId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(500)));
  return rowsOrError(reads);
}

const OUTCOME_KINDS = [
  "position_opened",
  "position_remainder_opened",
  "position_booked",
  "reconciliation_unresolved",
  "reconciliation_estimated",
  "manual_reason_tagged",
] as const;

async function readOutcomes(since: string): Promise<QueryResult> {
  const sb = getSupabase();
  const reads = await Promise.all(OUTCOME_KINDS.map((eventKind) => sb.from("position_outcome_events")
    .select("id,event_kind,event_at,position_id,opportunity_id,quantity,exit_price,realized_pnl,close_reason")
    .eq("event_kind", eventKind).gte("event_at", since)
    .order("event_at", { ascending: false }).limit(150)));
  return rowsOrError(reads);
}

async function readBrokerReceipt(token: string): Promise<QueryResult> {
  try {
    const response = await fetch("/api/broker-reconciliation", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
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
  return {
    state: "ok",
    rows: (settled.value.data ?? []) as T[],
    error: "",
    fetchedAtMs: nowMs,
    lastOkAtMs: nowMs,
    summary: settled.value.summary,
  };
}

function expireInitialLoads(previous: OpsEvidence, nowMs: number): OpsEvidence {
  const expire = <T,>(read: OpsEvidenceRead<T>): OpsEvidenceRead<T> => read.state === "loading"
    ? { ...read, state: "error", error: "OPS evidence read timed out", fetchedAtMs: nowMs }
    : read;
  return {
    execution: expire(previous.execution),
    managers: expire(previous.managers),
    captures: expire(previous.captures),
    captureHealth: expire(previous.captureHealth),
    publisher: expire(previous.publisher),
    outcomes: expire(previous.outcomes),
    broker: expire(previous.broker),
  };
}

/**
 * One compact, operator-scoped evidence poll for the Ops workspace. The
 * research tables remain RLS protected and the broker comparison is served by
 * an operator-authenticated, read-only route; unauthenticated reads surface as
 * independent errors and never become fabricated empty ledgers. Leaves receive
 * this result through SurfaceProps and do not subscribe on their own.
 */
export function useOpsEvidence(pollMs = 120_000, enabled = true, accountIds: string[] = []): OpsEvidence {
  const [state, setState] = useState<OpsEvidence>(INITIAL);
  const accountScope = [...accountIds].sort().join(",");

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
      const scopedAccounts = accountScope ? accountScope.split(",") : [];
      const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const accessToken = readAccessToken();
      const settle = (key: keyof OpsEvidence, read: PromiseLike<QueryResult>) => {
        void Promise.allSettled([read]).then(([result]) => {
          if (!alive) return;
          setState((previous) => ({
            ...previous,
            [key]: applyRead(previous[key] as OpsEvidenceRead<unknown>, result, Date.now()),
          }) as OpsEvidence);
        });
      };

      // Each ledger owns its own state transition. A slow or failed deep read
      // must not leave broker reconciliation and every unrelated evidence gate
      // stuck in a shared CHECKING state.
      settle("execution", accessToken.then((token) => readExecutions(scopedAccounts, token)));
      settle("managers", readManagers(scopedAccounts, since));
      settle("captures", sb.from("held_contract_capture_receipts")
        .select("id,position_id,channel_slug,occ_symbol,session_date_et,sample_count,successful_quote_count,dropped_samples,completed_at")
        .eq("session_date_et", todayEt).order("completed_at", { ascending: false }).limit(1_000));
      settle("captureHealth", sb.from("held_contract_capture_health")
        .select("id,observed_at,severity,code,position_id,affected_samples")
        .gte("observed_at", since).order("observed_at", { ascending: false }).limit(50));
      settle("publisher", sb.from("events").select("id,message,created_at")
        .ilike("message", "%shadow-publish:%").gte("created_at", since)
        .order("created_at", { ascending: false }).limit(12));
      settle("outcomes", readOutcomes(since));
      settle("broker", accessToken.then((token) => readBrokerReceipt(token)));
    };
    void poll();
    const stop = startVisibilityPoll(() => void poll(), pollMs);
    return () => { alive = false; stop(); };
  }, [accountScope, enabled, pollMs]);

  // Browser auth/session libraries can occasionally fail to resolve even when
  // their underlying network request has its own timeout. This watchdog is a
  // separate effect from the poll itself so even a synchronous setup failure
  // cannot leave the operator surface neutral forever.
  useEffect(() => {
    if (!enabled) return;
    const watchdog = setTimeout(() => {
      setState((previous) => expireInitialLoads(previous, Date.now()));
    }, 15_000);
    return () => clearTimeout(watchdog);
  }, [accountScope, enabled]);

  return state;
}
