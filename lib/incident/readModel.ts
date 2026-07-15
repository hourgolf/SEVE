// readModel — pure reducers that turn a settled Supabase query outcome into the incident tri-state
// Read / WorkerRunsInput (P5 slice 3A). Split out of the hooks so REJECTION handling is unit-testable:
// a rejected promise (status:'rejected') and a fulfilled `{error}` BOTH map to state 'error' and preserve
// prior observations as unused historical evidence — never a health claim, never an unhandled rejection.

import type { Read, WorkerRunsInput } from "./deriveIncident";

export type Settled<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };
type QueryResult = { data: unknown; error: unknown };
const failed = (r: Settled<QueryResult>) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error != null);

/** prior Read + a settled query → next Read (ok/missing/error) with missing-grace. */
export function applyOpsRead<T>(
  prev: Read<T>, res: Settled<QueryResult>, extract: (d: unknown) => { value: T; atMs: number | null }, now: number,
): Read<T> {
  if (failed(res)) return { state: "error", value: prev.value, atMs: prev.atMs, lastSeenAtMs: prev.lastSeenAtMs, missingSinceMs: prev.missingSinceMs, fetchedAtMs: now };
  const data = (res as { value: QueryResult }).value.data;
  if (data == null) return { state: "missing", value: null, atMs: null, lastSeenAtMs: prev.lastSeenAtMs, missingSinceMs: prev.missingSinceMs ?? now, fetchedAtMs: now };
  const { value, atMs } = extract(data);
  return { state: "ok", value, atMs, lastSeenAtMs: atMs ?? prev.lastSeenAtMs, missingSinceMs: null, fetchedAtMs: now };
}

export interface RunRow {
  started_at: string; last_heartbeat_at: string | null; ended_at: string | null;
  termination_kind: string | null; last_phase: string | null;
}

const RUN_WINDOW_MS = 16 * 3600_000;

/** prior WorkerRunsInput + a settled worker_runs query → next view (query health vs run presence). */
export function applyWorkerRuns(prev: WorkerRunsInput, res: Settled<QueryResult>, now: number): WorkerRunsInput {
  if (failed(res)) return { ...prev, query: { state: "error", fetchedAtMs: now } }; // preserve prior observations (unused)
  const rows = ((res as { value: QueryResult }).value.data ?? []) as RunRow[];
  const ms = (s: string | null): number | null => {
    if (!s) return null;
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const since = now - RUN_WINDOW_MS;
  const inWindow = (atMs: number | null) => atMs != null && atMs >= since;
  const open = rows.filter((r) => r.ended_at == null).sort((a, b) =>
    (ms(b.last_heartbeat_at) ?? ms(b.started_at) ?? 0) - (ms(a.last_heartbeat_at) ?? ms(a.started_at) ?? 0));
  const current = open[0] ?? null;
  const recentRows = rows.filter((r) => inWindow(ms(r.started_at)) || inWindow(ms(r.ended_at)));
  let latestObservedAtMs: number | null = null;
  for (const r of rows) for (const cand of [ms(r.last_heartbeat_at), ms(r.ended_at), ms(r.started_at)]) {
    if (cand != null && (latestObservedAtMs == null || cand > latestObservedAtMs)) latestObservedAtMs = cand;
  }
  const abrupt16h = rows.filter((r) => r.termination_kind === "abrupt_or_unknown" && inWindow(ms(r.ended_at))).length;
  const boots16h = rows.filter((r) => inWindow(ms(r.started_at))).length;
  return {
    query: { state: "ok", fetchedAtMs: now },
    rowsIn16h: recentRows.length,
    hasOpenRun: current != null,
    currentHeartbeatAtMs: current ? ms(current.last_heartbeat_at) : null,
    latestObservedAtMs,
    abrupt16h,
    boots16h,
    unstable: abrupt16h >= 3,
    currentPhase: current?.last_phase ?? null,
  };
}
