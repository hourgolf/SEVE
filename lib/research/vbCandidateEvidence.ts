// Pure Gate 2 model for the existing signals -> virtual_trades VB lane.
// It builds dry-run artifacts only: no client, filesystem, R2, Supabase,
// strategy, order, or configuration dependency.

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { advanceManager, managerIdsForChannel, MANAGER_POLICY_VERSION, type ManagerId } from "../../engine/managerPolicy.js";
import { deterministicEvidenceUuid } from "../evidence/identity.js";
import {
  compactOccToDatabentoRaw,
  dedupeCbboQuotes,
  EXACT_OPTION_PATH_DATASET,
  EXACT_OPTION_PATH_SCHEMA,
  type DatabentoCbboQuote,
  type ExactContractRequest,
} from "./databentoExactPath.js";

export const VB_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const VB_EXACT_PATH_RECEIPT_SCHEMA_VERSION = 1 as const;
export const VB_EXACT_PATH_BUILDER_VERSION = "vb-exact-path-builder-v1" as const;
export const VB_BOUNDARY_MAX_LAG_MS = 1_100;
export const VB_INTERNAL_MAX_GAP_MS = 5_000;

export const VB_CANDIDATE_SQL_FIELDS = [
  "id", "opportunity_id", "schema_version", "signal_id", "strategist_id", "account_id",
  "channel_slug", "channel_version", "configuration_epoch_id", "source_bar_at", "session_date_et",
  "decision_observed_at",
  "underlying", "option_side", "occ_symbol", "live_observed_ask", "live_ask_feed",
  "live_ask_provider_at", "live_ask_observed_at", "live_ask_freshness_ms", "live_ask_exact",
  "blocked_reason", "virtual_exit_at", "reentry_ordinal", "exact_path_required",
  "order_path_authorized", "source_version",
] as const;

export const VB_EXACT_PATH_SQL_FIELDS = [
  "id", "schema_version", "candidate_id", "opportunity_id", "dataset", "path_schema", "object_key",
  "manifest_key", "content_sha256", "compressed_sha256", "compressed_bytes", "row_count",
  "first_quote_at", "last_quote_at", "entry_quote_at", "entry_ask", "left_boundary_lag_ms",
  "right_boundary_lag_ms", "max_internal_gap_ms", "checksum_verified", "contract_valid", "source",
  "path_builder_version", "completed_at",
] as const;

export interface VbLiveObservedAsk {
  price: number | null;
  feed: "alpaca_snapshot";
  providerAtMs: number | null;
  observedAtMs: number | null;
  freshnessMs: number | null;
  exactExecutable: false;
}

export interface VbCandidateDecision {
  signalId: string;
  strategistId: string;
  accountId: string | null;
  channelSlug: string;
  channelVersion: string;
  configurationEpochId: string;
  sourceVersion: string;
  sourceBarAtMs: number;
  decisionObservedAtMs: number;
  underlying: string;
  side: "call" | "put";
  occSymbol: string;
  liveObservedAsk: VbLiveObservedAsk | null;
  blockedReason:
    | "not_armed"
    | "halted"
    | "cost_gate"
    | "stale_chain"
    | "day1_dark_lifecycle"
    | "day1_premium_debit_cap"
    | "day1_spy_same_clock_collision"
    | "day1_family_open"
    | "day1_reentry_disabled"
    | "day1_same_occ_open"
    | "day1_underlying_concurrency"
    | "day1_global_concurrency";
  virtualExitAtMs: number;
}

export interface VbCandidateReceipt extends VbCandidateDecision {
  schemaVersion: 1;
  candidateId: string;
  opportunityId: string;
  reentryOrdinal: number;
  sessionDateEt: string;
  exactPathRequired: true;
  orderPathAuthorized: false;
}

export type VbCandidateDbPayload = Record<typeof VB_CANDIDATE_SQL_FIELDS[number], string | number | boolean | null>;
export type VbExactPathDbPayload = Record<typeof VB_EXACT_PATH_SQL_FIELDS[number], string | number | boolean>;

export type VbCandidateCensor =
  | "invalid_candidate_provenance"
  | "invalid_exact_contract"
  | "missing_exact_path"
  | "path_identity_mismatch"
  | "path_checksum_unverified"
  | "path_schema_mismatch"
  | "left_boundary_censored"
  | "right_boundary_censored"
  | "internal_gap_censored"
  | "invalid_exact_quote"
  | "invalid_exact_entry_ask";

export interface VbManagerArmResult {
  managerId: ManagerId;
  managerVersion: typeof MANAGER_POLICY_VERSION;
  exitAtMs: number;
  exitBid: number;
  exitReason: string;
  returnPct: number;
  pnlPerContract: number;
  basis: "databento_entry_ask_to_executable_bid";
}

export interface VbCandidateScorecard {
  candidateId: string;
  opportunityId: string;
  channelSlug: string;
  exactEntryAsk: number | null;
  exactEntryQuoteAtMs: number | null;
  liveObservedAsk: VbLiveObservedAsk | null;
  exactBasis: "databento_cbbo_1s";
  exactArms: VbManagerArmResult[];
  nativeSynthetic: { basis: "native_mid_synthetic_development_only"; pnlPerContract: number | null } | null;
  censors: VbCandidateCensor[];
  eligible: boolean;
  policyChangeAuthorized: false;
  orderPathAuthorized: false;
}

export interface VbExactDryRun {
  request: ExactContractRequest | null;
  candidatePayload: VbCandidateDbPayload | null;
  exactPathPayload: VbExactPathDbPayload | null;
  canonicalObject: { bytes: Buffer; compressed: Buffer; objectKey: string; contentSha256: string; compressedSha256: string } | null;
  manifest: Record<string, unknown> | null;
  scorecard: VbCandidateScorecard;
  censors: VbCandidateCensor[];
  externalWrites: false;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^sha256:[0-9a-f]{64}$/;
const OCC = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

function iso(ms: number | null): string | null {
  if (ms == null || !finite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validCandidate(candidate: VbCandidateReceipt): boolean {
  return canonicalVbCandidateId(candidate) === candidate.candidateId
    && UUID.test(candidate.signalId) && UUID.test(candidate.strategistId)
    && (candidate.accountId == null || UUID.test(candidate.accountId))
    && Boolean(candidate.channelSlug && candidate.sourceVersion && candidate.opportunityId)
    && finite(candidate.decisionObservedAtMs) && candidate.decisionObservedAtMs >= candidate.sourceBarAtMs
    && finite(candidate.virtualExitAtMs) && candidate.virtualExitAtMs >= candidate.decisionObservedAtMs;
}

export function canonicalVbCandidateId(input: Pick<VbCandidateDecision,
  "channelVersion" | "configurationEpochId" | "sourceBarAtMs" | "underlying" | "side" | "occSymbol"
>): string | null {
  const source = new Date(input.sourceBarAtMs);
  const underlying = input.underlying.trim().toUpperCase();
  const occSymbol = input.occSymbol.trim().toUpperCase();
  const occSide = occSymbol.slice(-9, -8);
  if (!SHA.test(input.channelVersion) || !SHA.test(input.configurationEpochId) || Number.isNaN(source.getTime())
      || !underlying || !occSymbol.startsWith(underlying) || !OCC.test(occSymbol)
      || (input.side === "call" ? occSide !== "C" : occSide !== "P")) return null;
  return `vbcan:${deterministicEvidenceUuid("seve-vb-candidate-v1", {
    channelVersion: input.channelVersion,
    sourceBarAt: source.toISOString(),
    underlying,
    side: input.side,
    occSymbol,
    configurationEpochId: input.configurationEpochId,
  })}`;
}

export function coalesceVbCandidateDecisions(input: readonly VbCandidateDecision[]): VbCandidateReceipt[] {
  const sorted = [...input].sort((a, b) => a.sourceBarAtMs - b.sourceBarAtMs || a.signalId.localeCompare(b.signalId));
  const activeUntil = new Map<string, number>();
  const ordinal = new Map<string, number>();
  const receipts: VbCandidateReceipt[] = [];
  for (const row of sorted) {
    const candidateId = canonicalVbCandidateId(row);
    if (!candidateId || !UUID.test(row.signalId) || !UUID.test(row.strategistId)
        || (row.accountId != null && !UUID.test(row.accountId)) || !row.channelSlug || !row.sourceVersion
        || !finite(row.decisionObservedAtMs) || row.decisionObservedAtMs < row.sourceBarAtMs
        || !finite(row.virtualExitAtMs) || row.virtualExitAtMs < row.decisionObservedAtMs) continue;
    const sessionDateEt = ET_DATE.format(new Date(row.sourceBarAtMs));
    const lane = `${sessionDateEt}\u0000${row.channelVersion}\u0000${row.configurationEpochId}\u0000${row.underlying}\u0000${row.side}\u0000${row.occSymbol}`;
    if (row.sourceBarAtMs < (activeUntil.get(lane) ?? -Infinity)) continue;
    const reentryOrdinal = (ordinal.get(lane) ?? 0) + 1;
    ordinal.set(lane, reentryOrdinal);
    activeUntil.set(lane, row.virtualExitAtMs);
    receipts.push({
      ...row,
      schemaVersion: VB_CANDIDATE_SCHEMA_VERSION,
      candidateId,
      opportunityId: `vbopp:${deterministicEvidenceUuid("seve-vb-opportunity-v1", { candidateId, reentryOrdinal })}`,
      reentryOrdinal,
      sessionDateEt,
      exactPathRequired: true,
      orderPathAuthorized: false,
    });
  }
  return receipts;
}

export function candidateDbPayload(candidate: VbCandidateReceipt): VbCandidateDbPayload | null {
  if (!validCandidate(candidate)) return null;
  const live = candidate.liveObservedAsk;
  return {
    id: candidate.candidateId,
    opportunity_id: candidate.opportunityId,
    schema_version: candidate.schemaVersion,
    signal_id: candidate.signalId,
    strategist_id: candidate.strategistId,
    account_id: candidate.accountId,
    channel_slug: candidate.channelSlug,
    channel_version: candidate.channelVersion,
    configuration_epoch_id: candidate.configurationEpochId,
    source_bar_at: new Date(candidate.sourceBarAtMs).toISOString(),
    session_date_et: candidate.sessionDateEt,
    decision_observed_at: new Date(candidate.decisionObservedAtMs).toISOString(),
    underlying: candidate.underlying,
    option_side: candidate.side,
    occ_symbol: candidate.occSymbol,
    live_observed_ask: live?.price ?? null,
    live_ask_feed: live?.feed ?? null,
    live_ask_provider_at: iso(live?.providerAtMs ?? null),
    live_ask_observed_at: iso(live?.observedAtMs ?? null),
    live_ask_freshness_ms: live?.freshnessMs ?? null,
    live_ask_exact: false,
    blocked_reason: candidate.blockedReason,
    virtual_exit_at: new Date(candidate.virtualExitAtMs).toISOString(),
    reentry_ordinal: candidate.reentryOrdinal,
    exact_path_required: true,
    order_path_authorized: false,
    source_version: candidate.sourceVersion,
  };
}

function emptyScorecard(candidate: VbCandidateReceipt, nativeSyntheticPnlPerContract: number | null | undefined): VbCandidateScorecard {
  return {
    candidateId: candidate.candidateId,
    opportunityId: candidate.opportunityId,
    channelSlug: candidate.channelSlug,
    exactEntryAsk: null,
    exactEntryQuoteAtMs: null,
    liveObservedAsk: candidate.liveObservedAsk,
    exactBasis: "databento_cbbo_1s",
    exactArms: [],
    nativeSynthetic: nativeSyntheticPnlPerContract === undefined ? null : {
      basis: "native_mid_synthetic_development_only",
      pnlPerContract: finite(nativeSyntheticPnlPerContract) ? nativeSyntheticPnlPerContract : null,
    },
    censors: [], eligible: false, policyChangeAuthorized: false, orderPathAuthorized: false,
  };
}

export function buildVbExactCandidateDryRun(input: {
  candidate: VbCandidateReceipt;
  databentoQuotes: readonly DatabentoCbboQuote[];
  nativeSyntheticPnlPerContract?: number | null;
  materializeCanonicalObject?: boolean;
}): VbExactDryRun {
  const { candidate } = input;
  const censors = new Set<VbCandidateCensor>();
  const candidatePayload = candidateDbPayload(candidate);
  if (!candidatePayload) censors.add("invalid_candidate_provenance");
  const rawSymbol = compactOccToDatabentoRaw(candidate.occSymbol, candidate.underlying);
  if (!rawSymbol) censors.add("invalid_exact_contract");
  const request: ExactContractRequest | null = rawSymbol ? {
    sessionDateEt: candidate.sessionDateEt,
    occSymbol: candidate.occSymbol,
    rawSymbol,
    startIso: new Date(candidate.decisionObservedAtMs).toISOString(),
    endIso: new Date(candidate.virtualExitAtMs + VB_BOUNDARY_MAX_LAG_MS + 1).toISOString(),
    positionIds: [candidate.opportunityId],
  } : null;

  const responseWindow = input.databentoQuotes.filter((quote) => quote.atMs >= candidate.decisionObservedAtMs
    && quote.atMs <= candidate.virtualExitAtMs + VB_BOUNDARY_MAX_LAG_MS);
  if (responseWindow.some((quote) => quote.occSymbol !== candidate.occSymbol
      || quote.source !== "databento_cbbo_1s")) censors.add("path_identity_mismatch");
  if (responseWindow.some((quote) => !finite(quote.atMs) || !finite(quote.bid) || !finite(quote.ask)
      || quote.bid <= 0 || quote.ask < quote.bid)) censors.add("invalid_exact_quote");
  const quotes = dedupeCbboQuotes(responseWindow.filter((quote) => quote.occSymbol === candidate.occSymbol
    && quote.source === "databento_cbbo_1s" && finite(quote.atMs) && finite(quote.bid) && finite(quote.ask)
    && quote.bid > 0 && quote.ask >= quote.bid));
  if (!quotes.length) censors.add("missing_exact_path");
  const left = quotes[0];
  const right = quotes.find((quote) => quote.atMs >= candidate.virtualExitAtMs);
  const leftLag = left ? left.atMs - candidate.decisionObservedAtMs : Number.POSITIVE_INFINITY;
  const rightLag = right ? right.atMs - candidate.virtualExitAtMs : Number.POSITIVE_INFINITY;
  if (!left || leftLag < 0 || leftLag > VB_BOUNDARY_MAX_LAG_MS) censors.add("left_boundary_censored");
  if (!right || rightLag < 0 || rightLag > VB_BOUNDARY_MAX_LAG_MS) censors.add("right_boundary_censored");
  const throughRight = right ? quotes.filter((quote) => quote.atMs <= right.atMs) : quotes;
  const gaps = throughRight.slice(1).map((quote, index) => quote.atMs - throughRight[index].atMs);
  const maxInternalGapMs = gaps.length ? Math.max(...gaps) : 0;
  if (maxInternalGapMs > VB_INTERNAL_MAX_GAP_MS) censors.add("internal_gap_censored");
  if (!left || !(left.ask > 0) || left.ask < left.bid) censors.add("invalid_exact_entry_ask");

  const scorecard = emptyScorecard(candidate, input.nativeSyntheticPnlPerContract);
  if (censors.size || !left || !right) {
    scorecard.censors = [...censors].sort();
    return { request, candidatePayload, exactPathPayload: null, canonicalObject: null, manifest: null, scorecard, censors: scorecard.censors, externalWrites: false };
  }

  scorecard.exactEntryAsk = left.ask;
  scorecard.exactEntryQuoteAtMs = left.atMs;
  for (const managerId of managerIdsForChannel(candidate.channelSlug)) {
    let state = {};
    for (let index = 0; index < throughRight.length; index++) {
      const quote = throughRight[index];
      const returnPct = ((quote.bid - left.ask) / left.ask) * 100;
      const advanced = advanceManager(managerId, state, returnPct, index === throughRight.length - 1);
      state = advanced.state;
      if (!advanced.exit) continue;
      scorecard.exactArms.push({
        managerId,
        managerVersion: MANAGER_POLICY_VERSION,
        exitAtMs: quote.atMs,
        exitBid: quote.bid,
        exitReason: advanced.exit.reason,
        returnPct: advanced.exit.returnPct,
        pnlPerContract: Math.round((left.ask * advanced.exit.returnPct) * 100) / 100,
        basis: "databento_entry_ask_to_executable_bid",
      });
      break;
    }
  }
  scorecard.eligible = scorecard.exactArms.length === managerIdsForChannel(candidate.channelSlug).length;
  if (input.materializeCanonicalObject === false) {
    return {
      request,
      candidatePayload,
      exactPathPayload: null,
      canonicalObject: null,
      manifest: null,
      scorecard,
      censors: [],
      externalWrites: false,
    };
  }

  const canonical = {
    schemaVersion: VB_EXACT_PATH_RECEIPT_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    opportunityId: candidate.opportunityId,
    dataset: EXACT_OPTION_PATH_DATASET,
    schema: EXACT_OPTION_PATH_SCHEMA,
    pathBuilderVersion: VB_EXACT_PATH_BUILDER_VERSION,
    occSymbol: candidate.occSymbol,
    sourceBarAt: new Date(candidate.sourceBarAtMs).toISOString(),
    decisionObservedAt: new Date(candidate.decisionObservedAtMs).toISOString(),
    requestedExitAt: new Date(candidate.virtualExitAtMs).toISOString(),
    quotes: throughRight,
  };
  const bytes = Buffer.from(`${stable(canonical)}\n`, "utf8");
  const compressed = gzipSync(bytes, { level: 9 });
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const compressedSha256 = createHash("sha256").update(compressed).digest("hex");
  const base = `vb-exact-path/v1/${candidate.sessionDateEt}/${candidate.candidateId.slice(6)}/${compressedSha256}`;
  const objectKey = `${base}.json.gz`;
  const manifestKey = `${base}.manifest.json`;
  const completedAt = new Date(right.atMs).toISOString();
  const manifest = {
    schemaVersion: VB_EXACT_PATH_RECEIPT_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    opportunityId: candidate.opportunityId,
    dataset: EXACT_OPTION_PATH_DATASET,
    schema: EXACT_OPTION_PATH_SCHEMA,
    pathBuilderVersion: VB_EXACT_PATH_BUILDER_VERSION,
    objectKey,
    contentSha256,
    compressedSha256,
    compressedBytes: compressed.byteLength,
    rows: throughRight.length,
    firstQuoteAt: new Date(left.atMs).toISOString(),
    lastQuoteAt: new Date(right.atMs).toISOString(),
    entryQuoteAt: new Date(left.atMs).toISOString(),
    entryAsk: left.ask,
    leftBoundaryLagMs: leftLag,
    rightBoundaryLagMs: rightLag,
    maxInternalGapMs,
    completedAt,
    externalWrites: false,
  };
  const exactPathPayload: VbExactPathDbPayload = {
    id: deterministicEvidenceUuid("seve-vb-exact-path-receipt-v1", { candidateId: candidate.candidateId, compressedSha256 }),
    schema_version: VB_EXACT_PATH_RECEIPT_SCHEMA_VERSION,
    candidate_id: candidate.candidateId,
    opportunity_id: candidate.opportunityId,
    dataset: EXACT_OPTION_PATH_DATASET,
    path_schema: EXACT_OPTION_PATH_SCHEMA,
    object_key: objectKey,
    manifest_key: manifestKey,
    content_sha256: contentSha256,
    compressed_sha256: compressedSha256,
    compressed_bytes: compressed.byteLength,
    row_count: throughRight.length,
    first_quote_at: new Date(left.atMs).toISOString(),
    last_quote_at: new Date(right.atMs).toISOString(),
    entry_quote_at: new Date(left.atMs).toISOString(),
    entry_ask: left.ask,
    left_boundary_lag_ms: leftLag,
    right_boundary_lag_ms: rightLag,
    max_internal_gap_ms: maxInternalGapMs,
    checksum_verified: createHash("sha256").update(bytes).digest("hex") === contentSha256
      && createHash("sha256").update(compressed).digest("hex") === compressedSha256,
    contract_valid: true,
    source: "databento_historical",
    path_builder_version: VB_EXACT_PATH_BUILDER_VERSION,
    completed_at: completedAt,
  };

  return {
    request,
    candidatePayload,
    exactPathPayload,
    canonicalObject: { bytes, compressed, objectKey, contentSha256, compressedSha256 },
    manifest,
    scorecard,
    censors: [],
    externalWrites: false,
  };
}
