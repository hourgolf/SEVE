// Phase 1G-A pure durable shadow-book model. This file deliberately owns no
// database client, timer, quote request, broker read, or execution import.

import {
  MANAGER_IDS,
  MANAGER_POLICY_VERSION,
  advanceManager,
  managerIdsForChannel,
  type ManagerId,
  type ManagerState,
} from "../../engine/managerPolicy.js";
import { deterministicEvidenceUuid } from "./planShadowModel.js";
import { managerShadowTraceIdFor, SHADOW_MANAGER_COHORT_FROM } from "./managerShadowObservationModel.js";
import type { ExecutionObservationDraft } from "./executionObservationModel.js";

export const MANAGER_SHADOW_SCHEMA_VERSION = 2 as const;
// RC5.1 roots are intentionally two-lot. All-out arms model both contracts and
// BANK20/RUN50 models an executable 1/1 split, so two is the honest whole-lot
// floor. The former four-lot gate silently prevented every Day-1 root from
// enrolling in its required observer cohort.
export const MIN_MODELED_SOURCE_QTY = 2;
export const MIN_STAGED_SOURCE_QTY = 2;
export const MANAGER_SHADOW_BOOK_VERSION = "manager-shadow-book-v2" as const;
export const SHADOW_CUTOFF_MINUTES_BEFORE_CLOSE = 5;

export type ManagerShadowStatus = "active" | "terminal" | "censored";
export type ManagerEconomicMode = "whole_lot_executable" | "normalized_fractional";
export type EntryPriceBasis = "broker_fill" | "execution_observation";
export type ManagerAdmissionSource = "fill_hook" | "recovery_open" | "recovery_closed" | "hydration";
export type ManagerEvidenceState = "pending_quote" | "observing" | "no_eligible_quote_before_actual_close";

export interface ManagerAllocation {
  kind: "all_out" | "bank_runner";
  totalQty: number;
  exitQty: number;
  bankQty: number;
  runnerQty: number;
}

export interface ManagerShadowRun {
  id: string;
  schemaVersion: typeof MANAGER_SHADOW_SCHEMA_VERSION;
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
  optionSide: "call" | "put";
  managerId: ManagerId;
  managerPolicyVersion: typeof MANAGER_POLICY_VERSION;
  shadowBookVersion: typeof MANAGER_SHADOW_BOOK_VERSION;
  cohortFrom: string;
  quoteMaxAgeMs: number;
  cutoffMinutesBeforeClose: number;
  entryPrice: number;
  entryPriceBasis: EntryPriceBasis;
  entryAt: string;
  admissionSource: ManagerAdmissionSource;
  admittedAt: string;
  admissionDelayMs: number;
  firstQuoteAt: string | null;
  firstQuoteEventAgeMs: number | null;
  firstSnapshotFetchAgeMs: number | null;
  evidenceState: ManagerEvidenceState;
  originalQty: number;
  minimumModeledQty: number;
  economicMode: ManagerEconomicMode;
  allocation: ManagerAllocation;
  status: ManagerShadowStatus;
  managerState: ManagerState;
  peakReturnPct: number | null;
  bankReturnPct: number | null;
  lastBid: number | null;
  lastQuoteAt: string | null;
  lastObservedAt: string | null;
  consecutiveQuoteMisses: number;
  actualCloseAt: string | null;
  actualCloseReason: string | null;
  actualRealizedPnl: number | null;
  terminalAt: string | null;
  terminalBid: number | null;
  terminalReturnPct: number | null;
  terminalPnl: number | null;
  terminalTrigger: string | null;
  terminalQuoteAgeMs: number | null;
  censoredAt: string | null;
  censorCode: string | null;
  censorFact: string | null;
}

export interface ManagerShadowDbRow {
  id: string;
  schema_version: number;
  position_id: string;
  strategist_id: string;
  account_id: string;
  source_boot_id: string | null;
  terminal_boot_id: string | null;
  channel_slug: string;
  occ_symbol: string;
  underlying: string;
  option_side: string;
  manager_id: string;
  manager_policy_version: string;
  shadow_book_version: string;
  cohort_from: string;
  quote_max_age_ms: number;
  cutoff_minutes_before_close: number;
  entry_price: number;
  entry_price_basis: string;
  entry_at: string;
  admission_source: string | null;
  admitted_at: string | null;
  admission_delay_ms: number | null;
  first_quote_at: string | null;
  first_quote_event_age_ms: number | null;
  first_snapshot_fetch_age_ms: number | null;
  evidence_state: string | null;
  original_qty: number;
  minimum_modeled_qty: number;
  economic_mode: string;
  allocation: unknown;
  status: string;
  manager_state: unknown;
  peak_return_pct: number | null;
  bank_return_pct: number | null;
  last_bid: number | null;
  last_quote_at: string | null;
  last_observed_at: string | null;
  consecutive_quote_misses: number;
  actual_close_at: string | null;
  actual_close_reason: string | null;
  actual_realized_pnl: number | null;
  terminal_at: string | null;
  terminal_bid: number | null;
  terminal_return_pct: number | null;
  terminal_pnl: number | null;
  terminal_trigger: string | null;
  terminal_quote_age_ms: number | null;
  censored_at: string | null;
  censor_code: string | null;
  censor_fact: string | null;
}

export interface ManagerEnrollmentInput {
  positionId: string;
  strategistId: string;
  accountId: string;
  channelSlug: string;
  occSymbol: string;
  underlying: string;
  optionSide: "call" | "put";
  entryPrice: number;
  entryPriceBasis: EntryPriceBasis;
  entryAt: string;
  admissionSource: ManagerAdmissionSource;
  admittedAt: string;
  originalQty: number;
  quoteMaxAgeMs: number;
  paperMode: boolean;
}

export interface ManagerQuoteTick {
  bid: number;
  ask: number;
  quoteAtMs: number;
  observedAtMs: number;
  snapshotFetchedAtMs: number;
  isBell: boolean;
}

export type ManagerAdvanceResult =
  | { kind: "skipped"; reason: "not_active" | "invalid_quote" | "crossed_quote" | "future_quote" | "stale_quote" | "out_of_order_quote"; run: ManagerShadowRun }
  | { kind: "advanced" | "terminal"; run: ManagerShadowRun };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const iso = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const rounded = (n: number): number => Math.round(n * 10_000) / 10_000;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isManagerId = (v: unknown): v is ManagerId => typeof v === "string" && (MANAGER_IDS as readonly string[]).includes(v);

export function managerShadowRunId(positionId: string, managerId: ManagerId): string {
  return deterministicEvidenceUuid("seve-manager-shadow-run-v2", {
    positionId,
    managerId,
    managerPolicyVersion: MANAGER_POLICY_VERSION,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
  });
}

export function managerShadowTerminalObservationId(positionId: string, managerId: ManagerId): string {
  return deterministicEvidenceUuid("seve-manager-shadow-book-exit-v2", {
    runId: managerShadowRunId(positionId, managerId),
  });
}

export function managerAllocation(originalQty: number, managerId: ManagerId): ManagerAllocation | null {
  if (!Number.isInteger(originalQty) || originalQty < 1) return null;
  if (managerId !== "BANK20/RUN50"
      && managerId !== "PB2-BANK15/HALF-GIVEBACK"
      && managerId !== "GRIND-B25/CURRENT-A13") {
    return { kind: "all_out", totalQty: originalQty, exitQty: originalQty, bankQty: 0, runnerQty: 0 };
  }
  if (originalQty === 1) {
    return { kind: "bank_runner", totalQty: 1, exitQty: 0, bankQty: 0.5, runnerQty: 0.5 };
  }
  const bankQty = Math.floor(originalQty / 2);
  return {
    kind: "bank_runner",
    totalQty: originalQty,
    exitQty: 0,
    bankQty,
    runnerQty: originalQty - bankQty,
  };
}

export function minimumModeledQty(managerId: ManagerId): number {
  return managerId === "PB2-BANK15/HALF-GIVEBACK" ? MIN_STAGED_SOURCE_QTY : MIN_MODELED_SOURCE_QTY;
}

export function managerEnrollmentEligible(channelSlug: string, originalQty: number): boolean {
  return Number.isInteger(originalQty) && originalQty >= 1
    && managerIdsForChannel(channelSlug).some((managerId) => originalQty >= minimumModeledQty(managerId));
}

export function managerEconomicMode(allocation: ManagerAllocation): ManagerEconomicMode {
  return Number.isInteger(allocation.bankQty) && Number.isInteger(allocation.runnerQty)
    ? "whole_lot_executable"
    : "normalized_fractional";
}

function enrollmentValid(input: ManagerEnrollmentInput): boolean {
  return input.paperMode
    && UUID.test(input.positionId) && UUID.test(input.strategistId) && UUID.test(input.accountId)
    && !!input.channelSlug && !!input.occSymbol && !!input.underlying
    && finite(input.entryPrice) && input.entryPrice > 0
    && Number.isInteger(input.originalQty) && input.originalQty >= 1
    && Number.isInteger(input.quoteMaxAgeMs) && input.quoteMaxAgeMs > 0
    && iso(input.entryAt) != null && iso(input.admittedAt) != null
    && ["fill_hook", "recovery_open", "recovery_closed", "hydration"].includes(input.admissionSource);
}

export function buildManagerShadowEnrollments(input: ManagerEnrollmentInput): ManagerShadowRun[] {
  if (!enrollmentValid(input)) return [];
  const entryAt = iso(input.entryAt) as string;
  const admittedAt = iso(input.admittedAt) as string;
  const admissionDelayMs = Math.max(0, Date.parse(admittedAt) - Date.parse(entryAt));
  return managerIdsForChannel(input.channelSlug)
    .filter((managerId) => input.originalQty >= minimumModeledQty(managerId))
    .map((managerId) => {
    const allocation = managerAllocation(input.originalQty, managerId) as ManagerAllocation;
    return {
      id: managerShadowRunId(input.positionId, managerId),
      schemaVersion: MANAGER_SHADOW_SCHEMA_VERSION,
      positionId: input.positionId,
      strategistId: input.strategistId,
      accountId: input.accountId,
      channelSlug: input.channelSlug,
      occSymbol: input.occSymbol,
      underlying: input.underlying.toUpperCase(),
      optionSide: input.optionSide,
      managerId,
      managerPolicyVersion: MANAGER_POLICY_VERSION,
      shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION,
      cohortFrom: new Date(SHADOW_MANAGER_COHORT_FROM).toISOString(),
      quoteMaxAgeMs: input.quoteMaxAgeMs,
      cutoffMinutesBeforeClose: SHADOW_CUTOFF_MINUTES_BEFORE_CLOSE,
      entryPrice: rounded(input.entryPrice),
      entryPriceBasis: input.entryPriceBasis,
      entryAt,
      admissionSource: input.admissionSource,
      admittedAt,
      admissionDelayMs,
      firstQuoteAt: null,
      firstQuoteEventAgeMs: null,
      firstSnapshotFetchAgeMs: null,
      evidenceState: "pending_quote",
      originalQty: input.originalQty,
      minimumModeledQty: minimumModeledQty(managerId),
      economicMode: managerEconomicMode(allocation),
      allocation,
      status: "active",
      managerState: {},
      peakReturnPct: null,
      bankReturnPct: null,
      lastBid: null,
      lastQuoteAt: null,
      lastObservedAt: null,
      consecutiveQuoteMisses: 0,
      actualCloseAt: null,
      actualCloseReason: null,
      actualRealizedPnl: null,
      terminalAt: null,
      terminalBid: null,
      terminalReturnPct: null,
      terminalPnl: null,
      terminalTrigger: null,
      terminalQuoteAgeMs: null,
      censoredAt: null,
      censorCode: null,
      censorFact: null,
    };
  });
}

export function quantityWeightedReturnPct(
  run: Pick<ManagerShadowRun, "managerId" | "allocation">,
  state: ManagerState,
  currentReturnPct: number,
): number | null {
  if (!finite(currentReturnPct)) return null;
  if (run.managerId !== "BANK20/RUN50"
      && run.managerId !== "PB2-BANK15/HALF-GIVEBACK"
      && run.managerId !== "GRIND-B25/CURRENT-A13")
    return rounded(currentReturnPct);
  if (!finite(state.bankReturnPct) || state.bankReturnPct == null) return rounded(currentReturnPct);
  const { totalQty, bankQty, runnerQty } = run.allocation;
  if (!(totalQty > 0) || bankQty < 0 || runnerQty < 0 || bankQty + runnerQty !== totalQty) return null;
  return rounded(((state.bankReturnPct * bankQty) + (currentReturnPct * runnerQty)) / totalQty);
}

export function managerPnl(entryPrice: number, originalQty: number, returnPct: number): number | null {
  if (!(entryPrice > 0) || !Number.isInteger(originalQty) || originalQty < 1 || !finite(returnPct)) return null;
  return rounded(entryPrice * 100 * originalQty * (returnPct / 100));
}

export function buildManagerShadowTerminalObservation(run: ManagerShadowRun): ExecutionObservationDraft | null {
  if (run.status !== "terminal" || run.terminalAt == null || run.terminalBid == null
      || run.terminalReturnPct == null || run.terminalPnl == null || run.terminalTrigger == null
      || run.terminalQuoteAgeMs == null) return null;
  const currentReturnPct = rounded(((run.terminalBid / run.entryPrice) - 1) * 100);
  const expectedReturn = quantityWeightedReturnPct(run, run.managerState, currentReturnPct);
  const expectedPnl = expectedReturn == null ? null : managerPnl(run.entryPrice, run.originalQty, expectedReturn);
  if (run.id !== managerShadowRunId(run.positionId, run.managerId)
      || expectedReturn !== run.terminalReturnPct || expectedPnl !== run.terminalPnl
      || run.economicMode !== managerEconomicMode(run.allocation)) return null;
  const traceId = managerShadowTraceIdFor(run.positionId, run.managerId);
  const heldMs = Date.parse(run.terminalAt) - Date.parse(run.entryAt);
  if (!finite(heldMs) || heldMs < 0) return null;
  return {
    id: managerShadowTerminalObservationId(run.positionId, run.managerId),
    trace_id: traceId,
    schema_version: 1,
    event_kind: "decision",
    event_at: run.terminalAt,
    source_bar_at: run.terminalAt,
    strategist_id: run.strategistId,
    account_id: run.accountId,
    channel_slug: run.channelSlug,
    opportunity_id: null,
    position_id: run.positionId,
    action: "exit",
    reason: `${run.managerId}:${run.terminalTrigger}`,
    blocked_reason: "observation_only",
    underlying: run.underlying,
    occ_symbol: run.occSymbol,
    option_side: run.optionSide,
    quote_source: "alpaca_snapshot",
    quote_age_ms: run.terminalQuoteAgeMs,
    bid: run.terminalBid,
    ask: null,
    mid: null,
    delta: null,
    underlying_price: null,
    requested_qty: null,
    client_order_id: null,
    broker_order_id: null,
    broker_status: null,
    filled_qty: null,
    fill_price: null,
    channel_spec_version_id: null,
    release_manifest_id: null,
    configuration_epoch_id: null,
    payload: {
      shadowOnly: true,
      durableShadowBook: true,
      managerId: run.managerId,
      managerPolicyVersion: run.managerPolicyVersion,
      shadowBookVersion: run.shadowBookVersion,
      quoteMaxAgeMs: run.quoteMaxAgeMs,
      cutoffMinutesBeforeClose: run.cutoffMinutesBeforeClose,
      trigger: run.terminalTrigger,
      counterfactualReturnPct: run.terminalReturnPct,
      counterfactualPnl: run.terminalPnl,
      observedBid: run.terminalBid,
      entryPrice: run.entryPrice,
      entryPriceBasis: run.entryPriceBasis,
      admissionSource: run.admissionSource,
      admittedAt: run.admittedAt,
      admissionDelayMs: run.admissionDelayMs,
      firstQuoteAt: run.firstQuoteAt,
      firstQuoteEventAgeMs: run.firstQuoteEventAgeMs,
      firstSnapshotFetchAgeMs: run.firstSnapshotFetchAgeMs,
      evidenceState: run.evidenceState,
      originalQty: run.originalQty,
      minimumModeledQty: run.minimumModeledQty,
      economicMode: run.economicMode,
      allocation: run.allocation,
      peakReturnPct: run.peakReturnPct,
      bankReturnPct: run.bankReturnPct,
      minutesHeld: rounded(heldMs / 60_000),
      managerState: run.managerState,
      actualCloseAt: run.actualCloseAt,
      actualCloseReason: run.actualCloseReason,
      actualRealizedPnl: run.actualRealizedPnl,
      cohortFrom: run.cohortFrom,
      evidenceBasis: "executable_bid",
    },
  };
}

export function advanceManagerShadowRun(run: ManagerShadowRun, tick: ManagerQuoteTick): ManagerAdvanceResult {
  if (run.status !== "active") return { kind: "skipped", reason: "not_active", run };
  if (!finite(tick.bid) || !finite(tick.ask) || tick.bid <= 0 || tick.ask <= 0
      || !finite(tick.quoteAtMs) || !finite(tick.observedAtMs) || !finite(tick.snapshotFetchedAtMs))
    return { kind: "skipped", reason: "invalid_quote", run };
  if (tick.ask < tick.bid) return { kind: "skipped", reason: "crossed_quote", run };
  if (tick.quoteAtMs > tick.observedAtMs) return { kind: "skipped", reason: "future_quote", run };
  if (tick.quoteAtMs < Date.parse(run.entryAt)) return { kind: "skipped", reason: "invalid_quote", run };
  if (run.lastQuoteAt != null && tick.quoteAtMs <= Date.parse(run.lastQuoteAt))
    return { kind: "skipped", reason: "out_of_order_quote", run };
  const quoteAgeMs = Math.round(tick.observedAtMs - tick.quoteAtMs);
  const maxAge = run.quoteMaxAgeMs;
  if (!finite(maxAge) || maxAge < 0 || quoteAgeMs > maxAge)
    return { kind: "skipped", reason: "stale_quote", run };

  const currentReturnPct = rounded(((tick.bid / run.entryPrice) - 1) * 100);
  const advanced = advanceManager(run.managerId, run.managerState, currentReturnPct, tick.isBell);
  const peakReturnPct = run.peakReturnPct == null ? currentReturnPct : Math.max(run.peakReturnPct, currentReturnPct);
  const observed: ManagerShadowRun = {
    ...run,
    // A quote first seen after the actual position closed may continue the
    // observation-only path, but it can never repair the missing pre-close
    // comparison. Preserve that boundary for every later transition.
    evidenceState: run.evidenceState === "no_eligible_quote_before_actual_close"
      ? run.evidenceState
      : "observing",
    firstQuoteAt: run.firstQuoteAt ?? new Date(tick.quoteAtMs).toISOString(),
    firstQuoteEventAgeMs: run.firstQuoteEventAgeMs ?? quoteAgeMs,
    firstSnapshotFetchAgeMs: run.firstSnapshotFetchAgeMs
      ?? Math.max(0, Math.round(tick.observedAtMs - tick.snapshotFetchedAtMs)),
    managerState: advanced.state,
    peakReturnPct: rounded(peakReturnPct),
    bankReturnPct: advanced.state.bankReturnPct != null ? rounded(advanced.state.bankReturnPct) : run.bankReturnPct,
    lastBid: rounded(tick.bid),
    lastQuoteAt: new Date(tick.quoteAtMs).toISOString(),
    lastObservedAt: new Date(tick.observedAtMs).toISOString(),
    consecutiveQuoteMisses: 0,
  };
  if (!advanced.exit) return { kind: "advanced", run: observed };

  const terminalReturnPct = quantityWeightedReturnPct(observed, advanced.state, currentReturnPct);
  const terminalPnl = terminalReturnPct == null ? null : managerPnl(run.entryPrice, run.originalQty, terminalReturnPct);
  if (terminalReturnPct == null || terminalPnl == null)
    return { kind: "skipped", reason: "invalid_quote", run };
  return {
    kind: "terminal",
    run: {
      ...observed,
      status: "terminal",
      terminalAt: new Date(tick.quoteAtMs).toISOString(),
      terminalBid: rounded(tick.bid),
      terminalReturnPct,
      terminalPnl,
      terminalTrigger: advanced.exit.reason,
      terminalQuoteAgeMs: quoteAgeMs,
    },
  };
}

export function recordManagerQuoteMiss(run: ManagerShadowRun): ManagerShadowRun {
  return run.status === "active"
    ? { ...run, consecutiveQuoteMisses: run.consecutiveQuoteMisses + 1 }
    : run;
}

export function attachActualClose(
  run: ManagerShadowRun,
  input: { atMs: number; reason: string; realizedPnl: number },
): ManagerShadowRun {
  if (run.actualCloseAt != null || !finite(input.atMs) || !input.reason || !finite(input.realizedPnl)) return run;
  const at = new Date(input.atMs);
  return Number.isNaN(at.getTime()) || at.getTime() < Date.parse(run.entryAt) ? run : {
    ...run,
    evidenceState: run.firstQuoteAt == null ? "no_eligible_quote_before_actual_close" : run.evidenceState,
    actualCloseAt: at.toISOString(),
    actualCloseReason: input.reason,
    actualRealizedPnl: rounded(input.realizedPnl),
  };
}

export function censorManagerShadowRun(
  run: ManagerShadowRun,
  input: { atMs: number; code: string; fact?: string | null },
): ManagerShadowRun {
  if (run.status !== "active" || !finite(input.atMs) || !input.code) return run;
  const at = new Date(input.atMs);
  return Number.isNaN(at.getTime()) || at.getTime() < Date.parse(run.entryAt) ? run : {
    ...run,
    status: "censored",
    censoredAt: at.toISOString(),
    censorCode: input.code,
    censorFact: input.fact ?? null,
  };
}

export function encodeManagerShadowRun(
  run: ManagerShadowRun,
  boot: { sourceBootId: string | null; terminalBootId?: string | null },
): ManagerShadowDbRow | null {
  if (!decodeManagerShadowRun({
    id: run.id, schema_version: run.schemaVersion, position_id: run.positionId,
    strategist_id: run.strategistId, account_id: run.accountId,
    source_boot_id: boot.sourceBootId, terminal_boot_id: boot.terminalBootId ?? null,
    channel_slug: run.channelSlug, occ_symbol: run.occSymbol, underlying: run.underlying,
    option_side: run.optionSide, manager_id: run.managerId,
    manager_policy_version: run.managerPolicyVersion, shadow_book_version: run.shadowBookVersion,
    cohort_from: run.cohortFrom, quote_max_age_ms: run.quoteMaxAgeMs,
    cutoff_minutes_before_close: run.cutoffMinutesBeforeClose,
    entry_price: run.entryPrice, entry_price_basis: run.entryPriceBasis, entry_at: run.entryAt,
    admission_source: run.admissionSource, admitted_at: run.admittedAt,
    admission_delay_ms: run.admissionDelayMs, first_quote_at: run.firstQuoteAt,
    first_quote_event_age_ms: run.firstQuoteEventAgeMs,
    first_snapshot_fetch_age_ms: run.firstSnapshotFetchAgeMs, evidence_state: run.evidenceState,
    original_qty: run.originalQty, minimum_modeled_qty: run.minimumModeledQty,
    economic_mode: run.economicMode, allocation: run.allocation, status: run.status,
    manager_state: run.managerState, peak_return_pct: run.peakReturnPct,
    bank_return_pct: run.bankReturnPct, last_bid: run.lastBid, last_quote_at: run.lastQuoteAt,
    last_observed_at: run.lastObservedAt, consecutive_quote_misses: run.consecutiveQuoteMisses,
    actual_close_at: run.actualCloseAt, actual_close_reason: run.actualCloseReason,
    actual_realized_pnl: run.actualRealizedPnl, terminal_at: run.terminalAt,
    terminal_bid: run.terminalBid, terminal_return_pct: run.terminalReturnPct,
    terminal_pnl: run.terminalPnl, terminal_trigger: run.terminalTrigger,
    terminal_quote_age_ms: run.terminalQuoteAgeMs, censored_at: run.censoredAt,
    censor_code: run.censorCode, censor_fact: run.censorFact,
  })) return null;
  return {
    id: run.id, schema_version: run.schemaVersion, position_id: run.positionId,
    strategist_id: run.strategistId, account_id: run.accountId,
    source_boot_id: boot.sourceBootId, terminal_boot_id: boot.terminalBootId ?? null,
    channel_slug: run.channelSlug, occ_symbol: run.occSymbol, underlying: run.underlying,
    option_side: run.optionSide, manager_id: run.managerId,
    manager_policy_version: run.managerPolicyVersion, shadow_book_version: run.shadowBookVersion,
    cohort_from: run.cohortFrom, quote_max_age_ms: run.quoteMaxAgeMs,
    cutoff_minutes_before_close: run.cutoffMinutesBeforeClose,
    entry_price: run.entryPrice, entry_price_basis: run.entryPriceBasis, entry_at: run.entryAt,
    admission_source: run.admissionSource, admitted_at: run.admittedAt,
    admission_delay_ms: run.admissionDelayMs, first_quote_at: run.firstQuoteAt,
    first_quote_event_age_ms: run.firstQuoteEventAgeMs,
    first_snapshot_fetch_age_ms: run.firstSnapshotFetchAgeMs, evidence_state: run.evidenceState,
    original_qty: run.originalQty, minimum_modeled_qty: run.minimumModeledQty,
    economic_mode: run.economicMode, allocation: run.allocation, status: run.status,
    manager_state: run.managerState, peak_return_pct: run.peakReturnPct,
    bank_return_pct: run.bankReturnPct, last_bid: run.lastBid, last_quote_at: run.lastQuoteAt,
    last_observed_at: run.lastObservedAt, consecutive_quote_misses: run.consecutiveQuoteMisses,
    actual_close_at: run.actualCloseAt, actual_close_reason: run.actualCloseReason,
    actual_realized_pnl: run.actualRealizedPnl, terminal_at: run.terminalAt,
    terminal_bid: run.terminalBid, terminal_return_pct: run.terminalReturnPct,
    terminal_pnl: run.terminalPnl, terminal_trigger: run.terminalTrigger,
    terminal_quote_age_ms: run.terminalQuoteAgeMs, censored_at: run.censoredAt,
    censor_code: run.censorCode, censor_fact: run.censorFact,
  };
}

function allocationFrom(value: unknown, qty: number, managerId: ManagerId): ManagerAllocation | null {
  if (!isRecord(value)) return null;
  const expected = managerAllocation(qty, managerId);
  if (!expected) return null;
  return value.kind === expected.kind && value.totalQty === expected.totalQty
    && value.exitQty === expected.exitQty && value.bankQty === expected.bankQty
    && value.runnerQty === expected.runnerQty ? expected : null;
}

function stateFrom(value: unknown): ManagerState | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(["bankReturnPct", "armedPeakPct", "recovered"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (value.bankReturnPct != null && !finite(value.bankReturnPct)) return null;
  if (value.armedPeakPct != null && !finite(value.armedPeakPct)) return null;
  if (value.recovered != null && typeof value.recovered !== "boolean") return null;
  return { ...value } as ManagerState;
}

export function decodeManagerShadowRun(row: ManagerShadowDbRow): ManagerShadowRun | null {
  if (!UUID.test(row.id) || !UUID.test(row.position_id) || !UUID.test(row.strategist_id) || !UUID.test(row.account_id)
      || row.source_boot_id == null || !UUID.test(row.source_boot_id)
      || (row.terminal_boot_id != null && !UUID.test(row.terminal_boot_id))
      || row.schema_version !== MANAGER_SHADOW_SCHEMA_VERSION || !isManagerId(row.manager_id)
      || row.manager_policy_version !== MANAGER_POLICY_VERSION || row.shadow_book_version !== MANAGER_SHADOW_BOOK_VERSION
      || !Number.isInteger(row.quote_max_age_ms) || row.quote_max_age_ms <= 0
      || row.cutoff_minutes_before_close !== SHADOW_CUTOFF_MINUTES_BEFORE_CLOSE
      || !row.channel_slug || !row.occ_symbol || !row.underlying
      || (row.option_side !== "call" && row.option_side !== "put")
      || !(row.entry_price > 0) || (row.entry_price_basis !== "broker_fill" && row.entry_price_basis !== "execution_observation")
      || !["fill_hook", "recovery_open", "recovery_closed", "hydration"].includes(row.admission_source ?? "")
      || !Number.isInteger(row.admission_delay_ms) || (row.admission_delay_ms as number) < 0
      || !["pending_quote", "observing", "no_eligible_quote_before_actual_close"].includes(row.evidence_state ?? "")
      || !Number.isInteger(row.original_qty) || row.original_qty < 1
      || row.minimum_modeled_qty !== minimumModeledQty(row.manager_id)
      || (row.economic_mode !== "whole_lot_executable" && row.economic_mode !== "normalized_fractional")
      || (row.status !== "active" && row.status !== "terminal" && row.status !== "censored")
      || !Number.isInteger(row.consecutive_quote_misses) || row.consecutive_quote_misses < 0) return null;
  const entryAt = iso(row.entry_at), admittedAt = iso(row.admitted_at), cohortFrom = iso(row.cohort_from), allocation = allocationFrom(row.allocation, row.original_qty, row.manager_id);
  const managerState = stateFrom(row.manager_state);
  if (!entryAt || !admittedAt || !cohortFrom || !allocation || !managerState || managerEconomicMode(allocation) !== row.economic_mode) return null;
  if (Math.max(0, Date.parse(admittedAt) - Date.parse(entryAt)) !== row.admission_delay_ms) return null;
  const dateFields = [row.first_quote_at, row.last_quote_at, row.last_observed_at, row.actual_close_at, row.terminal_at, row.censored_at];
  if (dateFields.some((value) => value != null && iso(value) == null)) return null;
  const numericNullable = [row.first_quote_event_age_ms, row.first_snapshot_fetch_age_ms,
    row.peak_return_pct, row.bank_return_pct, row.last_bid, row.actual_realized_pnl,
    row.terminal_bid, row.terminal_return_pct, row.terminal_pnl, row.terminal_quote_age_ms];
  if (numericNullable.some((value) => value != null && !finite(value))) return null;
  if ((row.first_quote_event_age_ms != null && (!Number.isInteger(row.first_quote_event_age_ms) || row.first_quote_event_age_ms < 0))
      || (row.first_snapshot_fetch_age_ms != null && (!Number.isInteger(row.first_snapshot_fetch_age_ms) || row.first_snapshot_fetch_age_ms < 0))
      || (row.last_bid != null && row.last_bid <= 0) || (row.terminal_bid != null && row.terminal_bid <= 0)
      || (row.terminal_quote_age_ms != null && (!Number.isInteger(row.terminal_quote_age_ms) || row.terminal_quote_age_ms < 0))) return null;
  const activeClean = row.status === "active" && row.terminal_at == null && row.terminal_bid == null
    && row.terminal_return_pct == null && row.terminal_pnl == null && row.terminal_trigger == null
    && row.terminal_quote_age_ms == null && row.censored_at == null && row.censor_code == null && row.censor_fact == null;
  const terminalComplete = row.status === "terminal" && row.terminal_at != null && row.terminal_bid != null
    && row.terminal_return_pct != null && row.terminal_pnl != null && !!row.terminal_trigger
    && row.terminal_quote_age_ms != null && row.last_quote_at != null
    && Date.parse(row.last_quote_at) === Date.parse(row.terminal_at)
    && row.last_bid === row.terminal_bid && row.last_observed_at != null
    && row.censored_at == null && row.censor_code == null && row.censor_fact == null;
  const censoredComplete = row.status === "censored" && row.censored_at != null && !!row.censor_code
    && row.terminal_at == null && row.terminal_bid == null && row.terminal_return_pct == null
    && row.terminal_pnl == null && row.terminal_trigger == null && row.terminal_quote_age_ms == null;
  if (!activeClean && !terminalComplete && !censoredComplete) return null;
  if ((row.status === "terminal") !== (row.terminal_boot_id != null)) return null;
  const actualAllNull = row.actual_close_at == null && row.actual_close_reason == null && row.actual_realized_pnl == null;
  const actualComplete = row.actual_close_at != null && !!row.actual_close_reason && row.actual_realized_pnl != null;
  if (!actualAllNull && !actualComplete) return null;
  const firstQuoteAllNull = row.first_quote_at == null && row.first_quote_event_age_ms == null && row.first_snapshot_fetch_age_ms == null;
  const firstQuoteComplete = row.first_quote_at != null && row.first_quote_event_age_ms != null && row.first_snapshot_fetch_age_ms != null;
  if (!firstQuoteAllNull && !firstQuoteComplete) return null;
  if ((row.evidence_state === "pending_quote") !== firstQuoteAllNull && row.evidence_state !== "no_eligible_quote_before_actual_close") return null;
  if (row.evidence_state === "no_eligible_quote_before_actual_close") {
    if (row.actual_close_at == null) return null;
    if (row.first_quote_at != null && Date.parse(row.first_quote_at) < Date.parse(row.actual_close_at)) return null;
  }
  if (row.last_quote_at != null && Date.parse(row.last_quote_at) < Date.parse(entryAt)) return null;
  if (row.actual_close_at != null && Date.parse(row.actual_close_at) < Date.parse(entryAt)) return null;
  if (row.censored_at != null && Date.parse(row.censored_at) < Date.parse(entryAt)) return null;
  if (row.economic_mode === "whole_lot_executable" && row.original_qty < row.minimum_modeled_qty) return null;
  if ((managerState.bankReturnPct ?? null) !== row.bank_return_pct) return null;
  if (row.status === "terminal") {
    const currentReturnPct = rounded(((row.terminal_bid as number) / row.entry_price - 1) * 100);
    const expectedReturn = quantityWeightedReturnPct({ managerId: row.manager_id, allocation }, managerState, currentReturnPct);
    const expectedPnl = expectedReturn == null ? null : managerPnl(row.entry_price, row.original_qty, expectedReturn);
    if (expectedReturn !== row.terminal_return_pct || expectedPnl !== row.terminal_pnl) return null;
  }
  const expectedId = managerShadowRunId(row.position_id, row.manager_id);
  if (row.id !== expectedId) return null;
  return {
    id: row.id, schemaVersion: MANAGER_SHADOW_SCHEMA_VERSION, positionId: row.position_id,
    strategistId: row.strategist_id, accountId: row.account_id, channelSlug: row.channel_slug,
    occSymbol: row.occ_symbol, underlying: row.underlying, optionSide: row.option_side,
    managerId: row.manager_id, managerPolicyVersion: MANAGER_POLICY_VERSION,
    shadowBookVersion: MANAGER_SHADOW_BOOK_VERSION, cohortFrom, quoteMaxAgeMs: row.quote_max_age_ms,
    cutoffMinutesBeforeClose: row.cutoff_minutes_before_close,
    entryPrice: row.entry_price, entryPriceBasis: row.entry_price_basis, entryAt,
    admissionSource: row.admission_source as ManagerAdmissionSource, admittedAt,
    admissionDelayMs: row.admission_delay_ms as number,
    firstQuoteAt: row.first_quote_at ? iso(row.first_quote_at) : null,
    firstQuoteEventAgeMs: row.first_quote_event_age_ms,
    firstSnapshotFetchAgeMs: row.first_snapshot_fetch_age_ms,
    evidenceState: row.evidence_state as ManagerEvidenceState,
    originalQty: row.original_qty, minimumModeledQty: row.minimum_modeled_qty,
    economicMode: row.economic_mode, allocation, status: row.status, managerState,
    peakReturnPct: row.peak_return_pct, bankReturnPct: row.bank_return_pct,
    lastBid: row.last_bid, lastQuoteAt: row.last_quote_at ? iso(row.last_quote_at) : null,
    lastObservedAt: row.last_observed_at ? iso(row.last_observed_at) : null,
    consecutiveQuoteMisses: row.consecutive_quote_misses,
    actualCloseAt: row.actual_close_at ? iso(row.actual_close_at) : null,
    actualCloseReason: row.actual_close_reason, actualRealizedPnl: row.actual_realized_pnl,
    terminalAt: row.terminal_at ? iso(row.terminal_at) : null, terminalBid: row.terminal_bid,
    terminalReturnPct: row.terminal_return_pct, terminalPnl: row.terminal_pnl,
    terminalTrigger: row.terminal_trigger, terminalQuoteAgeMs: row.terminal_quote_age_ms,
    censoredAt: row.censored_at ? iso(row.censored_at) : null, censorCode: row.censor_code,
    censorFact: row.censor_fact,
  };
}
