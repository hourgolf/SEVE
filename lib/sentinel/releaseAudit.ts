import type {
  OperationalReleaseContract,
  ReleaseReceiptObservation,
  WorkerObservation,
} from "../ops/preopenReadinessEngine.js";
import type { SentinelEvidenceState } from "./operatorPacket.js";

export interface SentinelReleaseAudit {
  state: SentinelEvidenceState;
  asOf: string | null;
  detail: string;
  releaseId: string | null;
  configurationSha256: string | null;
}

export interface SentinelReleaseAuditInput {
  contract: OperationalReleaseContract;
  receipt: ReleaseReceiptObservation | null;
  workers: readonly WorkerObservation[];
  nowMs: number;
  workerFreshMs: number;
}

const SHA256 = /^[a-f0-9]{64}$/;
const time = (value: string | null): number =>
  value == null ? Number.NaN : Date.parse(value);

export function auditSentinelRelease(input: SentinelReleaseAuditInput): SentinelReleaseAudit {
  const { contract, receipt } = input;
  const observed = {
    asOf: receipt?.createdAt ?? null,
    releaseId: receipt?.releaseId ?? null,
    configurationSha256: receipt?.configurationSha256 ?? null,
  };
  if (!contract.adapterId.trim()
      || !contract.releaseId.trim()
      || !SHA256.test(contract.configurationSha256)
      || !contract.strategyWorkerVersion.trim()
      || !contract.runtimeVersion.trim()) {
    return {
      state: "conflict",
      detail: "operational release contract identity is invalid",
      ...observed,
    };
  }
  if (!receipt) {
    return {
      state: "missing",
      detail: `startup receipt is missing for ${contract.releaseId}`,
      ...observed,
    };
  }
  if (!receipt.releaseId.trim()
      || !SHA256.test(receipt.configurationSha256)
      || !receipt.strategyWorkerVersion?.trim()
      || !Number.isFinite(time(receipt.createdAt))) {
    return {
      state: "partial",
      detail: "startup receipt lacks a complete release, configuration, strategy-worker, or timestamp identity",
      ...observed,
    };
  }

  const receiptConflicts: string[] = [];
  if (receipt.releaseId !== contract.releaseId) receiptConflicts.push("release");
  if (receipt.configurationSha256 !== contract.configurationSha256) receiptConflicts.push("configuration");
  if (receipt.strategyWorkerVersion !== contract.strategyWorkerVersion) receiptConflicts.push("strategy-worker");
  if (receiptConflicts.length) {
    return {
      state: "conflict",
      detail: `startup receipt conflicts with the operational contract: ${receiptConflicts.join(", ")}`,
      ...observed,
    };
  }

  const freshWorkers = input.workers.filter((worker) => {
    const heartbeatAt = time(worker.heartbeatAt);
    const ageMs = input.nowMs - heartbeatAt;
    return Number.isFinite(heartbeatAt) && ageMs >= 0 && ageMs <= input.workerFreshMs;
  });
  if (freshWorkers.length === 0) {
    return {
      state: "stale",
      detail: "no fresh current worker is available to bind the startup receipt",
      ...observed,
    };
  }
  if (freshWorkers.length !== 1) {
    return {
      state: "conflict",
      detail: `expected one fresh current worker, observed ${freshWorkers.length}`,
      ...observed,
    };
  }

  const worker = freshWorkers[0];
  if (worker.runtimeVersion !== contract.runtimeVersion || worker.lastError != null) {
    return {
      state: "conflict",
      detail: `current worker conflicts with the operational contract: runtime=${worker.runtimeVersion ?? "missing"} error=${worker.lastError ?? "none"}`,
      ...observed,
    };
  }
  const workerStart = time(worker.startedAt);
  if (!Number.isFinite(workerStart)) {
    return {
      state: "partial",
      detail: "current worker start identity is incomplete",
      ...observed,
    };
  }
  if (time(receipt.createdAt) < workerStart) {
    return {
      state: "stale",
      detail: "matching startup receipt predates the current worker start",
      ...observed,
    };
  }

  return {
    state: "ok",
    detail: `sealed ${contract.releaseId} receipt matches ${contract.adapterId} and current worker ${contract.runtimeVersion}`,
    ...observed,
  };
}
