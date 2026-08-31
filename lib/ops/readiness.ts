import type { MarketEvent } from "@/lib/types";
import {
  DAY1_MANAGER_ARMS,
  type Day1ReleaseReadState,
} from "@/lib/channels/day1Release";
import {
  observeActiveRelease,
  type ActiveReleaseObservation,
} from "@/lib/channels/activeRelease";
import { deriveSentinelReceiptStatus, type SentinelReceiptInput } from "@/lib/sentinel/receipt";
import type { BrokerReconciliationReceipt } from "@/lib/ops/brokerReconciliation";
import type { AtlasPublicationVerification } from "@/lib/research/atlasPublication";

export type OpsEvidenceState = "loading" | "ok" | "error";
export type ReadinessTone = "green" | "yellow" | "red" | "neutral";

export interface OpsEvidenceRead<T> {
  state: OpsEvidenceState;
  rows: T[];
  error: string;
  fetchedAtMs: number | null;
  lastOkAtMs: number | null;
  summary?: { candidates: number; suppressed: number };
}

export interface ExecutionEvidenceRow {
  id: string;
  event_kind: "decision" | "broker_result";
  event_at: string;
  source_bar_at: string;
  channel_slug: string;
  opportunity_id: string | null;
  position_id: string | null;
  action: string;
  blocked_reason: string | null;
  occ_symbol: string | null;
  filled_qty: number | null;
  broker_status: string | null;
  payload: unknown;
}

export interface ManagerEvidenceRow {
  id: string;
  position_id: string;
  channel_slug: string;
  manager_id: string;
  status: "active" | "terminal" | "censored";
  evidence_state: string | null;
  entry_at: string;
  last_observed_at: string | null;
  manager_policy_version: string;
  shadow_book_version: string;
  censor_code: string | null;
}

export interface CaptureReceiptRow {
  id: string;
  object_key?: string;
  position_id: string;
  channel_slug: string;
  occ_symbol: string;
  session_date_et: string;
  sample_count: number;
  successful_quote_count: number;
  dropped_samples: number;
  completed_at: string;
  created_at?: string;
}

export interface CaptureHealthRow {
  id: string;
  observed_at: string;
  severity: "warning" | "high";
  code: string;
  position_id: string | null;
  affected_samples: number;
  facts?: Record<string, unknown>;
}

export interface PublisherEvidenceRow {
  id: string;
  message: string;
  created_at: string;
}

export interface PositionOutcomeEvidenceRow {
  id: string;
  event_kind: "position_opened" | "position_remainder_opened" | "position_booked" | "reconciliation_unresolved" | "reconciliation_estimated" | "manual_reason_tagged";
  event_at: string;
  position_id: string;
  opportunity_id: string | null;
  quantity: number | null;
  exit_price: number | null;
  realized_pnl: number | null;
  close_reason: string | null;
}

export interface OpsEvidence {
  execution: OpsEvidenceRead<ExecutionEvidenceRow>;
  managers: OpsEvidenceRead<ManagerEvidenceRow>;
  captures: OpsEvidenceRead<CaptureReceiptRow>;
  captureHealth: OpsEvidenceRead<CaptureHealthRow>;
  publisher: OpsEvidenceRead<PublisherEvidenceRow>;
  outcomes: OpsEvidenceRead<PositionOutcomeEvidenceRow>;
  broker: OpsEvidenceRead<BrokerReconciliationReceipt>;
}

export interface ReadinessItem {
  id: string;
  label: string;
  state: string;
  detail: string;
  tone: ReadinessTone;
  observedAt?: string;
}

export interface OpsReadinessModel {
  sessionDateEt: string;
  phase: "before-cohort" | "session";
  summary: ReadinessItem;
  configuration: ReadinessItem[];
  evidence: ReadinessItem[];
  counts: {
    candidates: number;
    suppressed: number;
    fills: number;
    capturedPositions: number;
    admittedManagerArms: number;
    managerArms: number;
    expectedManagerArms: number;
    staleManagerArms: number;
  };
  chainEvidenceState: "checking" | "ok" | "blocked";
  chainEvidenceDetail: string;
  chains: OpsEvidenceChain[];
  brokerReceipt: BrokerReconciliationReceipt | null;
}

export interface OpsEvidenceChain {
  positionId: string;
  channelSlug: string;
  occSymbol: string;
  opportunityId: string;
  tone: ReadinessTone;
  steps: ReadinessItem[];
}

export interface DeriveOpsReadinessInput {
  nowMs: number;
  releaseEvents: MarketEvent[];
  releaseReadState: Day1ReleaseReadState;
  evidence: OpsEvidence;
  sentinel: SentinelReceiptInput;
  openPositions: number;
  closedPositions: number;
  atlasPublication?: AtlasPublicationVerification;
  atlasState?: string;
  atlasFreshness?: string;
}

const DAY1_COHORT_FROM = "2026-07-20";
const RC54_COHORT_FROM = "2026-07-27";
const CAPTURE_GRACE_MS = 150_000;
const MANAGER_GRACE_MS = 60_000;

const etParts = (nowMs: number): { date: string; minute: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(nowMs));
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "00";
  let hour = Number(value("hour"));
  if (hour === 24) hour = 0;
  return { date: `${value("year")}-${value("month")}-${value("day")}`, minute: hour * 60 + Number(value("minute")) };
};

const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const candidateMeta = (
  row: ExecutionEvidenceRow,
  release: ActiveReleaseObservation,
): Record<string, unknown> | null => {
  const payload = object(row.payload);
  const detail = object(payload?.decisionDetail);
  const candidate = object(release.lane === "rc54" ? detail?.rc54Candidate : detail?.day1Candidate);
  return candidate?.releaseId === release.releaseId
    && candidate.configurationSha256 === release.expectedHash
    ? candidate
    : null;
};

const eventMeta = (
  _events: MarketEvent[],
  release: ActiveReleaseObservation,
): Record<string, unknown> | null => object(release.receipt?.meta);

const readError = (id: string, label: string, read: OpsEvidenceRead<unknown>): ReadinessItem => ({
  id, label, state: "READ ERROR", tone: "red",
  detail: read.error || "operator evidence could not be read; no absence claim is made",
});

const latest = <T>(rows: T[], at: (row: T) => string): T | null =>
  rows.reduce<T | null>((best, row) => !best || Date.parse(at(row)) > Date.parse(at(best)) ? row : best, null);

const releaseConfigItems = (events: MarketEvent[], readState: Day1ReleaseReadState): ReadinessItem[] => {
  const observed = observeActiveRelease(events, readState);
  const releaseTone: ReadinessTone = observed.state === "verified" ? "green"
    : observed.state === "checking" ? "neutral" : observed.state === "read-error" ? "red" : "red";
  const meta = eventMeta(events, observed);
  const held = object(meta?.heldCapture);
  const runtime = object(meta?.runtimeReadiness);
  const manager = object(meta?.managerShadow);
  const captureOk = observed.state === "verified"
    && held?.enabled === true && Number(held?.targetSamples) === 12 && Number(held?.maxAgeMs) === 60_000
    && runtime?.heldCaptureReady === true && runtime?.heldCaptureStartedBeforeBootDecision === true;
  const managerOk = observed.state === "verified" && manager?.enabled === true && Number(manager?.quoteMaxAgeMs) === 15_000;
  const paperOriginOk = meta?.alpacaPaperOrigin === "https://paper-api.alpaca.markets";
  const paperExecutor = observed.state === "verified" && paperOriginOk && meta?.dryRun === false && meta?.liveTrading === true;
  const paperShadow = observed.state === "verified" && paperOriginOk && meta?.dryRun === true && meta?.liveTrading === false;
  return [
    { id: "release", label: "SEALED RELEASE", state: observed.state.replaceAll("-", " ").toUpperCase(), tone: releaseTone, detail: observed.fact, observedAt: observed.receipt?.createdAt },
    { id: "capture-config", label: "HELD CAPTURE", state: captureOk ? "CONFIGURED" : observed.state === "checking" ? "CHECKING" : "UNVERIFIED", tone: captureOk ? "green" : observed.state === "checking" ? "neutral" : "red", detail: captureOk ? "12 samples / 60s · runtime ready before boot decision" : "sealed capture settings or runtime-readiness receipt not observed" },
    { id: "manager-config", label: "MANAGER OBSERVER", state: managerOk ? "CONFIGURED" : observed.state === "checking" ? "CHECKING" : "UNVERIFIED", tone: managerOk ? "green" : observed.state === "checking" ? "neutral" : "red", detail: managerOk ? `${observed.configuredManagerArms} paper-only arms · quote max 15s` : "sealed manager-shadow settings not observed" },
    {
      id: "paper-boundary",
      label: "ORDER BOUNDARY",
      state: paperExecutor ? "PAPER EXECUTOR" : paperShadow ? "PAPER / SHADOW" : "UNVERIFIED",
      tone: paperExecutor ? "green" : paperShadow ? "yellow" : "red",
      detail: paperExecutor
        ? "paper broker execution enabled · two-key turn verified"
        : paperShadow
          ? "research writes only · paper orders disabled"
          : "paper-only startup boundary not established by the release receipt",
    },
  ];
};

export function deriveOpsReadiness(input: DeriveOpsReadinessInput): OpsReadinessModel {
  const clock = etParts(input.nowMs);
  const activeRelease = observeActiveRelease(input.releaseEvents, input.releaseReadState);
  const cohortFrom = activeRelease.lane === "rc54" ? RC54_COHORT_FROM : DAY1_COHORT_FROM;
  const phase = clock.date < cohortFrom ? "before-cohort" : "session";
  const configuration = releaseConfigItems(input.releaseEvents, input.releaseReadState);
  const sentinel = deriveSentinelReceiptStatus(input.sentinel, input.nowMs);
  const expectedManagerArms = activeRelease.configuredManagerArms || DAY1_MANAGER_ARMS.length;

  const execution = input.evidence.execution;
  const sessionExecutions = execution.state === "ok"
    ? execution.rows.filter((row) => row.event_at.slice(0, 10) === clock.date)
    : [];
  const decisions = sessionExecutions.filter((row) => row.event_kind === "decision" && candidateMeta(row, activeRelease));
  const admittedOpportunityIds = new Set(decisions.flatMap((row) => row.opportunity_id ? [row.opportunity_id] : []));
  const outcomes = input.evidence.outcomes.state === "ok" ? input.evidence.outcomes.rows : [];
  // Entry broker observations do not yet carry the inserted position id, so
  // resolve them through the primary position_opened receipt. A later
  // position_remainder_opened row belongs to the same opportunity but is a
  // runner created after a partial exit; letting it overwrite the primary
  // falsely detaches the entry from its manager and capture evidence.
  const openedPositionByOpportunity = new Map(outcomes.flatMap((row) =>
    row.opportunity_id && row.event_kind === "position_opened"
      ? [[row.opportunity_id, row.position_id] as const]
      : []));
  const candidates = execution.summary?.candidates ?? new Set(decisions.map((row) => row.opportunity_id ?? row.id)).size;
  const suppressed = execution.summary?.suppressed ?? decisions.filter((row) => Boolean(row.blocked_reason)).length;
  const fillRows = sessionExecutions.filter((row) => row.event_kind === "broker_result"
    && Number(row.filled_qty) > 0 && row.opportunity_id
    && admittedOpportunityIds.has(row.opportunity_id))
    .map((row) => ({ ...row, position_id: row.position_id ?? openedPositionByOpportunity.get(row.opportunity_id as string) ?? null }))
    .filter((row) => Boolean(row.position_id));
  const fillsByPosition = new Map(fillRows.map((row) => [row.position_id as string, row]));
  const positionIds = new Set(fillsByPosition.keys());
  const oldestFillMs = Math.min(...[...fillsByPosition.values()].map((row) => Date.parse(row.event_at)), Number.POSITIVE_INFINITY);
  const captureDue = positionIds.size > 0 && input.nowMs - oldestFillMs > CAPTURE_GRACE_MS;
  const managerDue = positionIds.size > 0 && input.nowMs - oldestFillMs > MANAGER_GRACE_MS;

  const evidence: ReadinessItem[] = [];
  if (execution.state !== "ok") {
    evidence.push(execution.state === "error" ? readError("candidates", "CANDIDATE LEDGER", execution) : { id: "candidates", label: "CANDIDATE LEDGER", state: "CHECKING", tone: "neutral", detail: "reading current-session candidate provenance" });
  } else if (phase === "before-cohort") {
    evidence.push({ id: "candidates", label: "CANDIDATE LEDGER", state: "NOT DUE", tone: "neutral", detail: `sealed cohort begins ${cohortFrom}; prior rows are excluded` });
  } else if (candidates === 0) {
    evidence.push({ id: "candidates", label: "CANDIDATE LEDGER", state: "WAITING", tone: "neutral", detail: "no RC5 candidate yet; trade absence is not a failure" });
  } else {
    evidence.push({ id: "candidates", label: "CANDIDATE LEDGER", state: "OBSERVED", tone: "green", detail: `${candidates} candidate decision receipt${candidates === 1 ? "" : "s"} · ${suppressed} suppressed/censored` });
  }

  evidence.push({
    id: "fills", label: "AUTHORIZED FILLS",
    state: fillsByPosition.size ? "OBSERVED" : candidates ? "NONE YET" : "WAITING",
    tone: fillsByPosition.size ? "green" : "neutral",
    detail: fillsByPosition.size ? `${fillsByPosition.size} RC5 position${fillsByPosition.size === 1 ? "" : "s"} with positive filled quantity` : "a valid candidate may be suppressed; fill absence is not itself a fault",
  });

  const captures = input.evidence.captures;
  const captureHealth = input.evidence.captureHealth;
  const allSessionReceipts = captures.state === "ok" ? captures.rows.filter((row) => row.session_date_et === clock.date) : [];
  const sessionReceipts = allSessionReceipts.filter((row) => positionIds.has(row.position_id));
  const capturedPositions = new Set(sessionReceipts.map((row) => row.position_id)).size;
  const healthRows = captureHealth.state === "ok" ? captureHealth.rows.filter((row) => row.observed_at.slice(0, 10) === clock.date) : [];
  const recoveredHealth = healthRows.filter((health) => {
    const objectKey = typeof health.facts?.objectKey === "string" ? health.facts.objectKey : null;
    if (!objectKey) return false;
    // The receipt insert may commit even when the client-side request times out.
    // The health row is then emitted a few seconds after that committed receipt,
    // so exact content-addressed identity is the recovery proof—not row ordering.
    return allSessionReceipts.some((receipt) => receipt.object_key === objectKey);
  });
  const unrecoveredHealth = healthRows.filter((row) => !recoveredHealth.includes(row));
  const highHealth = unrecoveredHealth.find((row) => row.severity === "high");
  if (captures.state === "error") evidence.push(readError("capture", "HELD CAPTURE", captures));
  else if (captureHealth.state === "error") evidence.push(readError("capture", "HELD CAPTURE HEALTH", captureHealth));
  else if (highHealth) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "EVIDENCE GAP", tone: "red", detail: `${highHealth.code} · ${highHealth.affected_samples} affected samples`, observedAt: highHealth.observed_at });
  else if (unrecoveredHealth.length) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "DEGRADED", tone: "yellow", detail: `${unrecoveredHealth[0].code} · ${unrecoveredHealth[0].affected_samples} affected samples`, observedAt: unrecoveredHealth[0].observed_at });
  else if (!positionIds.size) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "WAITING", tone: "neutral", detail: "capture proof becomes due only after an RC5 fill" });
  else if (capturedPositions === positionIds.size && recoveredHealth.length) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "RETRY RECOVERED", tone: "yellow", detail: `${capturedPositions}/${positionIds.size} positions receipted · prior ${recoveredHealth[0].code} recovered by the exact object receipt`, observedAt: recoveredHealth[0].observed_at });
  else if (capturedPositions === positionIds.size) {
    const samples = sessionReceipts.reduce((sum, row) => sum + Number(row.sample_count), 0);
    evidence.push({ id: "capture", label: "HELD CAPTURE", state: "OBSERVED", tone: "green", detail: `${capturedPositions}/${positionIds.size} positions · ${samples} samples receipted`, observedAt: latest(sessionReceipts, (row) => row.completed_at)?.completed_at });
  } else evidence.push({ id: "capture", label: "HELD CAPTURE", state: captureDue ? "MISSING RECEIPT" : "FLUSHING", tone: captureDue ? "yellow" : "neutral", detail: `${capturedPositions}/${positionIds.size} filled positions have a current-session receipt` });

  const managers = input.evidence.managers;
  const staleManagerRows = managers.state === "ok" ? managers.rows.filter((row) =>
    row.status === "active" && etParts(Date.parse(row.entry_at)).date < clock.date) : [];
  if (staleManagerRows.length) evidence.push({
    id: "stale-managers", label: "STALE MANAGER ARMS", state: "CLEANUP DUE", tone: "yellow",
    detail: `${staleManagerRows.length} prior-session observer${staleManagerRows.length === 1 ? "" : "s"} remain active · research only; trading is unaffected`,
    observedAt: latest(staleManagerRows, (row) => row.last_observed_at ?? row.entry_at)?.last_observed_at ?? undefined,
  });
  const managerRows = managers.state === "ok" ? managers.rows.filter((row) => positionIds.has(row.position_id)) : [];
  const admittedArms = new Set(managerRows.map((row) => `${row.position_id}:${row.manager_id}`));
  const observingArms = new Set(managerRows
    .filter((row) => row.evidence_state === "observing")
    .map((row) => `${row.position_id}:${row.manager_id}`));
  const expectedArms = positionIds.size * expectedManagerArms;
  if (managers.state === "error") evidence.push(readError("managers", "MANAGER ARMS", managers));
  else if (!positionIds.size) evidence.push({ id: "managers", label: "MANAGER ARMS", state: "WAITING", tone: "neutral", detail: `${expectedManagerArms} shadow arms become due after each RC5 fill` });
  else if (observingArms.size >= expectedArms) evidence.push({ id: "managers", label: "MANAGER ARMS", state: "COMPLETE", tone: "green", detail: `${observingArms.size}/${expectedArms} observing · ${admittedArms.size}/${expectedArms} admitted`, observedAt: latest(managerRows.filter((row) => row.evidence_state === "observing"), (row) => row.last_observed_at ?? row.entry_at)?.last_observed_at ?? undefined });
  else if (admittedArms.size >= expectedArms) evidence.push({ id: "managers", label: "MANAGER ARMS", state: "AWAITING QUOTES", tone: managerDue ? "yellow" : "neutral", detail: `${observingArms.size}/${expectedArms} observing · ${admittedArms.size}/${expectedArms} admitted` });
  else evidence.push({ id: "managers", label: "MANAGER ARMS", state: managerDue ? "INCOMPLETE" : "STARTING", tone: managerDue ? "yellow" : "neutral", detail: `${observingArms.size}/${expectedArms} observing · ${admittedArms.size}/${expectedArms} admitted` });

  const publisher = input.evidence.publisher;
  const latestPublisher = publisher.state === "ok" ? latest(publisher.rows, (row) => row.created_at) : null;
  // Day-report, Atlas, and Sentinel are independent publications. A timestamp
  // or a legacy "done" message is not proof that the complete Atlas arrived.
  const publication = input.atlasPublication;
  const publisherDone = publication?.state === "verified" && publication.throughSession === clock.date;
  const postClose = clock.minute >= 16 * 60;
  if (input.atlasState === "error") evidence.push({ id: "publisher", label: "ATLAS PUBLICATION", state: "READ / VERIFY FAILED", tone: "red", detail: "Atlas payload or publication receipt could not be verified" });
  else if (postClose && (candidates > 0 || fillsByPosition.size > 0) && !publisherDone) evidence.push({ id: "publisher", label: "ATLAS PUBLICATION", state: "DUE", tone: "yellow", detail: "current-session activity exists but no verified same-session Atlas bundle is observed" });
  else if (publication) evidence.push({ id: "publisher", label: "ATLAS PUBLICATION",
    state: input.atlasFreshness === "stale" ? "STALE" : publication.state === "verified" ? "BUNDLE VERIFIED" : "UNVERIFIED BUNDLE",
    tone: publication.state === "verified" && input.atlasFreshness !== "stale" ? "green" : "yellow",
    detail: `through ${publication.throughSession} · ${publication.detail}` });
  else evidence.push({ id: "publisher", label: "ATLAS PUBLICATION", state: "NOT VERIFIED", tone: "neutral", detail: "no complete-bundle verification is available; day-report and next-session brief are separate" });
  if (publisher.state === "error") evidence.push(readError("day-report", "DAY-REPORT PUBLISHER", publisher));
  else if (latestPublisher?.message.includes("exited")) evidence.push({ id: "day-report", label: "DAY-REPORT PUBLISHER", state: "FAILED", tone: "red", detail: latestPublisher.message, observedAt: latestPublisher.created_at });

  evidence.push({ id: "sentinel", label: "SENTINEL RECEIPT", state: sentinel.label, tone: sentinel.tone, detail: sentinel.detail, observedAt: sentinel.publishedAt });
  const broker = input.evidence.broker;
  const brokerReceipt = broker.state === "ok" ? broker.rows[0] : null;
  if (broker.state === "loading") evidence.push({ id: "reconciliation", label: "BROKER RECONCILIATION", state: "CHECKING", tone: "neutral", detail: "reading current positions from every configured paper account" });
  else if (broker.state === "error" || !brokerReceipt) evidence.push(readError("reconciliation", "BROKER RECONCILIATION", broker));
  else if (brokerReceipt.state === "partial") evidence.push({ id: "reconciliation", label: "BROKER RECONCILIATION", state: "PARTIAL", tone: "yellow", detail: `${brokerReceipt.accounts.filter((account) => account.reachable).length}/${brokerReceipt.accounts.length} accounts reached · no broker-flat assertion`, observedAt: brokerReceipt.observedAt });
  else if (brokerReceipt.state === "drift") evidence.push({ id: "reconciliation", label: "BROKER RECONCILIATION", state: "DRIFT", tone: "red", detail: `${brokerReceipt.mismatches.length} OCC mismatch${brokerReceipt.mismatches.length === 1 ? "" : "es"} · broker ${brokerReceipt.brokerContracts} / desk ${brokerReceipt.deskContracts} contracts`, observedAt: brokerReceipt.observedAt });
  else evidence.push({ id: "reconciliation", label: "BROKER RECONCILIATION", state: brokerReceipt.flatConfirmed ? "BROKER + DESK FLAT" : "BOOKS MATCH", tone: "green", detail: `${brokerReceipt.accounts.length} paper accounts reached · broker ${brokerReceipt.brokerContracts} / desk ${brokerReceipt.deskContracts} contracts`, observedAt: brokerReceipt.observedAt });

  const chains: OpsEvidenceChain[] = [...fillsByPosition.values()].map((fill) => {
    const positionId = fill.position_id as string;
    const receipt = sessionReceipts.find((row) => row.position_id === positionId);
    const positionManagers = managerRows.filter((row) => row.position_id === positionId);
    const positionAdmittedManagers = new Set(positionManagers.map((row) => row.manager_id));
    const positionObservingManagers = new Set(positionManagers.filter((row) => row.evidence_state === "observing").map((row) => row.manager_id));
    const positionOutcomes = outcomes.filter((row) => row.position_id === positionId);
    const outcome = latest(positionOutcomes.filter((row) => ["position_booked", "reconciliation_estimated", "reconciliation_unresolved"].includes(row.event_kind)), (row) => row.event_at);
    const closeTag = latest(positionOutcomes.filter((row) => row.event_kind === "manual_reason_tagged"), (row) => row.event_at);
    const decision = decisions.find((row) => row.opportunity_id && row.opportunity_id === fill.opportunity_id);
    const captureState: ReadinessItem = receipt
      ? { id: "capture", label: "CAPTURE", state: "OBSERVED", tone: "green", detail: `${receipt.sample_count} samples · ${receipt.dropped_samples} dropped`, observedAt: receipt.completed_at }
      : { id: "capture", label: "CAPTURE", state: captureDue ? "MISSING" : "FLUSHING", tone: captureDue ? "yellow" : "neutral", detail: "waiting for the exact-contract held-path receipt" };
    const managerState: ReadinessItem = positionObservingManagers.size >= expectedManagerArms
      ? { id: "managers", label: "MANAGER ARMS", state: `${positionObservingManagers.size}/${expectedManagerArms} OBSERVING`, tone: "green", detail: "all preregistered arms have durable quote evidence for this filled position" }
      : positionAdmittedManagers.size >= expectedManagerArms
        ? { id: "managers", label: "MANAGER ARMS", state: `${positionObservingManagers.size}/${expectedManagerArms} OBSERVING`, tone: managerDue ? "yellow" : "neutral", detail: `${positionAdmittedManagers.size}/${expectedManagerArms} arms admitted · durable quote evidence pending` }
        : { id: "managers", label: "MANAGER ARMS", state: `${positionObservingManagers.size}/${expectedManagerArms} OBSERVING`, tone: managerDue ? "yellow" : "neutral", detail: `${positionAdmittedManagers.size}/${expectedManagerArms} arms admitted` };
    const closed = outcome && ["position_booked", "reconciliation_estimated"].includes(outcome.event_kind);
    const closeState: ReadinessItem = closed
      ? { id: "close", label: "CLOSE", state: "BOOKED", tone: "green", detail: `${closeTag?.close_reason ?? outcome.close_reason ?? "unclassified"} · ${outcome.realized_pnl == null ? "P&L unavailable" : `$${Math.round(outcome.realized_pnl)}`}`, observedAt: closeTag?.event_at ?? outcome.event_at }
      : outcome?.event_kind === "reconciliation_unresolved"
        ? { id: "close", label: "CLOSE", state: "UNRESOLVED", tone: "red", detail: outcome.close_reason ?? "reconciliation has no executable price", observedAt: outcome.event_at }
        : { id: "close", label: "CLOSE", state: "OPEN", tone: "neutral", detail: "no terminal booking receipt observed" };
    const steps: ReadinessItem[] = [
      { id: "candidate", label: "CANDIDATE", state: decision ? "STAMPED" : "INFERRED", tone: decision ? "green" : "yellow", detail: fill.opportunity_id ?? "opportunity id unavailable", observedAt: decision?.event_at },
      { id: "fill", label: "FILL", state: `${fill.filled_qty ?? 0} FILLED`, tone: "green", detail: fill.broker_status ?? "broker result observed", observedAt: fill.event_at },
      captureState, managerState, closeState,
    ];
    const tone: ReadinessTone = steps.some((step) => step.tone === "red") ? "red" : steps.some((step) => step.tone === "yellow") ? "yellow" : steps.every((step) => step.tone === "green") ? "green" : "neutral";
    return { positionId, channelSlug: fill.channel_slug, occSymbol: fill.occ_symbol ?? "—", opportunityId: fill.opportunity_id ?? "—", tone, steps };
  });
  const chainReads = [
    ["execution", execution],
    ["outcomes", input.evidence.outcomes],
    ["captures", captures],
    ["capture health", captureHealth],
    ["manager arms", managers],
  ] as const;
  const failedChainReads = chainReads.filter(([, read]) => read.state === "error");
  const loadingChainReads = chainReads.filter(([, read]) => read.state === "loading");
  const chainEvidenceState: OpsReadinessModel["chainEvidenceState"] = failedChainReads.length
    ? "blocked"
    : loadingChainReads.length
      ? "checking"
      : "ok";
  const chainEvidenceDetail = failedChainReads.length
    ? `position-chain reads failed: ${failedChainReads.map(([label, read]) => `${label} (${read.error || "read rejected"})`).join("; ")}`
    : loadingChainReads.length
      ? `reading ${loadingChainReads.map(([label]) => label).join(", ")}`
      : "current-session execution, capture, manager, and close evidence read";

  const all = [...configuration, ...evidence];
  const trading = all.filter((item) => ["release", "paper-boundary", "reconciliation"].includes(item.id));
  const data = all.filter((item) => !["release", "paper-boundary", "reconciliation", "sentinel"].includes(item.id));
  const research = all.filter((item) => item.id === "sentinel");
  const laneState = (items: ReadinessItem[]): "ready" | "attention" | "blocked" | "checking" =>
    items.some((item) => item.tone === "red") ? "blocked"
      : items.some((item) => item.tone === "yellow") ? "attention"
        : items.some((item) => item.tone === "neutral") && !items.some((item) => item.tone === "green") ? "checking" : "ready";
  const tradingState = laneState(trading);
  const dataState = laneState(data);
  const researchState = laneState(research);
  const supportingAttention = dataState === "blocked" || dataState === "attention" || researchState === "blocked" || researchState === "attention";
  const summary: ReadinessItem = tradingState === "blocked"
    ? { id: "summary", label: "DESK READINESS", state: "TRADING BLOCKED", tone: "red", detail: `trading blocked · data ${dataState} · research ${researchState}` }
    : supportingAttention
      ? { id: "summary", label: "DESK READINESS", state: "TRADING READY", tone: "yellow", detail: `trading ${tradingState} · data ${dataState} · research ${researchState}` }
      : { id: "summary", label: "DESK READINESS", state: phase === "before-cohort" ? "CONFIGURED" : "READY", tone: "green", detail: phase === "before-cohort" ? `sealed runtime configured · cohort begins ${cohortFrom}` : `trading ${tradingState} · data ${dataState} · research ${researchState}` };

  return {
    sessionDateEt: clock.date, phase, summary, configuration, evidence,
    counts: { candidates, suppressed, fills: fillsByPosition.size, capturedPositions, admittedManagerArms: admittedArms.size, managerArms: observingArms.size, expectedManagerArms: expectedArms, staleManagerArms: staleManagerRows.length },
    chainEvidenceState,
    chainEvidenceDetail,
    chains,
    brokerReceipt,
  };
}
