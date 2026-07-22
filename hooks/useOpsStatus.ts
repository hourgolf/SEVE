"use client";

// Ops status (P5 slice 3 — tri-state, rejection-safe, independent reads). Three signals, each a tri-state
// `Read` (ok/missing/error) via the pure applyOpsRead reducer: it inspects the Supabase result's `.error`
// AND handles a rejected network promise — a rejection transitions only THAT read to 'error'; the other
// (successful) reads still update; no unhandled rejection (Promise.allSettled never rejects). NEVER turns
// an assignment failure into zero armed channels. Backward-compat getters (hbAgeSec/streamArmed/…) kept
// for the legacy Shell/OpsPreflight/DeskShell. `loaded` = ALL THREE reads finished their first attempt.
//   · STREAM — worker_heartbeat('stream').beat_at (RTH-gated dead-man)
//   · CRON   — desk-total equity_snapshots.captured_at (cron writes one per RTH run)
//   · SPLIT  — armed channels per engine
// 15s anon-read poll; all three have anon SELECT policies. No new subscription layer.

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Read, OpsInputs } from "@/lib/incident/deriveIncident";
import { applyOpsRead, type Settled } from "@/lib/incident/readModel";
import { startVisibilityPoll } from "@/lib/pollControl";

export interface OpsStatus extends OpsInputs {
  hbAgeSec: number | null;
  hbNote: string | null;
  cronAgeSec: number | null;
  streamArmed: number;
  cronArmed: number;
}

const initRead = <T,>(): Read<T> => ({ state: "loading", value: null, atMs: null, lastSeenAtMs: null, missingSinceMs: null, fetchedAtMs: 0 });
// Incident policy considers an Ops observation stale after 60 seconds. Keep
// slower metadata reads inside that contract with 15 seconds of scheduling
// margin while still avoiding the heartbeat's 15-second transfer cadence.
const OPS_METADATA_POLL_MS = 45_000;
const settled = <T,>(p: PromiseSettledResult<T>): Settled<T> =>
  p.status === "fulfilled" ? { status: "fulfilled", value: p.value } : { status: "rejected", reason: p.reason };

export function useOpsStatus(pollMs = 15_000): OpsStatus {
  const reads = useRef({ heartbeat: initRead<{ note: string | null }>(), cron: initRead<Record<string, never>>(), assignment: initRead<{ streamArmed: number; cronArmed: number }>() });
  const lastArmed = useRef({ streamArmed: 0, cronArmed: 0 });
  const [, setTick] = useState(0);

  useEffect(() => {
    const sb = getSupabase();
    let alive = true;
    const commit = () => { if (alive) setTick((n) => n + 1); };

    async function pollHeartbeat() {
      const now = Date.now();
      const [hb] = await Promise.allSettled([
        sb.from("worker_heartbeat").select("beat_at,note").eq("id", "stream").maybeSingle(),
      ]);
      if (!alive) return;
      reads.current.heartbeat = applyOpsRead(reads.current.heartbeat, settled(hb) as Settled<{ data: unknown; error: unknown }>, (d) => {
        const r = d as { beat_at?: string; note?: string | null };
        return { value: { note: r.note ?? null }, atMs: r.beat_at ? Date.parse(r.beat_at) : null };
      }, now);
      commit();
    }

    async function pollCron() {
      const now = Date.now();
      const [snap] = await Promise.allSettled([
        sb.from("equity_snapshots").select("captured_at").is("strategist_id", null).is("account_id", null).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!alive) return;
      reads.current.cron = applyOpsRead(reads.current.cron, settled(snap) as Settled<{ data: unknown; error: unknown }>, (d) => {
        const r = d as { captured_at?: string };
        return { value: {}, atMs: r.captured_at ? Date.parse(r.captured_at) : null };
      }, now);
      commit();
    }

    async function pollAssignment() {
      const now = Date.now();
      const [strat] = await Promise.allSettled([
        sb.from("strategists").select("executor,status"),
      ]);
      if (!alive) return;
      // strat.data is an ARRAY (empty = valid empty roster, 'ok' with zero armed). A rejected/errored read
      // → 'error' and the last-known counts are held below — NEVER fabricate zeros from a failure.
      reads.current.assignment = applyOpsRead(reads.current.assignment, settled(strat) as Settled<{ data: unknown; error: unknown }>, (d) => {
        let s = 0, c = 0;
        for (const r of d as Array<{ executor?: string; status?: string }>) {
          if ((r.status ?? "armed") !== "armed") continue;
          if (r.executor === "stream") s++; else c++;
        }
        return { value: { streamArmed: s, cronArmed: c }, atMs: now };
      }, now);
      if (reads.current.assignment.state === "ok" && reads.current.assignment.value) lastArmed.current = reads.current.assignment.value;
      commit();
    }

    // The three observability inputs have materially different source clocks.
    // Keep the RTH heartbeat fast, but do not transfer the full channel roster
    // at that cadence. All three pause in hidden/backgrounded tabs.
    void pollHeartbeat();
    void pollCron();
    void pollAssignment();
    const stopHeartbeat = startVisibilityPoll(() => void pollHeartbeat(), pollMs);
    const stopCron = startVisibilityPoll(() => void pollCron(), OPS_METADATA_POLL_MS);
    const stopAssignment = startVisibilityPoll(() => void pollAssignment(), OPS_METADATA_POLL_MS);
    return () => {
      alive = false;
      stopHeartbeat();
      stopCron();
      stopAssignment();
    };
  }, [pollMs]);

  const r = reads.current;
  const now = Date.now();
  const ageOf = (rd: Read<unknown>) => (rd.state === "ok" && rd.atMs != null ? Math.max(0, Math.round((now - rd.atMs) / 1000)) : null);
  // loaded = all three reads have finished their FIRST attempt (none still 'loading').
  const loaded = r.heartbeat.state !== "loading" && r.cron.state !== "loading" && r.assignment.state !== "loading";
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
