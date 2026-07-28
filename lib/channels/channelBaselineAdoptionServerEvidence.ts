import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketEvent } from "@/lib/types";
import {
  evaluateSafeBoundary,
  type CountObservation,
  type SafeBoundaryInput,
} from "@/lib/channels/channelActivation";
import {
  BaselineAdoptionInputError,
  RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE,
  BASELINE_ADOPTION_PACKET_IDENTITY,
  type BaselineAdoptionRequest,
  type BaselineAdoptionResolvedEvidence,
} from "./channelBaselineAdoption";
import { findSealedReleaseReceipt } from "@/lib/ops/releaseReceipt";

const PAPER_ORIGIN = "https://paper-api.alpaca.markets";
const WORKER_FRESH_MS = 150_000;

interface AccountRow {
  id: string;
  name: string;
  mode: string;
  cred_ref: string | null;
}

interface WorkerRow {
  boot_id: string;
  version: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  last_phase: string | null;
  ended_at: string | null;
  last_error: string | null;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BaselineAdoptionInputError(`${field} is not a stored JSON object`, 409);
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, field: string): number {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  if (!Number.isFinite(parsed)) {
    throw new BaselineAdoptionInputError(`${field} has an invalid timestamp`, 409);
  }
  return parsed;
}

function currentWorker(
  rows: WorkerRow[],
  nowMs: number,
): WorkerRow {
  if (rows.length !== 1) {
    throw new BaselineAdoptionInputError(
      `baseline adoption requires exactly one current worker; observed ${rows.length}`,
      409,
    );
  }
  const worker = rows[0];
  const startedAt = timestamp(worker.started_at, "current worker start");
  const heartbeatAt = timestamp(worker.last_heartbeat_at, "current worker heartbeat");
  if (!worker.version?.trim()
      || heartbeatAt < nowMs - WORKER_FRESH_MS
      || heartbeatAt > nowMs + 5_000
      || startedAt > heartbeatAt
      || Boolean(worker.last_error?.trim())) {
    throw new BaselineAdoptionInputError(
      "current worker identity, liveness, or error posture is not exact",
      409,
    );
  }
  return worker;
}

function resolveStoredWorkerEvidence(input: {
  events: MarketEvent[];
  refs: BaselineAdoptionRequest;
  worker: WorkerRow;
  nowMs: number;
}): Pick<BaselineAdoptionResolvedEvidence, "startupReceipt" | "workerAcknowledgement"> {
  const byId = new Map(input.events.map((event) => [String(event.id), event]));
  const startupEvent = byId.get(input.refs.startupReceiptEventId);
  const acknowledgementEvent = byId.get(input.refs.workerAcknowledgementEventId);
  if (!startupEvent || !acknowledgementEvent) {
    throw new BaselineAdoptionInputError(
      "referenced startup or worker acknowledgement event is missing",
      409,
    );
  }
  const workerStartedMs = timestamp(input.worker.started_at, "current worker start");
  const startupEventMs = timestamp(startupEvent.created_at, "startup receipt event");
  const acknowledgementEventMs = timestamp(
    acknowledgementEvent.created_at,
    "worker acknowledgement event",
  );
  if (startupEventMs < workerStartedMs
      || acknowledgementEventMs < startupEventMs
      || acknowledgementEventMs > input.nowMs + 5_000) {
    throw new BaselineAdoptionInputError(
      "stored worker evidence does not belong to the current ordered startup",
      409,
    );
  }

  const expectedStartupMessage =
    `stream: rc54-release ACTIVE ${BASELINE_ADOPTION_PACKET_IDENTITY.releaseId}`
    + ` config=${BASELINE_ADOPTION_PACKET_IDENTITY.legacyConfigurationHash}`;
  if (startupEvent.message !== expectedStartupMessage) {
    throw new BaselineAdoptionInputError(
      "stored startup receipt message is not exact",
      409,
    );
  }
  const sealed = findSealedReleaseReceipt([startupEvent]);
  if (!sealed
      || sealed.lane !== "rc54"
      || sealed.releaseId !== BASELINE_ADOPTION_PACKET_IDENTITY.releaseId
      || sealed.configHash !== BASELINE_ADOPTION_PACKET_IDENTITY.legacyConfigurationHash) {
    throw new BaselineAdoptionInputError(
      "stored startup receipt does not identify exact RC5.4",
      409,
    );
  }
  const startupReceipt = object(startupEvent.meta, "stored startup receipt");

  const expectedAcknowledgementMessage =
    `stream: control-plane baseline shadow ACKNOWLEDGED`
    + ` ${BASELINE_ADOPTION_PACKET_IDENTITY.manifestId}`;
  if (acknowledgementEvent.message !== expectedAcknowledgementMessage) {
    throw new BaselineAdoptionInputError(
      "stored worker acknowledgement message is not exact",
      409,
    );
  }
  const observation = object(
    acknowledgementEvent.meta,
    "stored worker acknowledgement observation",
  );
  if (observation.observerMode !== RC54_CONTROL_PLANE_BASELINE_OBSERVER_MODE
      || observation.state !== "acknowledged"
      || observation.runtimeMutation !== false
      || observation.databaseWriteAuthority !== false
      || observation.orderAuthority !== false
      || observation.activationAuthorized !== false) {
    throw new BaselineAdoptionInputError(
      "stored worker acknowledgement posture is not authority-free",
      409,
    );
  }
  const workerAcknowledgement = object(
    observation.acknowledgement,
    "stored worker acknowledgement",
  );
  if (workerAcknowledgement.bootId !== input.worker.boot_id) {
    throw new BaselineAdoptionInputError(
      "stored worker acknowledgement does not belong to the current worker boot",
      409,
    );
  }
  if (workerAcknowledgement.workerRuntimeVersion !== input.worker.version) {
    throw new BaselineAdoptionInputError(
      "stored worker acknowledgement runtime does not match the current worker run",
      409,
    );
  }
  const acknowledgedAtMs = timestamp(
    workerAcknowledgement.acknowledgedAt,
    "stored worker acknowledgement",
  );
  if (Math.abs(acknowledgedAtMs - acknowledgementEventMs) > 10_000
      || acknowledgedAtMs < input.nowMs - 60_000
      || acknowledgedAtMs > input.nowMs + 5_000) {
    throw new BaselineAdoptionInputError(
      "stored worker acknowledgement is stale, future, or event-mismatched",
      409,
    );
  }
  return {
    startupReceipt: startupReceipt as BaselineAdoptionResolvedEvidence["startupReceipt"],
    workerAcknowledgement:
      workerAcknowledgement as BaselineAdoptionResolvedEvidence["workerAcknowledgement"],
  };
}

function credentials(account: AccountRow): { key: string; secret: string } | null {
  const ref = account.cred_ref?.trim() ?? "";
  const suffix = ref ? `_${ref}` : "";
  const key = process.env[`ALPACA_KEY${suffix}`];
  const secret = process.env[`ALPACA_SECRET${suffix}`];
  return key && secret ? { key, secret } : null;
}

async function brokerCount(input: {
  account: AccountRow;
  path: string;
  label: "positions" | "orders";
  observedAt: string;
  fetchImpl: typeof fetch;
}): Promise<CountObservation> {
  const auth = credentials(input.account);
  if (!auth) return { state: "failed", error: "paper broker credentials unavailable" };
  try {
    const response = await input.fetchImpl(`${PAPER_ORIGIN}${input.path}`, {
      headers: {
        "APCA-API-KEY-ID": auth.key,
        "APCA-API-SECRET-KEY": auth.secret,
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { state: "failed", error: `Alpaca ${input.label} returned ${response.status}` };
    }
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) {
      return { state: "failed", error: `Alpaca ${input.label} response was not an array` };
    }
    const count = input.label === "positions"
      ? rows.filter((row) => {
        const value = object(row, `Alpaca ${input.label} row`);
        const quantity = Number(value.qty ?? 0);
        return Number.isFinite(quantity) && Math.abs(quantity) >= 0.001;
      }).length
      : rows.length;
    return {
      state: "observed",
      count,
      evidenceRef:
        `alpaca-paper:${input.account.id}:${input.label}:${input.observedAt}`,
    };
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : "paper broker read failed",
    };
  }
}

async function resolveSafeBoundary(input: {
  accounts: AccountRow[];
  deskOpenPositionCount: number;
  nowMs: number;
  fetchImpl: typeof fetch;
}): Promise<BaselineAdoptionResolvedEvidence["safeBoundaryProof"]> {
  const paperAccounts = input.accounts.filter((account) =>
    account.mode.toLowerCase() === "paper");
  if (!paperAccounts.length
      || new Set(paperAccounts.map((account) => account.id)).size !== paperAccounts.length) {
    throw new BaselineAdoptionInputError(
      "configured paper account inventory is empty or duplicated",
      409,
    );
  }
  const observedAt = new Date(input.nowMs).toISOString();
  const brokerAccounts = await Promise.all(paperAccounts.map(async (account) => {
    const [openPositions, openOrders] = await Promise.all([
      brokerCount({
        account,
        path: "/v2/positions",
        label: "positions",
        observedAt,
        fetchImpl: input.fetchImpl,
      }),
      brokerCount({
        account,
        path: "/v2/orders?status=open&limit=500&direction=asc&nested=false",
        label: "orders",
        observedAt,
        fetchImpl: input.fetchImpl,
      }),
    ]);
    return { accountId: account.id, openPositions, openOrders };
  }));
  const boundary: SafeBoundaryInput = {
    observedAt,
    accountInventoryEvidenceRef: `supabase:accounts:paper:${observedAt}`,
    configuredAccounts: paperAccounts.map((account) => ({
      accountId: account.id,
      mode: "paper",
    })),
    brokerAccounts,
    deskOpenPositions: {
      state: "observed",
      count: input.deskOpenPositionCount,
      evidenceRef: `supabase:positions:open:${observedAt}`,
    },
  };
  const evaluated = evaluateSafeBoundary({
    boundary,
    evaluatedAt: observedAt,
    maxAgeMs: 30_000,
  });
  if (evaluated.state !== "pass" || !evaluated.proof) {
    throw new BaselineAdoptionInputError(
      `safe boundary is blocked: ${evaluated.blockers.join("; ")}`,
      409,
    );
  }
  return evaluated.proof;
}

export async function collectBaselineAdoptionServerEvidence(input: {
  sb: SupabaseClient;
  refs: BaselineAdoptionRequest;
  now?: string;
  fetchImpl?: typeof fetch;
}): Promise<BaselineAdoptionResolvedEvidence> {
  const now = input.now ?? new Date().toISOString();
  const nowMs = timestamp(now, "server evidence timestamp");
  const [eventsRead, workersRead, accountsRead, positionsRead] = await Promise.all([
    input.sb.from("events")
      .select("id,level,strategist_id,message,meta,created_at")
      .in("id", [
        input.refs.startupReceiptEventId,
        input.refs.workerAcknowledgementEventId,
      ]),
    input.sb.from("worker_runs")
      .select("boot_id,version,started_at,last_heartbeat_at,last_phase,ended_at,last_error")
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(20),
    input.sb.from("accounts")
      .select("id,name,mode,cred_ref")
      .order("id"),
    input.sb.from("positions")
      .select("id")
      .eq("status", "open"),
  ]);
  for (const [label, error] of [
    ["stored events", eventsRead.error],
    ["current worker", workersRead.error],
    ["paper accounts", accountsRead.error],
    ["open desk positions", positionsRead.error],
  ] as const) {
    if (error) {
      throw new BaselineAdoptionInputError(
        `${label} evidence read failed: ${error.message}`,
        409,
      );
    }
  }
  const worker = currentWorker((workersRead.data ?? []) as WorkerRow[], nowMs);
  const stored = resolveStoredWorkerEvidence({
    events: (eventsRead.data ?? []) as MarketEvent[],
    refs: input.refs,
    worker,
    nowMs,
  });
  const safeBoundaryProof = await resolveSafeBoundary({
    accounts: (accountsRead.data ?? []) as AccountRow[],
    deskOpenPositionCount: (positionsRead.data ?? []).length,
    nowMs,
    fetchImpl: input.fetchImpl ?? fetch,
  });
  return {
    ...stored,
    safeBoundaryProof,
  };
}
