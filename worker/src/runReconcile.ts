// Pure worker-run attribution policy. A stale predecessor from the SAME Railway
// deployment is a crash/restart; a stale predecessor from a DIFFERENT deployment
// whose final beat overlaps the successor boot is a normal deploy handoff.

export type PriorRunTermination = "superseded_deploy" | "abrupt_or_unknown";

export interface PriorOpenRun {
  bootId: string;
  railwayDeployment: string | null;
  lastHeartbeatAt: string | null;
}

export interface CurrentRunIdentity {
  bootId: string;
  railwayDeployment: string | null;
  startedAt: string;
}

export interface RunReconcileThresholds {
  staleMs: number;
  deployOverlapMs: number;
}

export const RUN_RECONCILE_THRESHOLDS: RunReconcileThresholds = {
  staleMs: 120_000,
  deployOverlapMs: 5 * 60_000,
};

export function classifyPriorOpenRun(
  prior: PriorOpenRun,
  current: CurrentRunIdentity,
  nowMs: number,
  thresholds: RunReconcileThresholds = RUN_RECONCILE_THRESHOLDS,
): PriorRunTermination | null {
  if (prior.bootId === current.bootId) return null;
  const lastBeatMs = prior.lastHeartbeatAt ? Date.parse(prior.lastHeartbeatAt) : NaN;
  const currentStartMs = Date.parse(current.startedAt);
  if (!Number.isFinite(lastBeatMs) || !Number.isFinite(currentStartMs)) return null;
  if (nowMs - lastBeatMs <= thresholds.staleMs) return null;

  const distinctDeployments = !!prior.railwayDeployment && !!current.railwayDeployment
    && prior.railwayDeployment !== current.railwayDeployment;
  const overlapsDeployWindow = Math.abs(currentStartMs - lastBeatMs) <= thresholds.deployOverlapMs;
  return distinctDeployments && overlapsDeployWindow ? "superseded_deploy" : "abrupt_or_unknown";
}
