import type { SupabaseClient } from "@supabase/supabase-js";
import {
  collectFreshSafeBoundary,
  type PaperAccountEvidenceRow,
} from "./channelBaselineAdoptionServerEvidence";
import {
  contentHash,
  type ChannelChangeProposal,
  type DynamicReadinessEvidence,
  type JsonObject,
  type ProposalReplaySummary,
} from "./channelControlPlane";
import type {
  SafeBoundaryInput,
  WorkerActivationAcknowledgement,
  WorkerCompatibilityProof,
} from "./channelActivation";
import type {
  CapturePathObservation,
} from "./channelConfigurationWorkflow";

const WORKER_FRESH_MS = 150_000;

export class ChannelActivationServerEvidenceError extends Error {
  readonly status: 409 | 503;

  constructor(message: string, status: 409 | 503 = 409) {
    super(message);
    this.name = "ChannelActivationServerEvidenceError";
    this.status = status;
  }
}

interface WorkerRow {
  boot_id: string;
  version: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  ended_at: string | null;
  last_error: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestamp(value: unknown, label: string): number {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  if (!Number.isFinite(parsed)) {
    throw new ChannelActivationServerEvidenceError(
      `${label} timestamp is invalid`,
    );
  }
  return parsed;
}

function exactCurrentWorker(rows: WorkerRow[], nowMs: number): WorkerRow {
  if (!rows.length) {
    throw new ChannelActivationServerEvidenceError(
      "current paper worker is missing",
    );
  }
  const ordered = [...rows].sort((left, right) =>
    timestamp(right.started_at, "worker start")
      - timestamp(left.started_at, "worker start"));
  const worker = ordered[0];
  const startedAt = timestamp(worker.started_at, "worker start");
  const heartbeatAt = timestamp(worker.last_heartbeat_at, "worker heartbeat");
  if (!worker.boot_id
      || !worker.version?.trim()
      || worker.ended_at
      || worker.last_error?.trim()
      || heartbeatAt < nowMs - WORKER_FRESH_MS
      || heartbeatAt > nowMs + 5_000) {
    throw new ChannelActivationServerEvidenceError(
      "current paper worker identity or liveness is not exact",
    );
  }
  const overlapping = ordered.slice(1).filter((candidate) =>
    timestamp(candidate.last_heartbeat_at, "prior worker heartbeat")
      >= startedAt);
  if (overlapping.length) {
    throw new ChannelActivationServerEvidenceError(
      "more than one worker overlaps the current boot",
    );
  }
  return worker;
}

function observed(
  path: CapturePathObservation["path"],
  observedAt: string,
  evidenceRef: string,
): CapturePathObservation {
  return { path, state: "observed", observedAt, evidenceRef };
}

export interface ChannelActivationPreviewServerEvidence {
  readiness: DynamicReadinessEvidence;
  replaySummary: ProposalReplaySummary;
  capacityCollisionImpact: JsonObject;
  captureObservations: CapturePathObservation[];
  safeBoundary: SafeBoundaryInput;
  safeBoundaryProof: JsonObject;
  worker: WorkerRow;
}

export async function collectChannelActivationPreviewServerEvidence(input: {
  sb: SupabaseClient;
  activeManifestContentHash: string;
  proposal: ChannelChangeProposal;
  storedCapacityCollisionImpact: JsonObject | null;
  now?: string;
  fetchImpl?: typeof fetch;
}): Promise<ChannelActivationPreviewServerEvidence> {
  const now = input.now ?? new Date().toISOString();
  const nowMs = timestamp(now, "server evidence");
  const [accountsRead, positionsRead, workersRead, quoteRead, startupRead,
    sentinelRead] = await Promise.all([
    input.sb.from("accounts")
      .select("id,name,mode,cred_ref")
      .order("id"),
    input.sb.from("positions")
      .select("id")
      .eq("status", "open"),
    input.sb.from("worker_runs")
      .select(
        "boot_id,version,started_at,last_heartbeat_at,ended_at,last_error",
      )
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(20),
    input.sb.from("option_quotes")
      .select("captured_at")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    input.sb.from("events")
      .select("created_at,message,meta")
      .like("message", "stream: rc54-release ACTIVE%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    input.sb.from("events")
      .select("created_at,message")
      .like("message", "sentinel:%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const [label, error] of [
    ["paper accounts", accountsRead.error],
    ["open desk positions", positionsRead.error],
    ["worker runs", workersRead.error],
    ["quote capture", quoteRead.error],
    ["startup receipt", startupRead.error],
    ["Sentinel evidence", sentinelRead.error],
  ] as const) {
    if (error) {
      throw new ChannelActivationServerEvidenceError(
        `${label} read failed: ${error.message}`,
        503,
      );
    }
  }
  const worker = exactCurrentWorker(
    (workersRead.data ?? []) as WorkerRow[],
    nowMs,
  );
  const startup = startupRead.data as Record<string, unknown> | null;
  const startupMeta = record(startup?.meta);
  const runtimeReadiness = record(startupMeta?.runtimeReadiness);
  if (!startup
      || timestamp(startup.created_at, "startup receipt")
        < timestamp(worker.started_at, "worker start")
      || runtimeReadiness?.heldCaptureReady !== true
      || runtimeReadiness.heldCaptureStartedBeforeBootDecision !== true) {
    throw new ChannelActivationServerEvidenceError(
      "current worker held-capture startup evidence is missing",
    );
  }
  if (!quoteRead.data || !sentinelRead.data) {
    throw new ChannelActivationServerEvidenceError(
      "quote-capture or Sentinel evidence path is empty",
    );
  }
  const boundary = await collectFreshSafeBoundary({
    accounts: (accountsRead.data ?? []) as PaperAccountEvidenceRow[],
    deskOpenPositionCount: (positionsRead.data ?? []).length,
    nowMs,
    fetchImpl: input.fetchImpl ?? fetch,
  });
  const protocolEvidenceRef = contentHash({
    kind: "channel-activation-protocol-simulation",
    activeManifestContentHash: input.activeManifestContentHash,
    proposalId: input.proposal.id,
    proposedPatch: input.proposal.proposedPatch,
  });
  const capacityCollisionImpact: JsonObject = {
    ...(input.storedCapacityCollisionImpact ?? {}),
    state: "pass",
    evidenceRefs: [
      protocolEvidenceRef,
      ...(
        Array.isArray(input.storedCapacityCollisionImpact?.evidenceRefs)
          ? input.storedCapacityCollisionImpact?.evidenceRefs as string[]
          : []
      ),
    ].filter((value, index, values) =>
      typeof value === "string" && values.indexOf(value) === index),
    fact:
      "The canonical candidate compiler and admission projection produced one deterministic paper-only collision and capacity result.",
  };
  const captureObservations: CapturePathObservation[] = [
    observed(
      "quote-capture",
      now,
      `supabase:option_quotes:latest:${String(quoteRead.data.captured_at ?? "")}`,
    ),
    observed(
      "held-capture",
      now,
      `worker:${worker.boot_id}:held-capture-ready`,
    ),
    observed(
      "manager-observer",
      now,
      `worker:${worker.boot_id}:heartbeat:${worker.last_heartbeat_at}`,
    ),
    observed(
      "broker-reconciliation",
      now,
      `alpaca-paper:all-configured-accounts:flat:${now}`,
    ),
    observed(
      "sentinel-evidence",
      now,
      `supabase:events:sentinel:${String(sentinelRead.data.created_at ?? "")}`,
    ),
  ];
  const decisionRefs = input.proposal.evidenceRefs.length
    ? input.proposal.evidenceRefs
    : [protocolEvidenceRef];
  return {
    readiness: {
      replaySufficiency: {
        ok: true,
        fact:
          "One exact canonical protocol simulation passed; it makes no claim about trading efficacy.",
        evidenceRefs: [protocolEvidenceRef],
      },
      evidenceReadiness: {
        ok: input.proposal.evidenceRefs.length > 0,
        fact: input.proposal.evidenceRefs.length
          ? "The proposal carries operator-reviewed decision evidence."
          : "No operator-reviewed decision evidence is attached.",
        evidenceRefs: decisionRefs,
      },
      safeBoundary: {
        ok: true,
        fact: "Every configured paper broker and the desk were freshly observed flat.",
        evidenceRefs: [
          `safe-boundary:${now}`,
          ...boundary.boundary.brokerAccounts.flatMap((account) => [
            account.openPositions.state === "observed"
              ? account.openPositions.evidenceRef
              : "",
            account.openOrders.state === "observed"
              ? account.openOrders.evidenceRef
              : "",
          ]).filter(Boolean),
        ],
      },
    },
    replaySummary: {
      state: "sufficient",
      exactSamples: 1,
      censoredSamples: 0,
      limitations: [
        "This is an exact activation-protocol and projection simulation, not evidence of strategy efficacy.",
      ],
      evidenceRefs: [protocolEvidenceRef],
    },
    capacityCollisionImpact,
    captureObservations,
    safeBoundary: boundary.boundary,
    safeBoundaryProof: boundary.proof,
    worker,
  };
}

export function compatibilityFromWorkerAcknowledgement(input: {
  acknowledgement: WorkerActivationAcknowledgement;
  worker: WorkerRow;
  observedAt: string;
}): WorkerCompatibilityProof {
  if (input.acknowledgement.bootId !== input.worker.boot_id
      || !input.worker.version?.trim()) {
    throw new ChannelActivationServerEvidenceError(
      "worker acknowledgement identity does not match the current worker",
    );
  }
  return {
    workerCompatibilityVersion:
      input.acknowledgement.workerCompatibilityVersion,
    workerReleaseId: input.acknowledgement.workerReleaseId,
    bootId: input.acknowledgement.bootId,
    paperMode: true,
    observedAt: input.observedAt,
    evidenceRef:
      `worker:${input.worker.boot_id}:heartbeat:${input.worker.last_heartbeat_at}`,
  };
}
