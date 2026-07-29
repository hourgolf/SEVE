import { createHash } from "node:crypto";
import type { Bar } from "../../engine/types";
import type { DatabentoCbboQuote } from "./databentoExactPath";
import {
  replayRc54SealedManager,
  type Rc54ReplayQuote,
} from "./rc54CompositeReplay";
import type { Rc54ComparableCandidate } from "./rc54ComparableReplay";

export const RC54_SEALED_MANAGER_STUDY_VERSION =
  "rc54-sealed-manager-study-v1" as const;
export const RC54_NATIVE_ATR_TARGETS =
  [10, 15, 20, 25, 30, 35, 40, 50, 75, 100] as const;

export type Rc54SealedStudyProfile =
  | "FULL-RIDE"
  | "FULL-A13"
  | `BANK${number}/NATIVE-ATR`;

export type Rc54SealedStudyCensorCode =
  | "duplicate_candidate"
  | "invalid_candidate"
  | "missing_contract_path"
  | "path_identity_mismatch"
  | "non_exact_path_source"
  | "invalid_exact_quote"
  | "missing_entry_state"
  | "invalid_entry_ask"
  | "entry_after_flatten"
  | "missing_terminal_state"
  | "missing_underlying_bars"
  | "manager_path_incomplete"
  | "sequential_reentry_active";

export interface Rc54SealedStudyCensor {
  candidateId: string;
  channelSlug: string | null;
  profileId: Rc54SealedStudyProfile | null;
  code: Rc54SealedStudyCensorCode;
  fact: string;
}

export interface Rc54SealedStudyPath {
  candidateId: string;
  sessionDateEt: string;
  channelSlug: string;
  occSymbol: string;
  profileId: Rc54SealedStudyProfile;
  nativeAtrTargetPct: number | null;
  decisionAt: string;
  entryQuoteAt: string;
  entryAsk: number;
  exitAt: string;
  pnl: number;
  pnlPerContract: number;
  lotExits: Array<{
    lot: "bank" | "runner";
    exitAt: string;
    exitBid: number;
    exitReason: string;
    returnPct: number;
    pnl: number;
  }>;
  basis:
    "databento_entry_ask_to_executable_bid_plus_completed_underlying_bars";
  independentOpportunity: true;
}

export interface Rc54SealedManagerStudy {
  version: typeof RC54_SEALED_MANAGER_STUDY_VERSION;
  nativeAtrTargetGrid: number[];
  source: {
    rawCandidateClocks: number;
    distinctCandidateClocks: number;
    exactEligibleCandidateClocks: number;
    exactCensoredCandidateClocks: number;
    managerProfilesEvaluated: number;
    independentManagerPaths: number;
    overlappingManagerClocksCensored: number;
  };
  paths: Rc54SealedStudyPath[];
  censors: Rc54SealedStudyCensor[];
  methodology: {
    entry: "last_databento_cbbo_ask_at_or_before_decision";
    optionExit: "first_executable_bid_crossing_risk_first_else_last_bid_at_or_before_1525_et";
    nativeAtr: "completed_rth_underlying_close_peak_and_atr14_range_mean_at_1m_bar_close";
    nativeAtrOptionValuation: "last_executable_databento_bid_at_or_before_underlying_trigger";
    stopPct: -30;
    quantity: 2;
    reentry: "disabled_per_session_channel_profile_until_both_lots_exit";
    adds: 0;
    historicalVirtualOutcomesIgnored: true;
    externalWrites: false;
    orderPathAuthorized: false;
    policyChangeAuthorized: false;
  };
  canonicalSha256: string;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort()
    .map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}

function et1525Ms(sessionDateEt: string): number {
  const noonUtc = Date.parse(`${sessionDateEt}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUtc));
  const etAtNoonMinutes =
    (Number(parts.find((part) => part.type === "hour")?.value ?? 12) % 24) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return Date.parse(`${sessionDateEt}T15:25:00.000Z`)
    + (12 * 60 - etAtNoonMinutes) * 60_000;
}

function validCandidate(candidate: Rc54ComparableCandidate): boolean {
  return Boolean(candidate.candidateId && candidate.channelSlug
    && /^\d{4}-\d{2}-\d{2}$/.test(candidate.sessionDateEt)
    && /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(candidate.occSymbol)
    && finite(candidate.decisionAtMs)
    && new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
      .format(new Date(candidate.decisionAtMs)) === candidate.sessionDateEt);
}

function censor(
  candidate: Rc54ComparableCandidate | null,
  code: Rc54SealedStudyCensorCode,
  fact: string,
  profileId: Rc54SealedStudyProfile | null = null,
): Rc54SealedStudyCensor {
  return {
    candidateId: candidate?.candidateId ?? "unknown",
    channelSlug: candidate?.channelSlug ?? null,
    profileId,
    code,
    fact,
  };
}

function exactContractQuotes(
  candidate: Rc54ComparableCandidate,
  quotes: readonly DatabentoCbboQuote[],
  censors: Rc54SealedStudyCensor[],
): DatabentoCbboQuote[] | null {
  const matching = quotes.filter((quote) => quote.occSymbol === candidate.occSymbol);
  if (!matching.length) {
    censors.push(censor(candidate, "missing_contract_path", candidate.occSymbol));
    return null;
  }
  if (quotes.some((quote) => quote.occSymbol !== candidate.occSymbol)) {
    censors.push(censor(candidate, "path_identity_mismatch", candidate.occSymbol));
    return null;
  }
  if (matching.some((quote) => quote.source !== "databento_cbbo_1s")) {
    censors.push(censor(candidate, "non_exact_path_source", candidate.occSymbol));
    return null;
  }
  if (matching.some((quote) => !finite(quote.atMs) || !finite(quote.bid)
    || !finite(quote.ask) || quote.bid < 0 || quote.ask < 0
    || (quote.ask > 0 && quote.ask < quote.bid))) {
    censors.push(censor(candidate, "invalid_exact_quote", candidate.occSymbol));
    return null;
  }
  return [...matching].sort((left, right) => left.atMs - right.atMs);
}

function studyProfiles(
  candidate: Rc54ComparableCandidate,
  nativeAtrTargets: readonly number[],
): Array<{ id: Rc54SealedStudyProfile; nativeAtrTargetPct: number | null }> {
  const baseline: Array<{
    id: Rc54SealedStudyProfile;
    nativeAtrTargetPct: number | null;
  }> = [
    { id: "FULL-RIDE", nativeAtrTargetPct: null },
    { id: "FULL-A13", nativeAtrTargetPct: null },
  ];
  if (candidate.channelSlug !== "orb-qqq-trail") return baseline;
  return [
    ...baseline,
    ...nativeAtrTargets.map((target) => ({
      id: `BANK${target}/NATIVE-ATR` as const,
      nativeAtrTargetPct: target,
    })),
  ];
}

function lane(
  candidate: Rc54ComparableCandidate,
  profileId: Rc54SealedStudyProfile,
): string {
  return `${candidate.sessionDateEt}\u0000${candidate.channelSlug}\u0000${profileId}`;
}

export function deriveRc54SealedManagerStudy(input: {
  candidates: readonly Rc54ComparableCandidate[];
  quotesByOccSession: ReadonlyMap<string, readonly DatabentoCbboQuote[]>;
  barsByUnderlyingSession: ReadonlyMap<string, readonly Bar[]>;
  nativeAtrTargetGrid?: readonly number[];
}): Rc54SealedManagerStudy {
  const nativeAtrTargetGrid = [
    ...(input.nativeAtrTargetGrid ?? RC54_NATIVE_ATR_TARGETS),
  ];
  if (!nativeAtrTargetGrid.length
    || nativeAtrTargetGrid.some((target) => !finite(target) || target <= 0)) {
    throw new Error("sealed manager study requires a positive native ATR target grid");
  }

  const candidateGroups = new Map<string, Rc54ComparableCandidate[]>();
  for (const candidate of input.candidates) {
    candidateGroups.set(candidate.candidateId, [
      ...(candidateGroups.get(candidate.candidateId) ?? []),
      candidate,
    ]);
  }
  const censors: Rc54SealedStudyCensor[] = [];
  const eligible: Array<{
    candidate: Rc54ComparableCandidate;
    entry: DatabentoCbboQuote;
    flattenAtMs: number;
    quotes: Rc54ReplayQuote[];
  }> = [];
  let exactCensoredCandidateClocks = 0;
  const candidates = [...input.candidates].sort((left, right) =>
    left.decisionAtMs - right.decisionAtMs
    || left.candidateId.localeCompare(right.candidateId));

  for (const candidate of candidates) {
    if ((candidateGroups.get(candidate.candidateId) ?? []).length !== 1) {
      exactCensoredCandidateClocks++;
      censors.push(censor(candidate, "duplicate_candidate", candidate.candidateId));
      continue;
    }
    if (!validCandidate(candidate)) {
      exactCensoredCandidateClocks++;
      censors.push(censor(candidate, "invalid_candidate", candidate.occSymbol));
      continue;
    }
    const flattenAtMs = et1525Ms(candidate.sessionDateEt);
    if (candidate.decisionAtMs >= flattenAtMs) {
      exactCensoredCandidateClocks++;
      censors.push(censor(candidate, "entry_after_flatten",
        new Date(flattenAtMs).toISOString()));
      continue;
    }
    const exact = exactContractQuotes(
      candidate,
      input.quotesByOccSession.get(
        `${candidate.sessionDateEt}\u0000${candidate.occSymbol}`,
      ) ?? [],
      censors,
    );
    if (!exact) {
      exactCensoredCandidateClocks++;
      continue;
    }
    const entry = [...exact].reverse()
      .find((quote) => quote.atMs <= candidate.decisionAtMs);
    if (!entry) {
      exactCensoredCandidateClocks++;
      censors.push(censor(candidate, "missing_entry_state",
        new Date(candidate.decisionAtMs).toISOString()));
      continue;
    }
    if (!(entry.ask > 0) || entry.ask < entry.bid) {
      exactCensoredCandidateClocks++;
      censors.push(censor(candidate, "invalid_entry_ask", `${entry.bid}/${entry.ask}`));
      continue;
    }
    const terminal = [...exact].reverse()
      .find((quote) => quote.atMs <= flattenAtMs);
    if (!terminal || terminal.atMs < candidate.decisionAtMs) {
      exactCensoredCandidateClocks++;
      censors.push(censor(candidate, "missing_terminal_state",
        new Date(flattenAtMs).toISOString()));
      continue;
    }
    eligible.push({
      candidate,
      entry,
      flattenAtMs,
      quotes: exact
        .filter((quote) => quote.atMs >= entry.atMs && quote.atMs <= flattenAtMs)
        .map((quote) => ({ atMs: quote.atMs, bid: quote.bid })),
    });
  }

  const activeUntil = new Map<string, number>();
  const paths: Rc54SealedStudyPath[] = [];
  let managerProfilesEvaluated = 0;
  let overlappingManagerClocksCensored = 0;
  for (const row of eligible) {
    const underlying = row.candidate.occSymbol.match(/^[A-Z]{1,6}/)?.[0] ?? "";
    const bars = input.barsByUnderlyingSession.get(
      `${row.candidate.sessionDateEt}\u0000${underlying}`,
    ) ?? [];
    for (const profile of studyProfiles(row.candidate, nativeAtrTargetGrid)) {
      const key = lane(row.candidate, profile.id);
      const priorExit = activeUntil.get(key);
      if (priorExit != null && row.candidate.decisionAtMs < priorExit) {
        overlappingManagerClocksCensored++;
        censors.push(censor(row.candidate, "sequential_reentry_active",
          new Date(priorExit).toISOString(), profile.id));
        continue;
      }
      if (profile.nativeAtrTargetPct != null && !bars.length) {
        censors.push(censor(row.candidate, "missing_underlying_bars",
          `${underlying}/${row.candidate.sessionDateEt}`, profile.id));
        continue;
      }
      managerProfilesEvaluated++;
      const sealedProfile = profile.id === "FULL-RIDE"
        ? "RC53-RIDE"
        : profile.id === "FULL-A13"
          ? "RC53-A13"
          : "QQQ54-B20-NATIVE-ATR";
      const outcome = replayRc54SealedManager({
        profile: sealedProfile,
        entryAsk: row.entry.ask,
        entryAtMs: row.candidate.decisionAtMs,
        flattenAtMs: row.flattenAtMs,
        quotes: row.quotes,
        occSymbol: row.candidate.occSymbol,
        underlyingBars: profile.nativeAtrTargetPct == null ? undefined : bars,
        nativeAtrTargetPct: profile.nativeAtrTargetPct ?? undefined,
      });
      if (!outcome.exact || outcome.exitAtMs == null || outcome.pnl == null
        || outcome.pnlPerContract == null || outcome.lots.length !== 2) {
        censors.push(censor(row.candidate, "manager_path_incomplete",
          outcome.censors.join(",") || "unknown", profile.id));
        continue;
      }
      activeUntil.set(key, outcome.exitAtMs);
      paths.push({
        candidateId: row.candidate.candidateId,
        sessionDateEt: row.candidate.sessionDateEt,
        channelSlug: row.candidate.channelSlug,
        occSymbol: row.candidate.occSymbol,
        profileId: profile.id,
        nativeAtrTargetPct: profile.nativeAtrTargetPct,
        decisionAt: new Date(row.candidate.decisionAtMs).toISOString(),
        entryQuoteAt: new Date(row.entry.atMs).toISOString(),
        entryAsk: row.entry.ask,
        exitAt: new Date(outcome.exitAtMs).toISOString(),
        pnl: outcome.pnl,
        pnlPerContract: outcome.pnlPerContract,
        lotExits: outcome.lots.map((lot) => ({
          lot: lot.lot,
          exitAt: new Date(lot.exitAtMs).toISOString(),
          exitBid: lot.exitBid,
          exitReason: lot.exitReason,
          returnPct: lot.returnPct,
          pnl: lot.pnl,
        })),
        basis:
          "databento_entry_ask_to_executable_bid_plus_completed_underlying_bars",
        independentOpportunity: true,
      });
    }
  }

  const result = {
    version: RC54_SEALED_MANAGER_STUDY_VERSION,
    nativeAtrTargetGrid,
    source: {
      rawCandidateClocks: input.candidates.length,
      distinctCandidateClocks: candidateGroups.size,
      exactEligibleCandidateClocks: eligible.length,
      exactCensoredCandidateClocks,
      managerProfilesEvaluated,
      independentManagerPaths: paths.length,
      overlappingManagerClocksCensored,
    },
    paths: paths.sort((left, right) =>
      left.sessionDateEt.localeCompare(right.sessionDateEt)
      || left.channelSlug.localeCompare(right.channelSlug)
      || left.profileId.localeCompare(right.profileId)
      || left.decisionAt.localeCompare(right.decisionAt)
      || left.candidateId.localeCompare(right.candidateId)),
    censors: censors.sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId)
      || String(left.profileId).localeCompare(String(right.profileId))
      || left.code.localeCompare(right.code)),
    methodology: {
      entry: "last_databento_cbbo_ask_at_or_before_decision" as const,
      optionExit:
        "first_executable_bid_crossing_risk_first_else_last_bid_at_or_before_1525_et" as const,
      nativeAtr:
        "completed_rth_underlying_close_peak_and_atr14_range_mean_at_1m_bar_close" as const,
      nativeAtrOptionValuation:
        "last_executable_databento_bid_at_or_before_underlying_trigger" as const,
      stopPct: -30 as const,
      quantity: 2 as const,
      reentry:
        "disabled_per_session_channel_profile_until_both_lots_exit" as const,
      adds: 0 as const,
      historicalVirtualOutcomesIgnored: true as const,
      externalWrites: false as const,
      orderPathAuthorized: false as const,
      policyChangeAuthorized: false as const,
    },
  };
  return { ...result, canonicalSha256: hash(result) };
}
