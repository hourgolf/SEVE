"use client";

// useWorkerRuns (P5 slice 3 — reject-safe). Reads the worker_runs crash-attribution ledger
// (67_worker_runs.sql) into the shape deriveIncident consumes, via the pure applyWorkerRuns reducer:
// query health (loading/ok/error) is separate from run presence (starts/terminations in 16h, plus any
// open current run / latest-observed evidence). A rejected query promise → query.state='error' (prior observations preserved
// as unused historical evidence); allSettled means no unhandled rejection and no indefinite loading.
// instability keys on ABRUPT terminations, never boots. Raw epoch-ms timestamps — deriveIncident computes
// ages from nowMs so a stuck poll can't present a frozen "fresh" age. 60s anon poll; 150s freshness policy.

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { WorkerRunsInput } from "@/lib/incident/deriveIncident";
import { applyWorkerRuns, type Settled } from "@/lib/incident/readModel";
import { startVisibilityPoll } from "@/lib/pollControl";

const INITIAL: WorkerRunsInput = {
  query: { state: "loading", fetchedAtMs: 0 },
  rowsIn16h: 0, hasOpenRun: false, currentHeartbeatAtMs: null, latestObservedAtMs: null,
  abrupt16h: 0, boots16h: 0, unstable: false, currentPhase: null,
};

async function readWorkerRuns(): Promise<{ data: unknown; error: unknown }> {
  try {
    const { data: { session }, error: sessionError } = await getSupabase().auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.access_token) throw new Error("operator sign-in required");
    const response = await fetch("/api/ops-runtime-telemetry?scope=worker", {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; data?: unknown; error?: string };
    if (!response.ok || !body.ok) return { data: null, error: new Error(body.error ?? `worker ledger failed (${response.status})`) };
    return { data: body.data ?? [], error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export function useWorkerRuns(pollMs = 60_000): WorkerRunsInput {
  const view = useRef<WorkerRunsInput>(INITIAL);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    async function poll() {
      const now = Date.now();
      const [res] = await Promise.allSettled([
        readWorkerRuns(),
      ]);
      if (!alive) return;
      view.current = applyWorkerRuns(view.current, res as Settled<{ data: unknown; error: unknown }>, now);
      setTick((n) => n + 1);
    }
    void poll();
    const stop = startVisibilityPoll(() => void poll(), pollMs);
    return () => { alive = false; stop(); };
  }, [pollMs]);

  return view.current;
}
