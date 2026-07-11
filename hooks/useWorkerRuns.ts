"use client";

// useWorkerRuns (P5 slice 3) — reads the worker_runs crash-attribution ledger (67_worker_runs.sql) and
// exposes it in the shape the pure deriveIncident consumes. KEY separations (policy §P.2): the QUERY health
// (loading/ok/error + when it last succeeded) is distinct from RUN PRESENCE (rows in 16h / an open current
// run / the freshest observed evidence). instability keys on ABRUPT terminations, never boots. The 60s
// cadence uses a 150s query-freshness policy in deriveIncident (not 60 — that would false-alarm on jitter).
// 60s anon poll; worker_runs has an anon SELECT grant. Raw timestamps (epoch ms) — deriveIncident computes
// ages from nowMs so a stuck poll can't present a frozen "fresh" age.

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { WorkerRunsInput } from "@/lib/incident/deriveIncident";

const WINDOW_MS = 16 * 3600_000;

const INITIAL: WorkerRunsInput = {
  query: { state: "loading", fetchedAtMs: 0 },
  rowsIn16h: 0, currentHeartbeatAtMs: null, latestObservedAtMs: null,
  abrupt16h: 0, boots16h: 0, unstable: false, currentPhase: null,
};

interface Row {
  started_at: string; last_heartbeat_at: string | null; ended_at: string | null;
  termination_kind: string | null; last_phase: string | null;
}

export function useWorkerRuns(pollMs = 60_000): WorkerRunsInput {
  const view = useRef<WorkerRunsInput>(INITIAL);
  const [, setTick] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;
    async function poll() {
      const now = Date.now();
      const since = new Date(now - WINDOW_MS).toISOString();
      const { data, error } = await sb
        .from("worker_runs")
        .select("started_at,last_heartbeat_at,ended_at,termination_kind,last_phase")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(60);
      if (!alive) return;
      if (error) {
        view.current = { ...view.current, query: { state: "error", fetchedAtMs: now } };
        setTick((n) => n + 1);
        return;
      }
      const rows = (data ?? []) as Row[];
      const ms = (s: string | null) => (s ? Date.parse(s) : null);
      // current = the open run (ended_at null) with the freshest heartbeat
      const open = rows.filter((r) => r.ended_at == null)
        .sort((a, b) => (b.last_heartbeat_at ?? "").localeCompare(a.last_heartbeat_at ?? ""));
      const current = open[0] ?? null;
      // latest observed evidence = the freshest last_heartbeat_at OR ended_at across all recent rows
      let latestObservedAtMs: number | null = null;
      for (const r of rows) {
        for (const cand of [ms(r.last_heartbeat_at), ms(r.ended_at)]) {
          if (cand != null && (latestObservedAtMs == null || cand > latestObservedAtMs)) latestObservedAtMs = cand;
        }
      }
      const abrupt16h = rows.filter((r) => r.termination_kind === "abrupt_or_unknown").length;
      view.current = {
        query: { state: "ok", fetchedAtMs: now },
        rowsIn16h: rows.length,
        currentHeartbeatAtMs: current ? ms(current.last_heartbeat_at) : null,
        latestObservedAtMs,
        abrupt16h,
        boots16h: rows.length,
        unstable: abrupt16h >= 3,
        currentPhase: current?.last_phase ?? null,
      };
      setTick((n) => n + 1);
    }
    void poll();
    const id = setInterval(() => void poll(), pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);

  return view.current;
}
