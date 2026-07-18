import type { MarketEvent } from "@/lib/types";
import {
  DAY1_CONFIG_HASH,
  DAY1_MANAGER_ARMS,
  DAY1_RELEASE_ID,
  observeDay1Release,
  type Day1ReleaseReadState,
} from "@/lib/channels/day1Release";
import { deriveSentinelReceiptStatus, type SentinelReceiptInput } from "@/lib/sentinel/receipt";

export type OpsEvidenceState = "loading" | "ok" | "error";
export type ReadinessTone = "green" | "yellow" | "red" | "neutral";

export interface OpsEvidenceRead<T> {
  state: OpsEvidenceState;
  rows: T[];
  error: string;
  fetchedAtMs: number | null;
  lastOkAtMs: number | null;
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
  position_id: string;
  channel_slug: string;
  occ_symbol: string;
  session_date_et: string;
  sample_count: number;
  successful_quote_count: number;
  dropped_samples: number;
  completed_at: string;
}

export interface CaptureHealthRow {
  id: string;
  observed_at: string;
  severity: "warning" | "high";
  code: string;
  position_id: string | null;
  affected_samples: number;
}

export interface PublisherEvidenceRow {
  id: string;
  message: string;
  created_at: string;
}

export interface OpsEvidence {
  execution: OpsEvidenceRead<ExecutionEvidenceRow>;
  managers: OpsEvidenceRead<ManagerEvidenceRow>;
  captures: OpsEvidenceRead<CaptureReceiptRow>;
  captureHealth: OpsEvidenceRead<CaptureHealthRow>;
  publisher: OpsEvidenceRead<PublisherEvidenceRow>;
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
    managerArms: number;
    expectedManagerArms: number;
  };
}

export interface DeriveOpsReadinessInput {
  nowMs: number;
  releaseEvents: MarketEvent[];
  releaseReadState: Day1ReleaseReadState;
  evidence: OpsEvidence;
  sentinel: SentinelReceiptInput;
  openPositions: number;
  closedPositions: number;
}

const COHORT_FROM = "2026-07-20";
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

const candidateMeta = (row: ExecutionEvidenceRow): Record<string, unknown> | null => {
  const payload = object(row.payload);
  const detail = object(payload?.decisionDetail);
  const candidate = object(detail?.day1Candidate);
  return candidate?.releaseId === DAY1_RELEASE_ID && candidate.configurationSha256 === DAY1_CONFIG_HASH ? candidate : null;
};

const eventMeta = (events: MarketEvent[]): Record<string, unknown> | null => {
  const release = events.find((event) => event.message.includes(`day1-release ACTIVE ${DAY1_RELEASE_ID}`));
  return object(release?.meta);
};

const readError = (id: string, label: string, read: OpsEvidenceRead<unknown>): ReadinessItem => ({
  id, label, state: "READ ERROR", tone: "red",
  detail: read.error || "operator evidence could not be read; no absence claim is made",
});

const latest = <T>(rows: T[], at: (row: T) => string): T | null =>
  rows.reduce<T | null>((best, row) => !best || Date.parse(at(row)) > Date.parse(at(best)) ? row : best, null);

const releaseConfigItems = (events: MarketEvent[], readState: Day1ReleaseReadState): ReadinessItem[] => {
  const observed = observeDay1Release(events, readState);
  const releaseTone: ReadinessTone = observed.state === "verified" ? "green"
    : observed.state === "checking" ? "neutral" : observed.state === "read-error" ? "red" : "red";
  const meta = eventMeta(events);
  const held = object(meta?.heldCapture);
  const runtime = object(meta?.runtimeReadiness);
  const manager = object(meta?.managerShadow);
  const captureOk = observed.state === "verified"
    && held?.enabled === true && Number(held?.targetSamples) === 12 && Number(held?.maxAgeMs) === 60_000
    && runtime?.heldCaptureReady === true && runtime?.heldCaptureStartedBeforeBootDecision === true;
  const managerOk = observed.state === "verified" && manager?.enabled === true && Number(manager?.quoteMaxAgeMs) === 15_000;
  const paperOk = observed.state === "verified" && meta?.dryRun === true && meta?.liveTrading === false;
  return [
    { id: "release", label: "SEALED RELEASE", state: observed.state.replaceAll("-", " ").toUpperCase(), tone: releaseTone, detail: observed.fact, observedAt: observed.receipt?.createdAt },
    { id: "capture-config", label: "HELD CAPTURE", state: captureOk ? "CONFIGURED" : observed.state === "checking" ? "CHECKING" : "UNVERIFIED", tone: captureOk ? "green" : observed.state === "checking" ? "neutral" : "red", detail: captureOk ? "12 samples / 60s · runtime ready before boot decision" : "sealed capture settings or runtime-readiness receipt not observed" },
    { id: "manager-config", label: "MANAGER OBSERVER", state: managerOk ? "CONFIGURED" : observed.state === "checking" ? "CHECKING" : "UNVERIFIED", tone: managerOk ? "green" : observed.state === "checking" ? "neutral" : "red", detail: managerOk ? `${DAY1_MANAGER_ARMS.length} paper-only arms · quote max 15s` : "sealed manager-shadow settings not observed" },
    { id: "paper-boundary", label: "ORDER BOUNDARY", state: paperOk ? "PAPER / DRY RUN" : "UNVERIFIED", tone: paperOk ? "green" : "red", detail: paperOk ? "liveTrading=false · research writes only" : "paper-only startup boundary not established by the release receipt" },
  ];
};

export function deriveOpsReadiness(input: DeriveOpsReadinessInput): OpsReadinessModel {
  const clock = etParts(input.nowMs);
  const phase = clock.date < COHORT_FROM ? "before-cohort" : "session";
  const configuration = releaseConfigItems(input.releaseEvents, input.releaseReadState);
  const sentinel = deriveSentinelReceiptStatus(input.sentinel, input.nowMs);
  const expectedManagerArms = DAY1_MANAGER_ARMS.length;

  const execution = input.evidence.execution;
  const sessionExecutions = execution.state === "ok"
    ? execution.rows.filter((row) => row.event_at.slice(0, 10) === clock.date && candidateMeta(row))
    : [];
  const decisions = sessionExecutions.filter((row) => row.event_kind === "decision");
  const candidates = new Set(decisions.map((row) => row.opportunity_id ?? row.id)).size;
  const suppressed = decisions.filter((row) => Boolean(row.blocked_reason)).length;
  const fillRows = sessionExecutions.filter((row) => row.event_kind === "broker_result" && Number(row.filled_qty) > 0 && row.position_id);
  const fillsByPosition = new Map(fillRows.map((row) => [row.position_id as string, row]));
  const positionIds = new Set(fillsByPosition.keys());
  const oldestFillMs = Math.min(...[...fillsByPosition.values()].map((row) => Date.parse(row.event_at)), Number.POSITIVE_INFINITY);
  const captureDue = positionIds.size > 0 && input.nowMs - oldestFillMs > CAPTURE_GRACE_MS;
  const managerDue = positionIds.size > 0 && input.nowMs - oldestFillMs > MANAGER_GRACE_MS;

  const evidence: ReadinessItem[] = [];
  if (execution.state !== "ok") {
    evidence.push(execution.state === "error" ? readError("candidates", "CANDIDATE LEDGER", execution) : { id: "candidates", label: "CANDIDATE LEDGER", state: "CHECKING", tone: "neutral", detail: "reading current-session candidate provenance" });
  } else if (phase === "before-cohort") {
    evidence.push({ id: "candidates", label: "CANDIDATE LEDGER", state: "NOT DUE", tone: "neutral", detail: `RC5 cohort begins ${COHORT_FROM}; prior rows are excluded` });
  } else if (candidates === 0) {
    evidence.push({ id: "candidates", label: "CANDIDATE LEDGER", state: "WAITING", tone: "neutral", detail: "no RC5 candidate yet; trade absence is not a failure" });
  } else {
    evidence.push({ id: "candidates", label: "CANDIDATE LEDGER", state: "OBSERVED", tone: "green", detail: `${candidates} independent candidate${candidates === 1 ? "" : "s"} · ${suppressed} suppressed/censored` });
  }

  evidence.push({
    id: "fills", label: "AUTHORIZED FILLS",
    state: fillsByPosition.size ? "OBSERVED" : candidates ? "NONE YET" : "WAITING",
    tone: fillsByPosition.size ? "green" : "neutral",
    detail: fillsByPosition.size ? `${fillsByPosition.size} RC5 position${fillsByPosition.size === 1 ? "" : "s"} with positive filled quantity` : "a valid candidate may be suppressed; fill absence is not itself a fault",
  });

  const captures = input.evidence.captures;
  const captureHealth = input.evidence.captureHealth;
  const sessionReceipts = captures.state === "ok" ? captures.rows.filter((row) => row.session_date_et === clock.date && positionIds.has(row.position_id)) : [];
  const capturedPositions = new Set(sessionReceipts.map((row) => row.position_id)).size;
  const healthRows = captureHealth.state === "ok" ? captureHealth.rows.filter((row) => row.observed_at.slice(0, 10) === clock.date) : [];
  const highHealth = healthRows.find((row) => row.severity === "high");
  if (captures.state === "error") evidence.push(readError("capture", "HELD CAPTURE", captures));
  else if (captureHealth.state === "error") evidence.push(readError("capture", "HELD CAPTURE HEALTH", captureHealth));
  else if (highHealth) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "EVIDENCE GAP", tone: "red", detail: `${highHealth.code} · ${highHealth.affected_samples} affected samples`, observedAt: highHealth.observed_at });
  else if (healthRows.length) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "DEGRADED", tone: "yellow", detail: `${healthRows[0].code} · ${healthRows[0].affected_samples} affected samples`, observedAt: healthRows[0].observed_at });
  else if (!positionIds.size) evidence.push({ id: "capture", label: "HELD CAPTURE", state: "WAITING", tone: "neutral", detail: "capture proof becomes due only after an RC5 fill" });
  else if (capturedPositions === positionIds.size) {
    const samples = sessionReceipts.reduce((sum, row) => sum + Number(row.sample_count), 0);
    evidence.push({ id: "capture", label: "HELD CAPTURE", state: "OBSERVED", tone: "green", detail: `${capturedPositions}/${positionIds.size} positions · ${samples} samples receipted`, observedAt: latest(sessionReceipts, (row) => row.completed_at)?.completed_at });
  } else evidence.push({ id: "capture", label: "HELD CAPTURE", state: captureDue ? "MISSING RECEIPT" : "FLUSHING", tone: captureDue ? "yellow" : "neutral", detail: `${capturedPositions}/${positionIds.size} filled positions have a current-session receipt` });

  const managers = input.evidence.managers;
  const managerRows = managers.state === "ok" ? managers.rows.filter((row) => positionIds.has(row.position_id)) : [];
  const observedArms = new Set(managerRows.map((row) => `${row.position_id}:${row.manager_id}`));
  const expectedArms = positionIds.size * expectedManagerArms;
  if (managers.state === "error") evidence.push(readError("managers", "MANAGER ARMS", managers));
  else if (!positionIds.size) evidence.push({ id: "managers", label: "MANAGER ARMS", state: "WAITING", tone: "neutral", detail: `${expectedManagerArms} shadow arms become due after each RC5 fill` });
  else if (observedArms.size === expectedArms) evidence.push({ id: "managers", label: "MANAGER ARMS", state: "COMPLETE", tone: "green", detail: `${observedArms.size}/${expectedArms} position-arm receipts observed`, observedAt: latest(managerRows, (row) => row.last_observed_at ?? row.entry_at)?.last_observed_at ?? undefined });
  else evidence.push({ id: "managers", label: "MANAGER ARMS", state: managerDue ? "INCOMPLETE" : "STARTING", tone: managerDue ? "yellow" : "neutral", detail: `${observedArms.size}/${expectedArms} position-arm receipts observed` });

  const publisher = input.evidence.publisher;
  const latestPublisher = publisher.state === "ok" ? latest(publisher.rows, (row) => row.created_at) : null;
  const publisherFailed = latestPublisher?.message.includes("exited") ?? false;
  const publisherDone = latestPublisher?.message.includes("done") ?? false;
  const postClose = clock.minute >= 16 * 60;
  if (publisher.state === "error") evidence.push(readError("publisher", "POST-CLOSE PUBLISHER", publisher));
  else if (publisherFailed) evidence.push({ id: "publisher", label: "POST-CLOSE PUBLISHER", state: "FAILED", tone: "red", detail: latestPublisher?.message ?? "publisher failed", observedAt: latestPublisher?.created_at });
  else if (postClose && (candidates > 0 || fillsByPosition.size > 0) && (!publisherDone || latestPublisher?.created_at.slice(0, 10) !== clock.date)) evidence.push({ id: "publisher", label: "POST-CLOSE PUBLISHER", state: "DUE", tone: "yellow", detail: "current-session activity exists but no same-session completion receipt is observed" });
  else evidence.push({ id: "publisher", label: "POST-CLOSE PUBLISHER", state: publisherDone ? "LAST RUN OK" : "NOT DUE", tone: publisherDone ? "green" : "neutral", detail: publisherDone ? latestPublisher?.message ?? "publisher complete" : "publication is evaluated after the close", observedAt: latestPublisher?.created_at });

  evidence.push({ id: "sentinel", label: "SENTINEL RECEIPT", state: sentinel.label, tone: sentinel.tone, detail: sentinel.detail, observedAt: sentinel.publishedAt });
  evidence.push({ id: "reconciliation", label: "BROKER RECONCILIATION", state: "UNAVAILABLE", tone: "neutral", detail: `desk ${input.openPositions} open / ${input.closedPositions} closed · no broker-flat assertion` });

  const all = [...configuration, ...evidence];
  const red = all.filter((item) => item.tone === "red").length;
  const yellow = all.filter((item) => item.tone === "yellow").length;
  const summary: ReadinessItem = red
    ? { id: "summary", label: "DAY 1 EVIDENCE", state: "BLOCKED", tone: "red", detail: `${red} red · ${yellow} yellow · inspect evidence claims below` }
    : yellow
      ? { id: "summary", label: "DAY 1 EVIDENCE", state: "ATTENTION", tone: "yellow", detail: `${yellow} yellow · execution health remains a separate claim` }
      : { id: "summary", label: "DAY 1 EVIDENCE", state: phase === "before-cohort" ? "CONFIGURED" : "READY", tone: "green", detail: phase === "before-cohort" ? `sealed runtime configured · cohort begins ${COHORT_FROM}` : "all currently due evidence gates are observed" };

  return {
    sessionDateEt: clock.date, phase, summary, configuration, evidence,
    counts: { candidates, suppressed, fills: fillsByPosition.size, capturedPositions, managerArms: observedArms.size, expectedManagerArms: expectedArms },
  };
}
