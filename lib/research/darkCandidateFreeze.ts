// Pure, zero-I/O freezer for suppressed Day 1 entry decisions. It validates
// the signal policy stamp against the independent execution-observation row,
// retains every raw decision clock, and deduplicates only provider contract
// downloads. It deliberately does NOT declare independent trades: exit clocks
// differ by manager and must be resolved later from the exact CBBO path.

import { createHash } from "node:crypto";
import { sessionCloseMin } from "../../engine/market-calendar.js";
import { compactOccToDatabentoRaw, EXACT_OPTION_PATH_DATASET, EXACT_OPTION_PATH_SCHEMA } from "./databentoExactPath.js";
import { canonicalVbCandidateId } from "./vbCandidateEvidence.js";

export const DARK_CANDIDATE_FREEZE_SCHEMA_VERSION = 1 as const;
export const DARK_CANDIDATE_FREEZER_VERSION = "dark-candidate-freezer-v1" as const;
export const DARK_CANDIDATE_PATH_END_MINUTES_BEFORE_CLOSE = 5 as const;
export const DARK_CANDIDATE_REQUEST_PADDING_MS = 2_000 as const;
export const DARK_CANDIDATE_SIGNAL_EXECUTION_MAX_SKEW_MS = 5_000 as const;

export const RESEARCH_BLOCK_REASONS = [
  "day1_dark_lifecycle",
  "day1_reentry_disabled",
  "day1_spy_same_clock_collision",
  "halted",
  "not_armed",
  "cost_gate",
  "stale_chain",
] as const;
export type ResearchBlockReason = typeof RESEARCH_BLOCK_REASONS[number];

export interface DarkSignalEvidenceRow {
  id: string;
  strategistId: string;
  createdAt: string;
  blockedReason: string | null;
  direction: string | null;
  rationale: unknown;
}

export interface DarkExecutionEvidenceRow {
  id: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  opportunityId: string | null;
  eventKind: string;
  action: string;
  eventAt: string;
  sourceBarAt: string;
  blockedReason: string | null;
  underlying: string;
  occSymbol: string | null;
  optionSide: string | null;
  quoteSource: string | null;
  quoteAgeMs: number | null;
  ask: number | null;
}

export type DarkCandidateCensorCode =
  | "unsupported_block_reason"
  | "invalid_signal_identity"
  | "missing_source_bar_clock"
  | "missing_decision_observation_clock"
  | "missing_channel_version"
  | "missing_configuration_epoch"
  | "missing_manager_version"
  | "missing_source_version"
  | "missing_account_identity"
  | "session_date_mismatch"
  | "invalid_candidate_contract"
  | "missing_execution_observation"
  | "ambiguous_execution_observation"
  | "execution_identity_mismatch"
  | "missing_execution_opportunity_id"
  | "missing_live_ask_provenance"
  | "conflicting_canonical_candidate";

export interface DarkCandidateCensor {
  signalId: string;
  code: DarkCandidateCensorCode;
  fact: string;
}

export interface FrozenDarkCandidateDecision {
  schemaVersion: 1;
  candidateId: string;
  signalId: string;
  executionObservationId: string;
  executionOpportunityId: string;
  sessionDateEt: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  channelVersion: string;
  configurationEpochId: string;
  managerVersion: string;
  sourceVersion: string;
  sourceBarAt: string;
  decisionObservedAt: string;
  executionObservedAt: string;
  underlying: string;
  optionSide: "call" | "put";
  occSymbol: string;
  blockedReason: ResearchBlockReason;
  liveObservedAsk: number | null;
  liveAskFeed: "alpaca_snapshot";
  liveAskFreshnessMs: number | null;
  liveAskExact: false;
  independentOpportunityClaimed: false;
  managerSpecificReplayRequired: true;
  orderPathAuthorized: false;
}

export interface DarkCandidateContractRequest {
  requestId: string;
  sessionDateEt: string;
  dataset: typeof EXACT_OPTION_PATH_DATASET;
  schema: typeof EXACT_OPTION_PATH_SCHEMA;
  occSymbol: string;
  rawSymbol: string;
  startIso: string;
  endIso: string;
  candidateIds: string[];
  rawDecisionCount: number;
  estimatedMaximumOneSecondRows: number;
}

export interface DarkCandidateFreeze {
  schemaVersion: 1;
  freezerVersion: typeof DARK_CANDIDATE_FREEZER_VERSION;
  sessionDateEt: string;
  source: "supabase_select_only_signals_plus_execution_observations";
  sourceCounts: { signals: number; executionObservations: number };
  methodology: {
    independence: "raw_decisions_retained_no_independent_trade_claim";
    replay: "manager_specific_sequential_replay_after_exact_path";
    liveAskBasis: "alpaca_snapshot_non_exact_provenance_only";
    exactPathBasis: "databento_cbbo_1s_required";
    signalExecutionClockMaxSkewMs: 5000;
    externalWrites: false;
    orderPathAuthorized: false;
  };
  candidates: FrozenDarkCandidateDecision[];
  censors: DarkCandidateCensor[];
  contractRequests: DarkCandidateContractRequest[];
  summary: {
    validRawDecisions: number;
    censoredSignals: number;
    exactContracts: number;
    estimatedMaximumOneSecondRows: number;
    liveAskUnavailableDecisions: number;
    byBlockedReason: Record<string, number>;
    byChannel: Record<string, number>;
    byCensor: Record<string, number>;
  };
  canonicalSha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^sha256:[0-9a-f]{64}$/;
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const reasonSet = new Set<string>(RESEARCH_BLOCK_REASONS);

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function stableResearchJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableResearchJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableResearchJson(row[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableResearchJson(value)).digest("hex");
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizedIso(value: string): string {
  return new Date(value).toISOString();
}

function etWallMinuteToUtcMs(dateEt: string, minuteEt: number): number {
  const hour = Math.floor(minuteEt / 60);
  const minute = minuteEt % 60;
  const noon = new Date(`${dateEt}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(noon);
  const localHour = Number(parts.find((part) => part.type === "hour")?.value ?? "12") % 24;
  const localMinute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return Date.parse(`${dateEt}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`)
    + (12 * 60 - localHour * 60 - localMinute) * 60_000;
}

function signalMatchKey(strategistId: string, sourceBarAt: string, occSymbol: string, blockedReason: string): string {
  return `${strategistId}\u0000${sourceBarAt}\u0000${occSymbol}\u0000${blockedReason}`;
}

function censor(signalId: string, code: DarkCandidateCensorCode, fact: string): DarkCandidateCensor {
  return { signalId, code, fact };
}

interface ParsedSignal {
  row: DarkSignalEvidenceRow;
  rationale: Record<string, unknown>;
  blockedReason: ResearchBlockReason;
  sourceBarAt: string;
  decisionObservedAt: string;
  channelVersion: string;
  configurationEpochId: string;
  managerVersion: string;
  sourceVersion: string;
  accountId: string;
  underlying: string;
  side: "call" | "put";
  occSymbol: string;
}

function parseSignal(row: DarkSignalEvidenceRow): ParsedSignal | DarkCandidateCensor {
  if (!UUID.test(row.id) || !UUID.test(row.strategistId)) {
    return censor(row.id, "invalid_signal_identity", "signal or strategist id is not a UUID");
  }
  if (!row.blockedReason || !reasonSet.has(row.blockedReason)) {
    return censor(row.id, "unsupported_block_reason", String(row.blockedReason ?? "missing"));
  }
  const rationale = record(row.rationale);
  if (!rationale) return censor(row.id, "missing_source_bar_clock", "rationale object missing");
  const sourceBarAt = rationale.decision_source_bar_at;
  const decisionObservedAt = rationale.decision_observed_at;
  const channelVersion = rationale.channel_version;
  const configurationEpochId = rationale.configuration_epoch_id;
  const managerVersion = rationale.manager_version;
  const sourceVersion = rationale.worker_version;
  const accountId = rationale.account_id;
  const underlying = rationale.candidate_underlying;
  const side = rationale.candidate_side;
  const occSymbol = rationale.occ;
  if (!validIso(sourceBarAt)) return censor(row.id, "missing_source_bar_clock", String(sourceBarAt ?? "missing"));
  if (!validIso(decisionObservedAt)) return censor(row.id, "missing_decision_observation_clock", String(decisionObservedAt ?? "missing"));
  if (typeof channelVersion !== "string" || !SHA.test(channelVersion)) return censor(row.id, "missing_channel_version", String(channelVersion ?? "missing"));
  if (typeof configurationEpochId !== "string" || !SHA.test(configurationEpochId)) return censor(row.id, "missing_configuration_epoch", String(configurationEpochId ?? "missing"));
  if (typeof managerVersion !== "string" || !SHA.test(managerVersion)) return censor(row.id, "missing_manager_version", String(managerVersion ?? "missing"));
  if (typeof sourceVersion !== "string" || !sourceVersion) return censor(row.id, "missing_source_version", String(sourceVersion ?? "missing"));
  if (typeof accountId !== "string" || !UUID.test(accountId)) return censor(row.id, "missing_account_identity", String(accountId ?? "missing"));
  if (typeof underlying !== "string" || (side !== "call" && side !== "put") || row.direction !== side || typeof occSymbol !== "string"
      || canonicalVbCandidateId({ channelVersion, configurationEpochId, sourceBarAtMs: Date.parse(sourceBarAt), underlying, side, occSymbol }) == null) {
    return censor(row.id, "invalid_candidate_contract", `${String(underlying)} ${String(side)} ${String(occSymbol)}`);
  }
  return {
    row, rationale, blockedReason: row.blockedReason as ResearchBlockReason,
    sourceBarAt: normalizedIso(sourceBarAt), decisionObservedAt: normalizedIso(decisionObservedAt), channelVersion, configurationEpochId,
    managerVersion, sourceVersion, accountId, underlying, side, occSymbol,
  };
}

function candidateFrom(parsed: ParsedSignal, execution: DarkExecutionEvidenceRow): FrozenDarkCandidateDecision | DarkCandidateCensor {
  const { row } = parsed;
  const executionAtMs = validIso(execution.eventAt) ? Date.parse(execution.eventAt) : Number.NaN;
  const clockSkewMs = Math.abs(Date.parse(parsed.decisionObservedAt) - executionAtMs);
  if (!UUID.test(execution.id) || execution.eventKind !== "decision" || execution.action !== "enter"
      || execution.strategistId !== row.strategistId || execution.accountId !== parsed.accountId
      || !validIso(execution.sourceBarAt) || normalizedIso(execution.sourceBarAt) !== parsed.sourceBarAt || execution.blockedReason !== parsed.blockedReason
      || execution.underlying !== parsed.underlying || execution.occSymbol !== parsed.occSymbol
      || execution.optionSide !== parsed.side || execution.channelSlug.length === 0 || !validIso(execution.eventAt)
      || !Number.isFinite(clockSkewMs) || clockSkewMs > DARK_CANDIDATE_SIGNAL_EXECUTION_MAX_SKEW_MS) {
    const fact = Number.isFinite(clockSkewMs) && clockSkewMs > DARK_CANDIDATE_SIGNAL_EXECUTION_MAX_SKEW_MS
      ? `${execution.id} clock skew ${clockSkewMs}ms`
      : execution.id;
    return censor(row.id, "execution_identity_mismatch", fact);
  }
  if (!execution.opportunityId) return censor(row.id, "missing_execution_opportunity_id", execution.id);
  if (execution.quoteSource !== "alpaca_snapshot" || (execution.ask != null && (!Number.isFinite(execution.ask) || execution.ask < 0))
      || (execution.quoteAgeMs != null && (!Number.isFinite(execution.quoteAgeMs) || execution.quoteAgeMs < 0))) {
    return censor(row.id, "missing_live_ask_provenance", execution.id);
  }
  const candidateId = canonicalVbCandidateId({
    channelVersion: parsed.channelVersion,
    configurationEpochId: parsed.configurationEpochId,
    sourceBarAtMs: Date.parse(parsed.sourceBarAt),
    underlying: parsed.underlying,
    side: parsed.side,
    occSymbol: parsed.occSymbol,
  });
  if (!candidateId) return censor(row.id, "invalid_candidate_contract", parsed.occSymbol);
  return {
    schemaVersion: DARK_CANDIDATE_FREEZE_SCHEMA_VERSION,
    candidateId,
    signalId: row.id,
    executionObservationId: execution.id,
    executionOpportunityId: execution.opportunityId,
    sessionDateEt: ET_DATE.format(new Date(parsed.sourceBarAt)),
    strategistId: row.strategistId,
    accountId: parsed.accountId,
    channelSlug: execution.channelSlug,
    channelVersion: parsed.channelVersion,
    configurationEpochId: parsed.configurationEpochId,
    managerVersion: parsed.managerVersion,
    sourceVersion: parsed.sourceVersion,
    sourceBarAt: parsed.sourceBarAt,
    decisionObservedAt: parsed.decisionObservedAt,
    executionObservedAt: normalizedIso(execution.eventAt),
    underlying: parsed.underlying,
    optionSide: parsed.side,
    occSymbol: parsed.occSymbol,
    blockedReason: parsed.blockedReason,
    liveObservedAsk: execution.ask != null && execution.ask > 0 ? execution.ask : null,
    liveAskFeed: "alpaca_snapshot",
    liveAskFreshnessMs: execution.quoteAgeMs,
    liveAskExact: false,
    independentOpportunityClaimed: false,
    managerSpecificReplayRequired: true,
    orderPathAuthorized: false,
  };
}

function buildRequests(sessionDateEt: string, candidates: readonly FrozenDarkCandidateDecision[]): DarkCandidateContractRequest[] {
  const groups = new Map<string, FrozenDarkCandidateDecision[]>();
  for (const candidate of candidates) {
    const key = `${candidate.sessionDateEt}\u0000${candidate.occSymbol}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const closeMinute = sessionCloseMin(sessionDateEt) - DARK_CANDIDATE_PATH_END_MINUTES_BEFORE_CLOSE;
  const endMs = etWallMinuteToUtcMs(sessionDateEt, closeMinute) + DARK_CANDIDATE_REQUEST_PADDING_MS;
  return [...groups.values()].flatMap((rows) => {
    const first = rows[0];
    const rawSymbol = compactOccToDatabentoRaw(first.occSymbol, first.underlying);
    if (!rawSymbol) return [];
    const startMs = Math.min(...rows.map((row) => Date.parse(row.decisionObservedAt))) - DARK_CANDIDATE_REQUEST_PADDING_MS;
    const candidateIds = [...new Set(rows.map((row) => row.candidateId))].sort();
    const requestCore = { sessionDateEt, occSymbol: first.occSymbol, startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString(), candidateIds };
    return [{
      requestId: `dbreq:${sha256(requestCore)}`,
      sessionDateEt,
      dataset: EXACT_OPTION_PATH_DATASET,
      schema: EXACT_OPTION_PATH_SCHEMA,
      occSymbol: first.occSymbol,
      rawSymbol,
      startIso: requestCore.startIso,
      endIso: requestCore.endIso,
      candidateIds,
      rawDecisionCount: rows.length,
      estimatedMaximumOneSecondRows: Math.max(0, Math.ceil((endMs - startMs) / 1_000) + 1),
    }];
  }).sort((a, b) => a.occSymbol.localeCompare(b.occSymbol));
}

export function freezeDarkCandidates(input: {
  sessionDateEt: string;
  signals: readonly DarkSignalEvidenceRow[];
  executionObservations: readonly DarkExecutionEvidenceRow[];
}): DarkCandidateFreeze {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDateEt)) throw new Error("invalid session date");
  const executionsByKey = new Map<string, DarkExecutionEvidenceRow[]>();
  for (const row of input.executionObservations) {
    if (row.eventKind !== "decision" || row.action !== "enter" || !row.occSymbol || !row.blockedReason) continue;
    if (!validIso(row.sourceBarAt)) continue;
    const key = signalMatchKey(row.strategistId, normalizedIso(row.sourceBarAt), row.occSymbol, row.blockedReason);
    const group = executionsByKey.get(key) ?? [];
    group.push(row);
    executionsByKey.set(key, group);
  }
  const candidates: FrozenDarkCandidateDecision[] = [];
  const censors: DarkCandidateCensor[] = [];
  for (const signal of [...input.signals].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const parsed = parseSignal(signal);
    if ("code" in parsed) { censors.push(parsed); continue; }
    const key = signalMatchKey(signal.strategistId, parsed.sourceBarAt, parsed.occSymbol, parsed.blockedReason);
    const matches = executionsByKey.get(key) ?? [];
    if (matches.length === 0) { censors.push(censor(signal.id, "missing_execution_observation", key)); continue; }
    if (matches.length > 1) { censors.push(censor(signal.id, "ambiguous_execution_observation", `${matches.length} rows`)); continue; }
    const candidate = candidateFrom(parsed, matches[0]);
    if ("code" in candidate) censors.push(candidate);
    else if (candidate.sessionDateEt !== input.sessionDateEt) {
      censors.push(censor(signal.id, "session_date_mismatch", `${candidate.sessionDateEt} != ${input.sessionDateEt}`));
    } else candidates.push(candidate);
  }
  const byCandidate = new Map<string, FrozenDarkCandidateDecision[]>();
  for (const candidate of candidates) {
    const group = byCandidate.get(candidate.candidateId) ?? [];
    group.push(candidate);
    byCandidate.set(candidate.candidateId, group);
  }
  const conflictIds = new Set([...byCandidate.entries()].filter(([, rows]) => rows.length > 1).map(([id]) => id));
  const retained = candidates.filter((candidate) => {
    if (!conflictIds.has(candidate.candidateId)) return true;
    censors.push(censor(candidate.signalId, "conflicting_canonical_candidate", candidate.candidateId));
    return false;
  }).sort((a, b) => a.sourceBarAt.localeCompare(b.sourceBarAt) || a.candidateId.localeCompare(b.candidateId));
  const requests = buildRequests(input.sessionDateEt, retained);
  const core = {
    schemaVersion: DARK_CANDIDATE_FREEZE_SCHEMA_VERSION,
    freezerVersion: DARK_CANDIDATE_FREEZER_VERSION,
    sessionDateEt: input.sessionDateEt,
    source: "supabase_select_only_signals_plus_execution_observations" as const,
    sourceCounts: { signals: input.signals.length, executionObservations: input.executionObservations.length },
    methodology: {
      independence: "raw_decisions_retained_no_independent_trade_claim" as const,
      replay: "manager_specific_sequential_replay_after_exact_path" as const,
      liveAskBasis: "alpaca_snapshot_non_exact_provenance_only" as const,
      exactPathBasis: "databento_cbbo_1s_required" as const,
      signalExecutionClockMaxSkewMs: DARK_CANDIDATE_SIGNAL_EXECUTION_MAX_SKEW_MS,
      externalWrites: false as const,
      orderPathAuthorized: false as const,
    },
    candidates: retained,
    censors: censors.sort((a, b) => a.signalId.localeCompare(b.signalId) || a.code.localeCompare(b.code)),
    contractRequests: requests,
    summary: {
      validRawDecisions: retained.length,
      censoredSignals: censors.length,
      exactContracts: requests.length,
      estimatedMaximumOneSecondRows: requests.reduce((sum, request) => sum + request.estimatedMaximumOneSecondRows, 0),
      liveAskUnavailableDecisions: retained.filter((row) => row.liveObservedAsk == null).length,
      byBlockedReason: countBy(retained, (row) => row.blockedReason),
      byChannel: countBy(retained, (row) => row.channelSlug),
      byCensor: countBy(censors, (row) => row.code),
    },
  };
  return { ...core, canonicalSha256: sha256(core) };
}
