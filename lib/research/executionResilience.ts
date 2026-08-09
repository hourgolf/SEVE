import { createHash } from "node:crypto";
import type { DecisionAtlasSourceSnapshot, AtlasExecutionRow } from "./decisionAtlasAdapter";

export const EXECUTION_RESILIENCE_VERSION = "execution-resilience-v1" as const;

export interface ExecutionTraceIssue {
  severity: "block" | "review";
  code: string;
  traceId: string | null;
  detail: string;
}

export interface ExecutionResilienceReport {
  schemaVersion: 1;
  version: typeof EXECUTION_RESILIENCE_VERSION;
  generatedAt: string;
  throughSession: string;
  state: "pass" | "limited" | "block";
  traces: {
    total: number;
    brokerResults: number;
    filledEntries: number;
    filledExits: number;
    partialFills: number;
    rejectedOrErrored: number;
    positionRoutes: number;
    distinctClientOrderIds: number;
    guardedBrokerResults: number;
  };
  restarts: {
    observedRuns: number;
    distinctBootsInExecutionEvidence: number;
    graceful: number;
    deploySuperseded: number;
    abruptOrUnknown: number;
    overlappingPairs: number;
    staleOpenRuns: number;
  };
  issues: ExecutionTraceIssue[];
  provenProtections: string[];
  limitations: string[];
  orderAuthority: false;
  runtimeMutationAuthority: false;
  receiptSha256: string;
}

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;
const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const terminalError = (status: string | null): boolean =>
  /rejected|canceled|expired|request_error|error/i.test(status ?? "");
const positionRoute = (row: AtlasExecutionRow): boolean => row.action === "reconcile"
  && row.reason === "position_account_route_bound" && !!row.position_id;
const executionGuardVersion = (row: AtlasExecutionRow): string | null => {
  const value = row.payload?.execution_guard_version;
  return typeof value === "string" && value.length ? value : null;
};

export function buildExecutionResilienceReport(input: {
  snapshot: DecisionAtlasSourceSnapshot;
  generatedAt: string;
  throughSession: string;
}): ExecutionResilienceReport {
  const rows = [...input.snapshot.executionObservations]
    .sort((left, right) => left.event_at.localeCompare(right.event_at) || left.id.localeCompare(right.id));
  const issues: ExecutionTraceIssue[] = [];
  const routes = rows.filter(positionRoute);
  const routeByPosition = new Set(routes.flatMap((row) => row.position_id ? [row.position_id] : []));
  const routeByOpportunity = new Set(routes.flatMap((row) => row.opportunity_id ? [row.opportunity_id] : []));
  const tradePositions = new Set(input.snapshot.ledger.logicalTrades.flatMap((trade) => trade.positionIds));
  const tradeOpportunities = new Set(input.snapshot.ledger.logicalTrades.flatMap((trade) => trade.opportunityId ? [trade.opportunityId] : []));
  const byTrace = new Map<string, AtlasExecutionRow[]>();
  for (const row of rows) byTrace.set(row.trace_id, [...(byTrace.get(row.trace_id) ?? []), row]);
  const clientOrderRow = new Map<string, AtlasExecutionRow>();
  let filledEntries = 0;
  let filledExits = 0;
  let partialFills = 0;
  let rejectedOrErrored = 0;
  const brokerRows = rows.filter((row) => row.event_kind === "broker_result");

  for (const [traceId, traceRows] of byTrace) {
    const decisions = traceRows.filter((row) => row.event_kind === "decision" && !positionRoute(row));
    const broker = traceRows.filter((row) => row.event_kind === "broker_result");
    if (broker.length && !decisions.length) issues.push({ severity: "block", code: "BROKER_WITHOUT_DECISION",
      traceId, detail: "A broker result has no immutable decision receipt." });
    const identity = new Set(traceRows.map((row) => [row.account_id, row.channel_slug, row.action,
      row.occ_symbol ?? ""].join("|")));
    if (identity.size > 1) issues.push({ severity: "block", code: "TRACE_IDENTITY_DRIFT", traceId,
      detail: "Account, channel, action, or OCC changes inside one execution trace." });
    const requested = Math.max(0, ...decisions.map((row) => number(row.requested_qty) ?? 0));
    for (const row of broker) {
      const filled = number(row.filled_qty) ?? 0;
      if (terminalError(row.broker_status)) rejectedOrErrored += 1;
      if (filled > 0 && terminalError(row.broker_status)) issues.push({ severity: "block",
        code: "TERMINAL_ERROR_WITH_FILL", traceId, detail: `${row.broker_status} carries ${filled} filled contract(s).` });
      if (requested > 0 && filled > requested) issues.push({ severity: "block", code: "OVERFILL",
        traceId, detail: `${filled} filled contract(s) exceed ${requested} requested.` });
      if (filled > 0 && requested > filled) partialFills += 1;
      if (filled > 0 && row.action === "enter") {
        filledEntries += 1;
        const linked = (!!row.position_id && (routeByPosition.has(row.position_id) || tradePositions.has(row.position_id)))
          || (!!row.opportunity_id && (routeByOpportunity.has(row.opportunity_id) || tradeOpportunities.has(row.opportunity_id)));
        if (!linked) issues.push({ severity: "review", code: "ENTRY_FILL_WITHOUT_DURABLE_ROUTE", traceId,
          detail: "The filled entry has no position-route or logical-trade link in this frozen cohort." });
      }
      if (filled > 0 && row.action === "exit") {
        filledExits += 1;
        if (!row.position_id) issues.push({ severity: "block", code: "EXIT_FILL_WITHOUT_POSITION", traceId,
          detail: "A filled exit is not bound to a concrete desk position row." });
      }
      const clientOrderId = row.client_order_id?.trim() ?? "";
      if (clientOrderId) {
        const previous = clientOrderRow.get(clientOrderId);
        const distinctSubmission = previous && (previous.trace_id !== traceId
          || (!!previous.broker_order_id && !!row.broker_order_id && previous.broker_order_id !== row.broker_order_id));
        if (distinctSubmission) {
          const protectedReuse = !!executionGuardVersion(previous) || !!executionGuardVersion(row);
          issues.push({ severity: protectedReuse ? "block" : "review",
            code: protectedReuse ? "CLIENT_ORDER_GUARD_BREACH" : "HISTORICAL_CLIENT_ORDER_ID_REUSE",
            traceId, detail: protectedReuse
              ? `${clientOrderId} appears on distinct broker submissions despite the submit-once guard.`
              : `${clientOrderId} appears on distinct pre-guard execution traces; retain as a remediated incident.` });
        }
        clientOrderRow.set(clientOrderId, row);
      }
    }
  }

  const generatedMs = Date.parse(input.generatedAt);
  const runs = [...(input.snapshot.workerRuns ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at));
  let overlappingPairs = 0;
  for (let index = 1; index < runs.length; index += 1) {
    const priorEnd = Date.parse(runs[index - 1].ended_at ?? runs[index - 1].last_heartbeat_at ?? runs[index - 1].started_at);
    const nextStart = Date.parse(runs[index].started_at);
    if (Number.isFinite(priorEnd) && Number.isFinite(nextStart) && nextStart < priorEnd) overlappingPairs += 1;
  }
  const staleOpenRuns = runs.filter((run) => !run.ended_at && Number.isFinite(generatedMs)
    && generatedMs - Date.parse(run.last_heartbeat_at ?? run.started_at) > 5 * 60_000).length;
  if (staleOpenRuns) issues.push({ severity: "review", code: "STALE_OPEN_WORKER_RUN", traceId: null,
    detail: `${staleOpenRuns} worker run(s) remain open without a recent heartbeat.` });
  if (overlappingPairs) issues.push({ severity: "review", code: "OVERLAPPING_WORKER_RUNS", traceId: null,
    detail: `${overlappingPairs} adjacent worker run pair(s) overlap; verify deploy fencing.` });
  const abrupt = runs.filter((run) => /abrupt|unknown/i.test(run.termination_kind ?? "")).length;
  if (abrupt) issues.push({ severity: "review", code: "ABRUPT_WORKER_TERMINATION", traceId: null,
    detail: `${abrupt} worker run(s) ended abruptly or without attribution.` });
  if (!runs.length) issues.push({ severity: "review", code: "NO_WORKER_RUN_EVIDENCE", traceId: null,
    detail: "This frozen snapshot predates worker-run ingestion; restart history is not scored." });

  const body = {
    generatedAt: input.generatedAt,
    throughSession: input.throughSession,
    state: issues.some((issue) => issue.severity === "block") ? "block" as const
      : issues.length ? "limited" as const : "pass" as const,
    traces: {
      total: byTrace.size,
      brokerResults: brokerRows.length,
      filledEntries,
      filledExits,
      partialFills,
      rejectedOrErrored,
      positionRoutes: routes.length,
      distinctClientOrderIds: clientOrderRow.size,
      guardedBrokerResults: brokerRows.filter((row) => !!executionGuardVersion(row)).length,
    },
    restarts: {
      observedRuns: runs.length,
      distinctBootsInExecutionEvidence: new Set(rows.flatMap((row) => row.source_boot_id ? [row.source_boot_id] : [])).size,
      graceful: runs.filter((run) => /grace|signal|shutdown/i.test(run.termination_kind ?? "")).length,
      deploySuperseded: runs.filter((run) => run.termination_kind === "superseded_deploy").length,
      abruptOrUnknown: abrupt,
      overlappingPairs,
      staleOpenRuns,
    },
    issues,
    provenProtections: [
      "Broker results are paired to deterministic decision traces.",
      "Filled exits are required to retain an immutable position-row identity.",
      "Client order ids are checked for cross-trace reuse.",
      "Every guarded broker result identifies the submit-once implementation version.",
      "Partial fills remain distinct from requested quantity.",
      "Worker runs preserve boot, heartbeat, deployment, phase, and termination evidence.",
    ],
    limitations: [
      "A clean evidence graph supports restart confidence but does not execute a destructive restart drill.",
      "Legacy fills outside the frozen cohort may lack post-insert position-route receipts.",
      "Broker and desk flatness remains a separate current-state GET/SELECT observation.",
      "A newly deployed submit-once guard remains limited until a live broker result carries its version stamp.",
    ],
  };
  return { schemaVersion: 1, version: EXECUTION_RESILIENCE_VERSION, ...body,
    orderAuthority: false, runtimeMutationAuthority: false, receiptSha256: sha256(body) };
}

export function renderExecutionResilienceReport(report: ExecutionResilienceReport): string {
  return [
    `# Execution resilience · through ${report.throughSession}`,
    "",
    `**${report.state.toUpperCase()}** · ${report.traces.total} traces · ${report.traces.filledEntries} filled entries · ${report.traces.filledExits} filled exits`,
    "",
    `Worker history: ${report.restarts.observedRuns} runs · ${report.restarts.abruptOrUnknown} abrupt/unknown · ${report.restarts.overlappingPairs} overlaps.`,
    "",
    ...(report.issues.length ? report.issues.map((issue) => `- ${issue.severity.toUpperCase()} · ${issue.code}: ${issue.detail}`)
      : ["- No trace or restart exception was found in the frozen cohort."]),
    "",
    "Read-only evidence. No restart, order, or runtime mutation authority.",
  ].join("\n");
}
