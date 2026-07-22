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

const WINDOW_MS = 16 * 3600_000;
const INITIAL: WorkerRunsInput = {
  query: { state: "loading", fetchedAtMs: 0 },
  rowsIn16h: 0, hasOpenRun: false, currentHeartbeatAtMs: null, latestObservedAtMs: null,
  abrupt16h: 0, boots16h: 0, unstable: false, currentPhase: null,
};

export function useWorkerRuns(pollMs = 60_000): WorkerRunsInput {
  const view = useRef<WorkerRunsInput>(INITIAL);
  const [, setTick] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;
    async function poll() {
      const now = Date.now();
      const since = new Date(now - WINDOW_MS).toISOString();
      const [res] = await Promise.allSettled([
        sb.from("worker_runs")
          .select("started_at,last_heartbeat_at,ended_at,termination_kind,last_phase")
          // A healthy process can run longer than the 16h incident window. Always include an open run,
          // and include historical rows by either start OR end so a late abrupt termination is counted.
          .or(`started_at.gte.${since},ended_at.gte.${since},ended_at.is.null`)
          .order("last_heartbeat_at", { ascending: false, nullsFirst: false })
          .limit(200),
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
