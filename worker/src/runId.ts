// ============================================================================
//  runId — per-boot instance identity + phase breadcrumb for crash attribution.
//
//  The worker has been crash-restarting (~40 boots/16h, external-review P4). A
//  dying process cannot reliably write its own epitaph — OOM/SIGKILL/container
//  eviction bypass every handler. So termination is attributed the RELIABLE way
//  (store.openRun): each boot opens a worker_runs row and closes any prior
//  un-ended run as `abrupt_or_unknown`. Then:
//    · the gap between a run's last_heartbeat_at and the next boot localizes the death;
//    · rising memory_rss_mb across a run's heartbeats fingerprints an OOM;
//    · two runs with overlapping [started_at, last_heartbeat_at] prove deploy-overlap
//      (the unfenced-concurrency window P3/P4 flagged).
//  This module is PURE identity — no DB, no throw. The writes live in store.ts.
// ============================================================================
import os from "node:os";
import { randomUUID } from "node:crypto";

export const BOOT_ID = randomUUID();
export const PID = process.pid;
export const HOSTNAME = os.hostname();
// Railway injects these per deploy/replica; fall back to hostname:pid so it's never empty.
export const RAILWAY_DEPLOYMENT = process.env.RAILWAY_DEPLOYMENT_ID ?? null;
export const GIT_SHA = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? null;
export const INSTANCE_ID =
  process.env.RAILWAY_REPLICA_ID ?? RAILWAY_DEPLOYMENT ?? `${HOSTNAME}:${PID}`;

// Coarse last-phase breadcrumb (boot | cycle | sweep | pre-open | shutdown). Updated
// cheaply from the heartbeat note; a crash capsule then reads "died in <phase>".
let _phase = "boot";
export function setPhase(p: string): void { _phase = p; }
export function getPhase(): string { return _phase; }

export function rssMb(): number | null {
  try { return Math.round(process.memoryUsage().rss / 1_048_576); }
  catch { return null; }
}
