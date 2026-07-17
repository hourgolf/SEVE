// Pure Gate 2 model for extending the existing signals -> virtual_trades VB
// lane onto exact candidate evidence. It owns no client, filesystem, R2,
// Supabase, order, or configuration dependency.

import { createHash } from "node:crypto";
import { advanceManager, managerIdsForChannel, MANAGER_POLICY_VERSION, type ManagerId } from "../../engine/managerPolicy.js";
import { deterministicEvidenceUuid } from "../evidence/identity.js";
import { EXACT_OPTION_PATH_DATASET, EXACT_OPTION_PATH_SCHEMA } from "./databentoExactPath.js";

export const VB_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const VB_EXACT_PATH_RECEIPT_SCHEMA_VERSION = 1 as const;

export interface VbCandidateDecision {
  signalId: string;
  channelSlug: string;
  channelVersion: string;
  configurationEpochId: string;
  sourceBarAtMs: number;
  underlying: string;
  side: "call" | "put";
  occSymbol: string;
  entryAsk: number;
  blockedReason: "not_armed" | "halted" | "cost_gate" | "stale_chain";
  virtualExitAtMs: number;
  accountId?: string | null;
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

export interface VbExactQuote {
  atMs: number;
  bid: number;
  ask: number;
}

export interface VbExactPathReceipt {
  schemaVersion: 1;
  candidateId: string;
  opportunityId: string;
  dataset: typeof EXACT_OPTION_PATH_DATASET;
  schema: typeof EXACT_OPTION_PATH_SCHEMA;
  objectKey: string;
  compressedSha256: string;
  rows: number;
  startAtMs: number;
  endAtMs: number;
  checksumVerified: boolean;
  contractValid: boolean;
  quotes: readonly VbExactQuote[];
}

export type VbCandidateCensor =
  | "invalid_candidate_provenance"
  | "invalid_exact_contract"
  | "missing_exact_path"
  | "path_identity_mismatch"
  | "path_checksum_unverified"
  | "path_schema_mismatch"
  | "invalid_executable_entry_ask"
  | "invalid_executable_bid_path";

export interface VbManagerArmResult {
  managerId: ManagerId;
  managerVersion: typeof MANAGER_POLICY_VERSION;
  exitAtMs: number;
  exitBid: number;
  exitReason: string;
  returnPct: number;
  pnlPerContract: number;
  basis: "entry_executable_ask_exit_executable_bid";
}

export interface VbCandidateScorecard {
  candidateId: string;
  opportunityId: string;
  channelSlug: string;
  exactBasis: "databento_cbbo_1s";
  exactArms: VbManagerArmResult[];
  nativeSynthetic: { basis: "native_mid_synthetic_development_only"; pnlPerContract: number | null } | null;
  censors: VbCandidateCensor[];
  eligible: boolean;
  policyChangeAuthorized: false;
  orderPathAuthorized: false;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function canonicalVbCandidateId(input: Pick<VbCandidateDecision,
  "channelVersion" | "configurationEpochId" | "sourceBarAtMs" | "underlying" | "side" | "occSymbol"
>): string | null {
  const source = new Date(input.sourceBarAtMs);
  const underlying = input.underlying.trim().toUpperCase();
  const occSymbol = input.occSymbol.trim().toUpperCase();
  const occSide = occSymbol.slice(-9, -8);
  if (!/^sha256:[0-9a-f]{64}$/.test(input.channelVersion)
      || !/^sha256:[0-9a-f]{64}$/.test(input.configurationEpochId) || Number.isNaN(source.getTime())
      || !underlying || !occSymbol.startsWith(underlying) || !/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(occSymbol)
      || (input.side === "call" ? occSide !== "C" : occSide !== "P")
      || !["call", "put"].includes(input.side)) return null;
  return `vbcan:${deterministicEvidenceUuid("seve-vb-candidate-v1", {
    channelVersion: input.channelVersion,
    sourceBarAt: source.toISOString(),
    underlying,
    side: input.side,
    occSymbol,
    configurationEpochId: input.configurationEpochId,
  })}`;
}

/**
 * Mirrors the existing gate-shadow sequential walk. Repeated per-minute signals
 * while a virtual position is open are coalesced. A signal at/after the prior
 * exact virtual exit becomes a deterministic re-entry opportunity.
 */
export function coalesceVbCandidateDecisions(input: readonly VbCandidateDecision[]): VbCandidateReceipt[] {
  const sorted = [...input].sort((a, b) => a.sourceBarAtMs - b.sourceBarAtMs || a.signalId.localeCompare(b.signalId));
  const activeUntil = new Map<string, number>();
  const ordinal = new Map<string, number>();
  const receipts: VbCandidateReceipt[] = [];
  for (const row of sorted) {
    const candidateId = canonicalVbCandidateId(row);
    if (!candidateId || !row.signalId || !row.channelSlug || !(row.entryAsk > 0)
        || !finite(row.virtualExitAtMs) || row.virtualExitAtMs < row.sourceBarAtMs) continue;
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

export function exactPathObjectKey(candidate: VbCandidateReceipt, canonicalCompressedBytes: Uint8Array): {
  objectKey: string;
  compressedSha256: string;
} {
  const compressedSha256 = createHash("sha256").update(canonicalCompressedBytes).digest("hex");
  return {
    objectKey: `vb-exact-path/v1/${candidate.sessionDateEt}/${candidate.candidateId.slice(6)}/${compressedSha256}.json.gz`,
    compressedSha256,
  };
}

export function adaptVbCandidateToManagerScorecard(input: {
  candidate: VbCandidateReceipt;
  exactPath: VbExactPathReceipt | null;
  nativeSyntheticPnlPerContract?: number | null;
}): VbCandidateScorecard {
  const { candidate, exactPath } = input;
  const censors = new Set<VbCandidateCensor>();
  if (canonicalVbCandidateId(candidate) !== candidate.candidateId || !candidate.opportunityId
      || !candidate.channelSlug || !candidate.configurationEpochId) censors.add("invalid_candidate_provenance");
  if (!(candidate.entryAsk > 0)) censors.add("invalid_executable_entry_ask");
  if (!exactPath) censors.add("missing_exact_path");
  if (exactPath) {
    if (!exactPath.contractValid) censors.add("invalid_exact_contract");
    if (exactPath.candidateId !== candidate.candidateId || exactPath.opportunityId !== candidate.opportunityId)
      censors.add("path_identity_mismatch");
    if (!exactPath.checksumVerified || !/^[0-9a-f]{64}$/.test(exactPath.compressedSha256))
      censors.add("path_checksum_unverified");
    if (exactPath.dataset !== EXACT_OPTION_PATH_DATASET || exactPath.schema !== EXACT_OPTION_PATH_SCHEMA)
      censors.add("path_schema_mismatch");
    if (!finite(exactPath.startAtMs) || !finite(exactPath.endAtMs)
        || exactPath.startAtMs > candidate.sourceBarAtMs || exactPath.endAtMs < candidate.virtualExitAtMs
        || exactPath.rows !== exactPath.quotes.length || exactPath.quotes.length === 0
        || exactPath.quotes.some((quote, index, rows) => !finite(quote.atMs) || !(quote.bid > 0)
          || quote.ask < quote.bid || quote.atMs < candidate.sourceBarAtMs
          || quote.atMs < exactPath.startAtMs || quote.atMs > exactPath.endAtMs
          || (index > 0 && quote.atMs <= rows[index - 1].atMs))) censors.add("invalid_executable_bid_path");
  }

  const exactArms: VbManagerArmResult[] = [];
  if (censors.size === 0 && exactPath) {
    for (const managerId of managerIdsForChannel(candidate.channelSlug)) {
      let state = {};
      for (let index = 0; index < exactPath.quotes.length; index++) {
        const quote = exactPath.quotes[index];
        const returnPct = ((quote.bid - candidate.entryAsk) / candidate.entryAsk) * 100;
        const advanced = advanceManager(managerId, state, returnPct, index === exactPath.quotes.length - 1);
        state = advanced.state;
        if (!advanced.exit) continue;
        exactArms.push({
          managerId,
          managerVersion: MANAGER_POLICY_VERSION,
          exitAtMs: quote.atMs,
          exitBid: quote.bid,
          exitReason: advanced.exit.reason,
          returnPct: advanced.exit.returnPct,
          pnlPerContract: Math.round((candidate.entryAsk * advanced.exit.returnPct) * 100) / 100,
          basis: "entry_executable_ask_exit_executable_bid",
        });
        break;
      }
    }
  }
  return {
    candidateId: candidate.candidateId,
    opportunityId: candidate.opportunityId,
    channelSlug: candidate.channelSlug,
    exactBasis: "databento_cbbo_1s",
    exactArms,
    nativeSynthetic: input.nativeSyntheticPnlPerContract === undefined ? null : {
      basis: "native_mid_synthetic_development_only",
      pnlPerContract: finite(input.nativeSyntheticPnlPerContract) ? input.nativeSyntheticPnlPerContract : null,
    },
    censors: [...censors].sort(),
    eligible: censors.size === 0 && exactArms.length === managerIdsForChannel(candidate.channelSlug).length,
    policyChangeAuthorized: false,
    orderPathAuthorized: false,
  };
}
