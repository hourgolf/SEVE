import { DEFAULT_THRESHOLDS, type WorkerRunsInput } from "@/lib/incident/deriveIncident";
import type { ReadinessItem } from "@/lib/ops/readiness";

export type WorkstationTelemetryTone = "green" | "amber" | "red" | "dim";

export interface WorkstationTelemetryStatus {
  label: string;
  tone: WorkstationTelemetryTone;
  detail: string;
}

/** A glanceable process claim derived from the same raw timestamps and
 * freshness thresholds as the incident policy. A historical heartbeat must
 * never keep the header's DATA lamp green after the read or process is stale. */
export function deriveProcessTelemetry(
  workerRuns: WorkerRunsInput,
  nowMs: number,
): WorkstationTelemetryStatus {
  if (!Number.isFinite(nowMs) || nowMs <= 0) {
    return { label: "CHECK", tone: "dim", detail: "process clock is initializing" };
  }
  const readAgeSec = workerRuns.query.fetchedAtMs > 0
    ? Math.max(0, (nowMs - workerRuns.query.fetchedAtMs) / 1000)
    : Number.POSITIVE_INFINITY;
  const readFresh = workerRuns.query.state === "ok"
    && readAgeSec <= DEFAULT_THRESHOLDS.workerRunsReadStaleSec;

  if (workerRuns.query.state === "loading") {
    return { label: "CHECK", tone: "dim", detail: "worker run ledger is loading" };
  }
  if (workerRuns.query.state === "error" || !readFresh) {
    return { label: "CHECK", tone: "amber", detail: workerRuns.query.state === "error" ? "worker run ledger read failed" : "worker run ledger read is stale" };
  }
  if (workerRuns.currentHeartbeatAtMs == null) {
    return { label: "MISSING", tone: "amber", detail: "no current process heartbeat is observed" };
  }

  const processAgeSec = Math.max(0, (nowMs - workerRuns.currentHeartbeatAtMs) / 1000);
  if (processAgeSec > DEFAULT_THRESHOLDS.runProcessStaleSec) {
    return { label: "STALE", tone: "amber", detail: `process heartbeat last observed ${Math.round(processAgeSec)}s ago` };
  }
  return { label: "LIVE", tone: "green", detail: `process heartbeat observed ${Math.round(processAgeSec)}s ago` };
}

/** Present the already-derived broker reconciliation evidence without
 * inventing a second reconciliation policy in the shell. */
export function deriveBrokerTelemetry(item?: ReadinessItem): WorkstationTelemetryStatus {
  if (!item) return { label: "CHECK", tone: "dim", detail: "broker reconciliation is loading" };
  if (item.tone === "red") return { label: item.state === "DRIFT" ? "DRIFT" : "ERROR", tone: "red", detail: item.detail };
  if (item.tone === "yellow") return { label: item.state === "PARTIAL" ? "PARTIAL" : "CHECK", tone: "amber", detail: item.detail };
  if (item.tone === "green") {
    return {
      label: item.state === "BROKER + DESK FLAT" ? "FLAT" : "MATCH",
      tone: "green",
      detail: item.detail,
    };
  }
  return { label: "CHECK", tone: "dim", detail: item.detail };
}
