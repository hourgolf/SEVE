import { createHash } from "node:crypto";
import { RC54_ROOTS } from "../channels/activeRelease";
import {
  compactOccToDatabentoRaw,
  EXACT_OPTION_PATH_DATASET,
  EXACT_OPTION_PATH_SCHEMA,
} from "./databentoExactPath";
import type { Rc54ComparableCandidate } from "./rc54ComparableReplay";

export const RC54_COMPARABLE_FREEZE_VERSION = "rc54-comparable-freeze-v1" as const;
export const RC54_COMPARABLE_START_ET = "2026-06-01" as const;
export const RC54_COMPARABLE_PATH_END_ET = "15:25" as const;

export interface Rc54ComparableVirtualClock {
  signal_id: string;
  slug: string;
  occ: string;
  signal_at: string;
}

export interface Rc54ComparableFrozenCandidate extends Rc54ComparableCandidate {
  source: "virtual_trade_candidate_clock";
  channelClass: "active_release_root" | "dark_vb" | "dark_other";
}

export interface Rc54ComparableContractRequest {
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

export interface Rc54ComparableFreezeCensor {
  signalId: string;
  code: "invalid_signal_id" | "invalid_channel" | "invalid_clock" | "invalid_contract";
  fact: string;
}

export interface Rc54ComparableFreeze {
  version: typeof RC54_COMPARABLE_FREEZE_VERSION;
  evidenceStartEt: typeof RC54_COMPARABLE_START_ET;
  evidenceEndEt: string;
  source: "supabase_select_only_virtual_candidate_clocks";
  candidates: Rc54ComparableFrozenCandidate[];
  censors: Rc54ComparableFreezeCensor[];
  contractRequests: Rc54ComparableContractRequest[];
  summary: {
    sourceRows: number;
    frozenCandidateClocks: number;
    censoredRows: number;
    sessions: number;
    channels: number;
    exactSessionContracts: number;
    estimatedMaximumOneSecondRows: number;
    byChannelClass: Record<Rc54ComparableFrozenCandidate["channelClass"], number>;
    byChannel: Record<string, number>;
    bySession: Record<string, number>;
    byCensor: Record<string, number>;
  };
  methodology: {
    historicalVirtualEntryExitIgnored: true;
    exactEntryBasis: "last_databento_cbbo_ask_at_or_before_candidate_clock";
    exactExitBasis: "executable_databento_cbbo_bid";
    runtimeEconomics: "rc54_two_contract_minus30_stop_1525_flatten";
    managerSpecificSequentialReplayRequired: true;
    externalWrites: false;
    orderPathAuthorized: false;
    policyChangeAuthorized: false;
  };
  canonicalSha256: string;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

export function rc54ComparableCanonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function etWallClockMs(dateEt: string, hour: number, minute: number): number {
  const noonUtc = Date.parse(`${dateEt}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUtc));
  const etAtNoonMinutes = (Number(parts.find((part) => part.type === "hour")?.value ?? 12) % 24) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return Date.parse(`${dateEt}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`)
    + (12 * 60 - etAtNoonMinutes) * 60_000;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function channelClass(slug: string): Rc54ComparableFrozenCandidate["channelClass"] {
  if (RC54_ROOTS[slug]) return "active_release_root";
  return slug.startsWith("vb-") ? "dark_vb" : "dark_other";
}

function buildContractRequests(
  candidates: readonly Rc54ComparableFrozenCandidate[],
): Rc54ComparableContractRequest[] {
  const grouped = new Map<string, Rc54ComparableFrozenCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.sessionDateEt}\u0000${candidate.occSymbol}`;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  return [...grouped.values()].flatMap((rows) => {
    const first = rows[0];
    const root = first.occSymbol.match(/^[A-Z]{1,6}/)?.[0] ?? "";
    const rawSymbol = compactOccToDatabentoRaw(first.occSymbol, root);
    if (!rawSymbol) return [];
    const startMs = etWallClockMs(first.sessionDateEt, 9, 30) - 2_000;
    const endMs = etWallClockMs(first.sessionDateEt, 15, 25) + 1_101;
    const identity = {
      sessionDateEt: first.sessionDateEt,
      occSymbol: first.occSymbol,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString(),
      candidateIds: rows.map((row) => row.candidateId).sort(),
    };
    return [{
      requestId: rc54ComparableCanonicalSha256(identity),
      sessionDateEt: first.sessionDateEt,
      dataset: EXACT_OPTION_PATH_DATASET,
      schema: EXACT_OPTION_PATH_SCHEMA,
      occSymbol: first.occSymbol,
      rawSymbol,
      startIso: identity.startIso,
      endIso: identity.endIso,
      candidateIds: identity.candidateIds,
      rawDecisionCount: rows.length,
      estimatedMaximumOneSecondRows: Math.ceil((endMs - startMs) / 1_000),
    }];
  }).sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt)
    || a.occSymbol.localeCompare(b.occSymbol));
}

export function freezeRc54ComparableClocks(input: {
  rows: readonly Rc54ComparableVirtualClock[];
  evidenceEndEt: string;
}): Rc54ComparableFreeze {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.evidenceEndEt)
      || input.evidenceEndEt < RC54_COMPARABLE_START_ET) {
    throw new Error("RC5.4 comparable freeze requires a valid evidence end date");
  }
  const candidates: Rc54ComparableFrozenCandidate[] = [];
  const censors: Rc54ComparableFreezeCensor[] = [];
  for (const row of input.rows) {
    if (!row.signal_id) {
      censors.push({ signalId: String(row.signal_id ?? ""), code: "invalid_signal_id", fact: "missing" });
      continue;
    }
    if (!row.slug) {
      censors.push({ signalId: row.signal_id, code: "invalid_channel", fact: "missing" });
      continue;
    }
    const decisionAtMs = Date.parse(row.signal_at);
    if (!Number.isFinite(decisionAtMs)) {
      censors.push({ signalId: row.signal_id, code: "invalid_clock", fact: String(row.signal_at) });
      continue;
    }
    const sessionDateEt = ET_DATE.format(new Date(decisionAtMs));
    if (sessionDateEt < RC54_COMPARABLE_START_ET || sessionDateEt > input.evidenceEndEt) {
      censors.push({ signalId: row.signal_id, code: "invalid_clock", fact: sessionDateEt });
      continue;
    }
    const occSymbol = row.occ.trim().toUpperCase().replace(/\s+/g, "");
    const root = occSymbol.match(/^[A-Z]{1,6}/)?.[0] ?? "";
    if (!compactOccToDatabentoRaw(occSymbol, root)) {
      censors.push({ signalId: row.signal_id, code: "invalid_contract", fact: row.occ });
      continue;
    }
    candidates.push({
      candidateId: row.signal_id,
      sessionDateEt,
      channelSlug: row.slug,
      occSymbol,
      decisionAtMs,
      source: "virtual_trade_candidate_clock",
      channelClass: channelClass(row.slug),
    });
  }
  candidates.sort((a, b) => a.decisionAtMs - b.decisionAtMs
    || a.channelSlug.localeCompare(b.channelSlug)
    || a.candidateId.localeCompare(b.candidateId));
  const contractRequests = buildContractRequests(candidates);
  const summary = {
    sourceRows: input.rows.length,
    frozenCandidateClocks: candidates.length,
    censoredRows: censors.length,
    sessions: new Set(candidates.map((row) => row.sessionDateEt)).size,
    channels: new Set(candidates.map((row) => row.channelSlug)).size,
    exactSessionContracts: contractRequests.length,
    estimatedMaximumOneSecondRows: contractRequests.reduce(
      (sum, request) => sum + request.estimatedMaximumOneSecondRows,
      0,
    ),
    byChannelClass: {
      active_release_root: candidates.filter((row) => row.channelClass === "active_release_root").length,
      dark_vb: candidates.filter((row) => row.channelClass === "dark_vb").length,
      dark_other: candidates.filter((row) => row.channelClass === "dark_other").length,
    },
    byChannel: countBy(candidates, (row) => row.channelSlug),
    bySession: countBy(candidates, (row) => row.sessionDateEt),
    byCensor: countBy(censors, (row) => row.code),
  };
  const result = {
    version: RC54_COMPARABLE_FREEZE_VERSION,
    evidenceStartEt: RC54_COMPARABLE_START_ET,
    evidenceEndEt: input.evidenceEndEt,
    source: "supabase_select_only_virtual_candidate_clocks" as const,
    candidates,
    censors: censors.sort((a, b) => a.signalId.localeCompare(b.signalId)
      || a.code.localeCompare(b.code)),
    contractRequests,
    summary,
    methodology: {
      historicalVirtualEntryExitIgnored: true as const,
      exactEntryBasis: "last_databento_cbbo_ask_at_or_before_candidate_clock" as const,
      exactExitBasis: "executable_databento_cbbo_bid" as const,
      runtimeEconomics: "rc54_two_contract_minus30_stop_1525_flatten" as const,
      managerSpecificSequentialReplayRequired: true as const,
      externalWrites: false as const,
      orderPathAuthorized: false as const,
      policyChangeAuthorized: false as const,
    },
  };
  return { ...result, canonicalSha256: rc54ComparableCanonicalSha256(result) };
}
