"use client";

// Ops status (P5 slice 3 — tri-state observability refactor). Reads three independent signals, each as a
// tri-state `Read` (ok/missing/error) that inspects the Supabase result's `.error` (not just try/catch),
// preserves missing-state grace (`missingSinceMs`), and NEVER turns an assignment-read failure into zero
// armed channels. Fed to the pure deriveIncident at the page seam. Backward-compat convenience getters
// (hbAgeSec/cronAgeSec/streamArmed/cronArmed/hbNote) are kept for the legacy Shell/OpsPreflight/DeskShell.
//   · STREAM liveness  — worker_heartbeat('stream').beat_at (RTH-gated dead-man)
//   · CRON liveness    — desk-total equity_snapshots.captured_at (the cron writes one per RTH run)
//   · executor split   — armed channels per engine
// 15s anon-read poll; all three have anon SELECT policies. No new subscription layer.

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Read, OpsInputs } from "@/lib/incident/deriveIncident";

export interface OpsStatus extends OpsInputs {
  // legacy derived getters (unchanged shape for existing consumers)
  hbAgeSec: number | null;
  hbNote: string | null;
  cronAgeSec: number | null;
  streamArmed: number;
  cronArmed: number;
}

const initRead = <T,>(): Read<T> => ({ state: "loading", value: null, atMs: null, lastSeenAtMs: null, missingSinceMs: null, fetchedAtMs: 0 });

// prior Read + new query result → next Read (tri-state + missing-grace, per the policy §P rules).
function step<T>(prev: Read<T>, error: unknown, data: unknown, extract: (d: unknown) => { value: T; atMs: number | null }, now: number): Read<T> {
  if (error) return { state: "error", value: prev.value, atMs: prev.atMs, lastSeenAtMs: prev.lastSeenAtMs, missingSinceMs: prev.missingSinceMs, fetchedAtMs: now };
  if (data == null) return { state: "missing", value: null, atMs: null, lastSeenAtMs: prev.lastSeenAtMs, missingSinceMs: prev.missingSinceMs ?? now, fetchedAtMs: now };
  const { value, atMs } = extract(data);
  return { state: "ok", value, atMs, lastSeenAtMs: atMs ?? prev.lastSeenAtMs, missingSinceMs: null, fetchedAtMs: now };
}

export function useOpsStatus(pollMs = 15_000): OpsStatus {
  const reads = useRef({ heartbeat: initRead<{ note: string | null }>(), cron: initRead<Record<string, never>>(), assignment: initRead<{ streamArmed: number; cronArmed: number }>() });
  const lastArmed = useRef({ streamArmed: 0, cronArmed: 0 });
  const [, setTick] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;
    async function poll() {
      const now = Date.now();
      const [hb, snap, strat] = await Promise.all([
        sb.from("worker_heartbeat").select("beat_at,note").eq("id", "stream").maybeSingle(),
        sb.from("equity_snapshots").select("captured_at").is("strategist_id", null).is("account_id", null).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("strategists").select("executor,status"),
      ]);
      if (!alive) return;
      reads.current.heartbeat = step(reads.current.heartbeat, hb.error, hb.data, (d) => {
        const r = d as { beat_at?: string; note?: string | null };
        return { value: { note: r.note ?? null }, atMs: r.beat_at ? Date.parse(r.beat_at) : null };
      }, now);
      reads.current.cron = step(reads.current.cron, snap.error, snap.data, (d) => {
        const r = d as { captured_at?: string };
        return { value: {}, atMs: r.captured_at ? Date.parse(r.captured_at) : null };
      }, now);
      // assignment: strat.data is an ARRAY (possibly empty). error → 'error'; [] is a valid empty roster
      // ('ok', zero armed is real). NEVER fabricate zeros from an error.
      reads.current.assignment = step(reads.current.assignment, strat.error, strat.data ?? null, (d) => {
        let s = 0, c = 0;
        for (const r of d as Array<{ executor?: string; status?: string }>) {
          if ((r.status ?? "armed") !== "armed") continue;
          if (r.executor === "stream") s++; else c++;
        }
        return { value: { streamArmed: s, cronArmed: c }, atMs: now };
      }, now);
      if (reads.current.assignment.state === "ok" && reads.current.assignment.value) lastArmed.current = reads.current.assignment.value;
      setTick((n) => n + 1);
    }
    void poll();
    const id = setInterval(() => void poll(), pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);

  const r = reads.current;
  const now = Date.now();
  const ageOf = (rd: Read<unknown>) => (rd.state === "ok" && rd.atMs != null ? Math.max(0, Math.round((now - rd.atMs) / 1000)) : null);
  const loaded = r.heartbeat.state !== "loading" || r.assignment.state !== "loading";
  // legacy getters: never zero armed on failure — hold the last-known.
  const streamArmed = r.assignment.state === "ok" && r.assignment.value ? r.assignment.value.streamArmed : lastArmed.current.streamArmed;
  const cronArmed = r.assignment.state === "ok" && r.assignment.value ? r.assignment.value.cronArmed : lastArmed.current.cronArmed;

  return {
    loaded,
    heartbeat: r.heartbeat,
    cron: r.cron,
    assignment: r.assignment,
    hbAgeSec: ageOf(r.heartbeat),
    hbNote: r.heartbeat.value?.note ?? null,
    cronAgeSec: ageOf(r.cron),
    streamArmed,
    cronArmed,
  };
}
