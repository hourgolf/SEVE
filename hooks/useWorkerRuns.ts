"use client";

// hooks/useWorkerRuns.ts — reads the worker_runs crash-attribution ledger (67_worker_runs.sql) for
// the incident banner + system-health panel (external-review P5). THE binding distinction (P4): count
// ABRUPT terminations, NOT raw boots — most boots are graceful redeploys (SIGTERM), not crashes, so a
// banner keyed on boot count would false-alarm on every deploy. `unstable` is driven by abrupt16h only.
//
// Data seam: this is a once-per-page read hook (call it in page.tsx, pass the result through
// SurfaceProps) — leaf components stay subscription-free. 60s anon poll (worker_runs has anon SELECT).

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

export interface WorkerRun {
  boot_id: string;
  version: string;
  started_at: string;
  last_heartbeat_at: string | null;
  ended_at: string | null;
  /** graceful_sigterm | uncaught_exception | fatal_boot | abrupt_or_unknown | null (still running) */
  termination_kind: string | null;
  exit_code: number | null;
  signal: string | null;
  last_phase: string | null;
  memory_rss_mb: number | null;
}

export interface WorkerRuns {
  loaded: boolean;
  /** the live run — the open (ended_at null) row with the freshest heartbeat */
  current: WorkerRun | null;
  /** newest-first, capped — for the system-health / incident detail */
  recent: WorkerRun[];
  /** total boots in the last 16h (mostly redeploys — do NOT surface this as "instability") */
  boots16h: number;
  /** termination_kind='abrupt_or_unknown' in 16h — the REAL crash signal */
  abrupt16h: number;
  /** current run uptime, seconds */
  uptimeSec: number | null;
  /** seconds since the current run's last heartbeat — >~120 ⇒ the worker may be down right now */
  heartbeatAgeSec: number | null;
  /** abrupt16h ≥ threshold — the banner's "WORKER UNSTABLE" gate (redeploys excluded) */
  unstable: boolean;
  status: "loading" | "ok" | "empty" | "error";
}

const UNSTABLE_THRESHOLD = 3; // ≥3 ABRUPT terminations / 16h = unstable (graceful redeploys don't count)
const WINDOW_MS = 16 * 3600_000;

const INITIAL: WorkerRuns = {
  loaded: false, current: null, recent: [], boots16h: 0, abrupt16h: 0,
  uptimeSec: null, heartbeatAgeSec: null, unstable: false, status: "loading",
};

export function useWorkerRuns(pollMs = 60_000): WorkerRuns {
  const [s, setS] = useState<WorkerRuns>(INITIAL);

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;

    async function poll() {
      try {
        const since = new Date(Date.now() - WINDOW_MS).toISOString();
        const { data, error } = await sb
          .from("worker_runs")
          .select("boot_id,version,started_at,last_heartbeat_at,ended_at,termination_kind,exit_code,signal,last_phase,memory_rss_mb")
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(60);
        if (!alive) return;
        if (error) { setS((p) => ({ ...p, loaded: true, status: "error" })); return; }
        const rows = (data ?? []) as WorkerRun[];
        if (!rows.length) { setS({ ...INITIAL, loaded: true, status: "empty" }); return; }

        // current = the still-open run with the freshest heartbeat (a crashed-not-yet-rebooted worker
        // shows as open with a STALE heartbeat → heartbeatAgeSec surfaces that to the banner).
        const open = rows.filter((r) => r.ended_at == null);
        const current =
          open.slice().sort((a, b) => (b.last_heartbeat_at ?? "").localeCompare(a.last_heartbeat_at ?? ""))[0] ?? null;
        const abrupt16h = rows.filter((r) => r.termination_kind === "abrupt_or_unknown").length;
        const now = Date.now();
        const uptimeSec = current ? Math.max(0, Math.round((now - Date.parse(current.started_at)) / 1000)) : null;
        const heartbeatAgeSec = current?.last_heartbeat_at
          ? Math.max(0, Math.round((now - Date.parse(current.last_heartbeat_at)) / 1000))
          : null;

        setS({
          loaded: true,
          current,
          recent: rows.slice(0, 12),
          boots16h: rows.length,
          abrupt16h,
          uptimeSec,
          heartbeatAgeSec,
          unstable: abrupt16h >= UNSTABLE_THRESHOLD,
          status: "ok",
        });
      } catch {
        if (alive) setS((p) => ({ ...p, loaded: true, status: "error" }));
      }
    }

    poll();
    const id = setInterval(poll, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);

  return s;
}
