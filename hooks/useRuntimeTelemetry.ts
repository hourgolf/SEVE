"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Read, WorkerRunsInput } from "@/lib/incident/deriveIncident";
import { applyOpsRead, applyWorkerRuns, type Settled } from "@/lib/incident/readModel";
import { startVisibilityPoll } from "@/lib/pollControl";
import type { OpsStatus } from "@/hooks/useOpsStatus";

const initRead = <T,>(): Read<T> => ({
  state: "loading", value: null, atMs: null, lastSeenAtMs: null,
  missingSinceMs: null, fetchedAtMs: 0,
});

const INITIAL_WORKER: WorkerRunsInput = {
  query: { state: "loading", fetchedAtMs: 0 },
  rowsIn16h: 0, hasOpenRun: false, currentHeartbeatAtMs: null,
  latestObservedAtMs: null, abrupt16h: 0, boots16h: 0,
  unstable: false, currentPhase: null,
};

interface RuntimeState {
  heartbeat: Read<{ note: string | null }>;
  cron: Read<Record<string, never>>;
  assignment: Read<{ streamArmed: number; cronArmed: number }>;
  lastArmed: { streamArmed: number; cronArmed: number };
  workerRuns: WorkerRunsInput;
}

const INITIAL: RuntimeState = {
  heartbeat: initRead(), cron: initRead(), assignment: initRead(),
  lastArmed: { streamArmed: 0, cronArmed: 0 },
  workerRuns: INITIAL_WORKER,
};

interface RuntimeSummary {
  worker?: unknown;
  heartbeat?: unknown;
  cron?: unknown;
  assignment?: unknown;
}

interface RuntimeErrors {
  worker?: string | null;
  heartbeat?: string | null;
  cron?: string | null;
  assignment?: string | null;
}

const fulfilled = (data: unknown, error?: string | null): Settled<{ data: unknown; error: unknown }> => ({
  status: "fulfilled",
  value: { data, error: error ? new Error(error) : null },
});

async function readRuntimeSummary(): Promise<{ data: RuntimeSummary; errors: RuntimeErrors }> {
  const { data: { session }, error: sessionError } = await getSupabase().auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error("operator sign-in required");
  const response = await fetch("/api/ops-runtime-telemetry?scope=summary", {
    headers: { authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean; data?: RuntimeSummary; errors?: RuntimeErrors; error?: string;
  };
  if (!response.ok || !body.ok || !body.data) {
    throw new Error(body.error ?? `runtime telemetry failed (${response.status})`);
  }
  return { data: body.data, errors: body.errors ?? {} };
}

/** One authenticated response and one React state update carry process,
 * heartbeat, cron and assignment telemetry. Per-source read health remains
 * independent so a partial server read never fabricates a healthy zero. */
export function useRuntimeTelemetry(pollMs = 30_000): { ops: OpsStatus; workerRuns: WorkerRunsInput } {
  const [state, setState] = useState<RuntimeState>(INITIAL);

  useEffect(() => {
    let alive = true;
    async function poll() {
      const now = Date.now();
      try {
        const summary = await readRuntimeSummary();
        if (!alive) return;
        setState((previous) => {
          const heartbeat = applyOpsRead(previous.heartbeat, fulfilled(summary.data.heartbeat, summary.errors.heartbeat), (data) => {
            const row = data as { beat_at?: string; note?: string | null };
            return { value: { note: row.note ?? null }, atMs: row.beat_at ? Date.parse(row.beat_at) : null };
          }, now);
          const cron = applyOpsRead(previous.cron, fulfilled(summary.data.cron, summary.errors.cron), (data) => {
            const row = data as { captured_at?: string };
            return { value: {}, atMs: row.captured_at ? Date.parse(row.captured_at) : null };
          }, now);
          const assignment = applyOpsRead(previous.assignment, fulfilled(summary.data.assignment, summary.errors.assignment), (data) => {
            const row = data as { streamArmed?: number; cronArmed?: number };
            return { value: { streamArmed: Number(row.streamArmed ?? 0), cronArmed: Number(row.cronArmed ?? 0) }, atMs: now };
          }, now);
          const lastArmed = assignment.state === "ok" && assignment.value
            ? assignment.value
            : previous.lastArmed;
          const workerRuns = applyWorkerRuns(previous.workerRuns, fulfilled(summary.data.worker ?? [], summary.errors.worker), now);
          return { heartbeat, cron, assignment, lastArmed, workerRuns };
        });
      } catch (error) {
        if (!alive) return;
        const rejected: Settled<{ data: unknown; error: unknown }> = { status: "rejected", reason: error };
        setState((previous) => ({
          ...previous,
          heartbeat: applyOpsRead(previous.heartbeat, rejected, () => ({ value: { note: null }, atMs: null }), now),
          cron: applyOpsRead(previous.cron, rejected, () => ({ value: {}, atMs: null }), now),
          assignment: applyOpsRead(previous.assignment, rejected, () => ({ value: previous.lastArmed, atMs: null }), now),
          workerRuns: applyWorkerRuns(previous.workerRuns, rejected, now),
        }));
      }
    }
    void poll();
    const stop = startVisibilityPoll(() => void poll(), pollMs);
    return () => { alive = false; stop(); };
  }, [pollMs]);

  const now = Date.now();
  const ageOf = (read: Read<unknown>) => read.state === "ok" && read.atMs != null
    ? Math.max(0, Math.round((now - read.atMs) / 1000))
    : null;
  const loaded = state.heartbeat.state !== "loading"
    && state.cron.state !== "loading"
    && state.assignment.state !== "loading";
  const armed = state.assignment.state === "ok" && state.assignment.value
    ? state.assignment.value
    : state.lastArmed;
  return {
    ops: {
      loaded,
      heartbeat: state.heartbeat,
      cron: state.cron,
      assignment: state.assignment,
      hbAgeSec: ageOf(state.heartbeat),
      hbNote: state.heartbeat.value?.note ?? null,
      cronAgeSec: ageOf(state.cron),
      streamArmed: armed.streamArmed,
      cronArmed: armed.cronArmed,
    },
    workerRuns: state.workerRuns,
  };
}
