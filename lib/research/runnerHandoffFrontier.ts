import type { TrailEvidenceLayer, TrailOpportunity } from "./channelTrailFrontier";

export const RUNNER_HANDOFF_FRONTIER_VERSION = "runner-handoff-frontier-v1" as const;

export type RunnerHandoffCandidateId =
  | "CURRENT_HANDOFF"
  | "POST_BANK_BREAKEVEN_A13"
  | "BANK_IMMEDIATE_GAIN_RETENTION"
  | "BANK_FIXED_RUNNER_TARGET"
  | "ALL_OUT_AT_BANK";

export interface RunnerHandoffProfile {
  channel: string;
  profileId: string;
  profileSource: "active_spec" | "historical_reference";
  channelSpecDatabaseId: string | null;
  bankPct: number;
  runnerFraction: number;
  armPct: number;
  retainPeakGain: number;
  catastropheStopPct: number;
  fixedRunnerTargetPct: number;
}

export interface RunnerHandoffCandidate {
  id: RunnerHandoffCandidateId;
  label: string;
  plainLanguage: string;
}

export const RUNNER_HANDOFF_CANDIDATES: readonly RunnerHandoffCandidate[] = [
  {
    id: "CURRENT_HANDOFF",
    label: "CURRENT HANDOFF",
    plainLanguage: "Bank half, then preserve the current pre-arm price ratchet and A13 runner.",
  },
  {
    id: "POST_BANK_BREAKEVEN_A13",
    label: "BANK · BREAKEVEN · A13",
    plainLanguage: "After banking, do not let the runner finish below entry while waiting for A13 to arm.",
  },
  {
    id: "BANK_IMMEDIATE_GAIN_RETENTION",
    label: "BANK · LOCK GAIN NOW",
    plainLanguage: "After banking, immediately retain the configured share of the runner's best gain.",
  },
  {
    id: "BANK_FIXED_RUNNER_TARGET",
    label: "BANK · FIXED SECOND TARGET",
    plainLanguage: "Bank half, then take the runner at the configured fixed second target.",
  },
  {
    id: "ALL_OUT_AT_BANK",
    label: "ALL OUT AT BANK",
    plainLanguage: "Close the full position when the first bank target is reached.",
  },
] as const;

export interface RunnerHandoffPathResult {
  logicalOpportunityId: string;
  channel: string;
  session: string;
  configurationEra: string;
  evidenceLayer: TrailEvidenceLayer;
  profileId: string;
  profileSource: RunnerHandoffProfile["profileSource"];
  candidateId: RunnerHandoffCandidateId;
  state: "scored" | "censored";
  censorCode: "missing_executable_path" | "staged_manager_requires_two_contracts" | null;
  bankHit: boolean;
  runnerArmed: boolean;
  exitAt: string | null;
  exitReason:
    | "catastrophe_stop"
    | "current_prearm_ratchet"
    | "breakeven_floor"
    | "gain_retention"
    | "a13"
    | "fixed_runner_target"
    | "all_out_bank"
    | "time_flatten"
    | null;
  nativeReturnPct: number;
  candidateReturnPct: number | null;
  deltaVsNativePct: number | null;
  candidatePnlUsd: number | null;
  runnerExitReturnPct: number | null;
  mfePct: number | null;
  captureRatio: number | null;
  laterPeakAfterExitPct: number | null;
  reboundAfterExit: boolean | null;
}

export interface RunnerHandoffCandidateSummary {
  candidateId: RunnerHandoffCandidateId;
  label: string;
  pairedOpportunities: number;
  censoredOpportunities: number;
  sessions: number;
  bankHitFrequency: number | null;
  bankHitOpportunities: number;
  bankHitSessions: number;
  runnerArmFrequency: number | null;
  typicalResultPct: number | null;
  totalPnlUsd: number | null;
  typicalBenefitVsNativePct: number | null;
  improvementFrequency: number | null;
  typicalBenefitVsCurrentPct: number | null;
  improvementVsCurrentFrequency: number | null;
  typicalBankHitResultPct: number | null;
  bankHitTotalPnlUsd: number | null;
  typicalBankHitBenefitVsCurrentPct: number | null;
  postBankLossFrequency: number | null;
  negativeRunnerFrequency: number | null;
  lossFrequency: number | null;
  typicalCapture: number | null;
  downsideResultPct: number | null;
  reboundAfterExitFrequency: number | null;
  typicalLaterPeakAfterExitPct: number | null;
}

export interface RunnerHandoffEra {
  channel: string;
  configurationEra: string;
  evidenceLayer: TrailEvidenceLayer;
  profile: RunnerHandoffProfile;
  rollup: boolean;
  includedConfigurationEras: string[];
  opportunities: number;
  sessions: number;
  candidates: RunnerHandoffCandidateSummary[];
  leadingCandidateId: RunnerHandoffCandidateId | null;
  disposition: "investigate_handoff" | "current_handoff_holds" | "collect_paths";
  plainLanguage: string;
  limitations: string[];
}

export interface RunnerHandoffFrontierBook {
  schemaVersion: 1;
  frontierVersion: typeof RUNNER_HANDOFF_FRONTIER_VERSION;
  generatedAt: string;
  throughSession: string;
  candidates: readonly RunnerHandoffCandidate[];
  profiles: RunnerHandoffProfile[];
  eras: RunnerHandoffEra[];
  channelSpecRollups: RunnerHandoffEra[];
  sourceOpportunities: number;
  productionWrites: 0;
  orderAuthority: false;
  configurationAuthority: false;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null): value is number => value != null && Number.isFinite(value);

function quantile(values: readonly number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return round(sorted[low] + (sorted[high] - sorted[low]) * (index - low));
}

function orderedQuotes(opportunity: TrailOpportunity) {
  const entryMs = Date.parse(opportunity.entryAt);
  const byClock = new Map<number, { at: string; bid: number }>();
  for (const quote of opportunity.quotes) {
    const atMs = Date.parse(quote.at);
    if (!Number.isFinite(atMs) || atMs < entryMs || !(quote.bid > 0)) continue;
    byClock.set(atMs, { at: new Date(atMs).toISOString(), bid: quote.bid });
  }
  return [...byClock].sort(([left], [right]) => left - right).map(([, quote]) => quote);
}

function blend(quantity: number, bankReturn: number, runnerReturn: number, runnerFraction: number): number {
  const runnerQuantity = Math.max(1, Math.min(quantity - 1, Math.round(quantity * runnerFraction)));
  const bankQuantity = quantity - runnerQuantity;
  return (bankReturn * bankQuantity + runnerReturn * runnerQuantity) / quantity;
}

function replay(opportunity: TrailOpportunity, profile: RunnerHandoffProfile,
  candidateId: RunnerHandoffCandidateId): RunnerHandoffPathResult {
  const base = {
    logicalOpportunityId: opportunity.logicalOpportunityId,
    channel: opportunity.channel,
    session: opportunity.session,
    configurationEra: opportunity.configurationEra,
    evidenceLayer: opportunity.evidenceLayer,
    profileId: profile.profileId,
    profileSource: profile.profileSource,
    candidateId,
    nativeReturnPct: opportunity.nativeReturnPct,
  };
  const quotes = orderedQuotes(opportunity);
  if (!quotes.length) return {
    ...base, state: "censored", censorCode: "missing_executable_path", bankHit: false,
    runnerArmed: false, exitAt: null, exitReason: null, candidateReturnPct: null,
    deltaVsNativePct: null, candidatePnlUsd: null, mfePct: null, captureRatio: null,
    runnerExitReturnPct: null,
    laterPeakAfterExitPct: null, reboundAfterExit: null,
  };
  if (opportunity.quantity < 2) return {
    ...base, state: "censored", censorCode: "staged_manager_requires_two_contracts", bankHit: false,
    runnerArmed: false, exitAt: null, exitReason: null, candidateReturnPct: null,
    deltaVsNativePct: null, candidatePnlUsd: null, mfePct: null, captureRatio: null,
    runnerExitReturnPct: null,
    laterPeakAfterExitPct: null, reboundAfterExit: null,
  };
  const returns = quotes.map((quote) => round((quote.bid / opportunity.entryPrice - 1) * 100));
  const mfePct = Math.max(...returns);
  let bankHit = false;
  let runnerArmed = false;
  let runnerPeakPct = Number.NEGATIVE_INFINITY;
  let candidateReturn = returns.at(-1)!;
  let exitIndex = quotes.length - 1;
  let exitReason: NonNullable<RunnerHandoffPathResult["exitReason"]> = "time_flatten";
  let runnerExitReturnPct: number | null = null;

  for (let index = 0; index < returns.length; index += 1) {
    const current = returns[index];
    if (!bankHit) {
      if (current <= -profile.catastropheStopPct) {
        candidateReturn = -profile.catastropheStopPct;
        exitIndex = index;
        exitReason = "catastrophe_stop";
        break;
      }
      if (current < profile.bankPct) continue;
      bankHit = true;
      runnerPeakPct = Math.max(profile.bankPct, current);
      if (candidateId === "ALL_OUT_AT_BANK") {
        candidateReturn = profile.bankPct;
        exitIndex = index;
        exitReason = "all_out_bank";
        break;
      }
    } else runnerPeakPct = Math.max(runnerPeakPct, current);

    const runnerReturn = current;
    if (candidateId === "BANK_FIXED_RUNNER_TARGET" && runnerReturn >= profile.fixedRunnerTargetPct) {
      candidateReturn = blend(opportunity.quantity, profile.bankPct, profile.fixedRunnerTargetPct, profile.runnerFraction);
      runnerExitReturnPct = profile.fixedRunnerTargetPct;
      exitIndex = index;
      exitReason = "fixed_runner_target";
      break;
    }

    if (candidateId === "CURRENT_HANDOFF") {
      // Mirrors the worker's generic runner ratchet: it retains a share of the
      // entire option price and can therefore place its floor below entry.
      const pricePeakMultiple = 1 + runnerPeakPct / 100;
      const genericFloorPct = (pricePeakMultiple * profile.retainPeakGain - 1) * 100;
      if (runnerPeakPct > 0 && runnerReturn <= genericFloorPct) {
        candidateReturn = blend(opportunity.quantity, profile.bankPct, genericFloorPct, profile.runnerFraction);
        runnerExitReturnPct = genericFloorPct;
        exitIndex = index;
        exitReason = "current_prearm_ratchet";
        break;
      }
    }

    if (candidateId === "POST_BANK_BREAKEVEN_A13" && runnerPeakPct < profile.armPct && runnerReturn <= 0) {
      candidateReturn = blend(opportunity.quantity, profile.bankPct, 0, profile.runnerFraction);
      runnerExitReturnPct = 0;
      exitIndex = index;
      exitReason = "breakeven_floor";
      break;
    }

    if (candidateId === "BANK_IMMEDIATE_GAIN_RETENTION") {
      const floor = runnerPeakPct * profile.retainPeakGain;
      if (runnerReturn <= floor) {
        candidateReturn = blend(opportunity.quantity, profile.bankPct, floor, profile.runnerFraction);
        runnerExitReturnPct = floor;
        exitIndex = index;
        exitReason = "gain_retention";
        break;
      }
    }

    if (runnerReturn <= -profile.catastropheStopPct) {
      candidateReturn = blend(opportunity.quantity, profile.bankPct, -profile.catastropheStopPct, profile.runnerFraction);
      runnerExitReturnPct = -profile.catastropheStopPct;
      exitIndex = index;
      exitReason = "catastrophe_stop";
      break;
    }

    if ((candidateId === "CURRENT_HANDOFF" || candidateId === "POST_BANK_BREAKEVEN_A13")
      && runnerPeakPct >= profile.armPct) {
      runnerArmed = true;
      const floor = runnerPeakPct * profile.retainPeakGain;
      if (runnerReturn <= floor) {
        candidateReturn = blend(opportunity.quantity, profile.bankPct, floor, profile.runnerFraction);
        runnerExitReturnPct = floor;
        exitIndex = index;
        exitReason = "a13";
        break;
      }
    }

    if (index === returns.length - 1) {
      candidateReturn = blend(opportunity.quantity, profile.bankPct, runnerReturn, profile.runnerFraction);
      runnerExitReturnPct = runnerReturn;
    }
  }

  const laterPeak = exitIndex < returns.length - 1 ? Math.max(...returns.slice(exitIndex + 1)) : null;
  const delta = round(candidateReturn - opportunity.nativeReturnPct);
  const candidatePnlUsd = round(candidateReturn * opportunity.entryPrice * opportunity.quantity);
  return {
    ...base, state: "scored", censorCode: null, bankHit, runnerArmed,
    exitAt: quotes[exitIndex].at, exitReason, candidateReturnPct: round(candidateReturn),
    deltaVsNativePct: delta, candidatePnlUsd, mfePct: round(mfePct),
    runnerExitReturnPct: runnerExitReturnPct == null ? null : round(runnerExitReturnPct),
    captureRatio: mfePct > 0 ? round(candidateReturn / mfePct) : null,
    laterPeakAfterExitPct: laterPeak == null ? null : round(laterPeak),
    reboundAfterExit: laterPeak == null ? null : laterPeak >= profile.bankPct,
  };
}

function summarize(candidate: RunnerHandoffCandidate, rows: readonly RunnerHandoffPathResult[],
  currentByOpportunity: ReadonlyMap<string, RunnerHandoffPathResult>, total: number): RunnerHandoffCandidateSummary {
  const scored = rows.filter((row) => row.state === "scored" && finite(row.candidateReturnPct));
  const count = scored.length;
  const bankHits = scored.filter((row) => row.bankHit);
  const withCurrent = scored.map((row) => ({ row, current: currentByOpportunity.get(row.logicalOpportunityId) }))
    .filter((pair): pair is { row: RunnerHandoffPathResult; current: RunnerHandoffPathResult } =>
      pair.current?.state === "scored" && finite(pair.current.candidateReturnPct));
  const versusCurrent = withCurrent.map(({ row, current }) => round((row.candidateReturnPct as number) - (current.candidateReturnPct as number)));
  const bankHitVersusCurrent = withCurrent.filter(({ row }) => row.bankHit)
    .map(({ row, current }) => round((row.candidateReturnPct as number) - (current.candidateReturnPct as number)));
  const ratio = (predicate: (row: RunnerHandoffPathResult) => boolean): number | null =>
    count ? round(scored.filter(predicate).length / count) : null;
  const bankRatio = (predicate: (row: RunnerHandoffPathResult) => boolean): number | null =>
    bankHits.length ? round(bankHits.filter(predicate).length / bankHits.length) : null;
  const exitsWithFuture = bankHits.filter((row) => row.reboundAfterExit != null);
  return {
    candidateId: candidate.id,
    label: candidate.label,
    pairedOpportunities: count,
    censoredOpportunities: total - count,
    sessions: new Set(scored.map((row) => row.session)).size,
    bankHitFrequency: ratio((row) => row.bankHit),
    bankHitOpportunities: bankHits.length,
    bankHitSessions: new Set(bankHits.map((row) => row.session)).size,
    runnerArmFrequency: bankRatio((row) => row.runnerArmed),
    typicalResultPct: quantile(scored.map((row) => row.candidateReturnPct).filter(finite), .5),
    totalPnlUsd: count ? round(scored.map((row) => row.candidatePnlUsd).filter(finite).reduce((sum, value) => sum + value, 0)) : null,
    typicalBenefitVsNativePct: quantile(scored.map((row) => row.deltaVsNativePct).filter(finite), .5),
    improvementFrequency: ratio((row) => (row.deltaVsNativePct ?? 0) > 0),
    typicalBenefitVsCurrentPct: quantile(versusCurrent, .5),
    improvementVsCurrentFrequency: versusCurrent.length
      ? round(versusCurrent.filter((value) => value > 0).length / versusCurrent.length) : null,
    typicalBankHitResultPct: quantile(bankHits.map((row) => row.candidateReturnPct).filter(finite), .5),
    bankHitTotalPnlUsd: bankHits.length
      ? round(bankHits.map((row) => row.candidatePnlUsd).filter(finite).reduce((sum, value) => sum + value, 0)) : null,
    typicalBankHitBenefitVsCurrentPct: quantile(bankHitVersusCurrent, .5),
    postBankLossFrequency: bankRatio((row) => (row.candidateReturnPct ?? 0) < 0),
    negativeRunnerFrequency: (() => {
      const runnerRows = bankHits.filter((row) => finite(row.runnerExitReturnPct));
      return runnerRows.length
        ? round(runnerRows.filter((row) => (row.runnerExitReturnPct as number) < 0).length / runnerRows.length)
        : null;
    })(),
    lossFrequency: ratio((row) => (row.candidateReturnPct ?? 0) < 0),
    typicalCapture: quantile(scored.map((row) => row.captureRatio).filter(finite), .5),
    downsideResultPct: quantile(scored.map((row) => row.candidateReturnPct).filter(finite), .1),
    reboundAfterExitFrequency: exitsWithFuture.length
      ? round(exitsWithFuture.filter((row) => row.reboundAfterExit).length / exitsWithFuture.length) : null,
    typicalLaterPeakAfterExitPct: quantile(exitsWithFuture.map((row) => row.laterPeakAfterExitPct).filter(finite), .5),
  };
}

function buildEra(profile: RunnerHandoffProfile, configurationEra: string,
  evidenceLayer: TrailEvidenceLayer, opportunities: readonly TrailOpportunity[],
  includedConfigurationEras = [configurationEra]): RunnerHandoffEra {
  const paths = new Map(RUNNER_HANDOFF_CANDIDATES.map((candidate) => [candidate.id,
    opportunities.map((opportunity) => replay(opportunity, profile, candidate.id))]));
  const currentByOpportunity = new Map((paths.get("CURRENT_HANDOFF") ?? [])
    .map((row) => [row.logicalOpportunityId, row]));
  const candidates = RUNNER_HANDOFF_CANDIDATES.map((candidate) => summarize(candidate,
    paths.get(candidate.id) ?? [], currentByOpportunity, opportunities.length));
  const current = candidates.find((row) => row.candidateId === "CURRENT_HANDOFF")!;
  const challengers = candidates.filter((row) => row.candidateId !== "CURRENT_HANDOFF" && row.pairedOpportunities > 0);
  const ranked = [...challengers].sort((left, right) =>
    (right.typicalBankHitBenefitVsCurrentPct ?? -Infinity) - (left.typicalBankHitBenefitVsCurrentPct ?? -Infinity)
    || (right.typicalBankHitResultPct ?? -Infinity) - (left.typicalBankHitResultPct ?? -Infinity)
    || (right.downsideResultPct ?? -Infinity) - (left.downsideResultPct ?? -Infinity));
  const leading = ranked[0] ?? null;
  const enough = current.bankHitOpportunities >= 10 && current.bankHitSessions >= 5;
  const investigates = enough && leading != null
    && (leading.typicalBankHitBenefitVsCurrentPct ?? 0) > 0
    && (leading.negativeRunnerFrequency ?? 1) <= (current.negativeRunnerFrequency ?? 1);
  return {
    channel: profile.channel, configurationEra, evidenceLayer, profile,
    rollup: includedConfigurationEras.length > 1,
    includedConfigurationEras: [...includedConfigurationEras].sort(),
    opportunities: opportunities.length, sessions: new Set(opportunities.map((row) => row.session)).size,
    candidates, leadingCandidateId: leading?.candidateId ?? null,
    disposition: opportunities.some((row) => row.quotes.length)
      ? !enough ? "collect_paths" : investigates ? "investigate_handoff" : "current_handoff_holds" : "collect_paths",
    plainLanguage: opportunities.some((row) => row.quotes.length)
      ? !enough
        ? `Only ${current.bankHitOpportunities} bank-hit paths across ${current.bankHitSessions} sessions can distinguish the handoff; continue paired collection before changing it.`
        : investigates
        ? `${leading?.label ?? "A challenger"} improves the paired typical result without worsening the observed lower tail; keep it as a paper-shadow investigation until rebound cost is resolved.`
        : "No handoff challenger clears the bounded evidence rule; preserve the current profile and continue paired collection."
      : "No complete executable-bid path is available for a fair runner-handoff comparison yet.",
    limitations: [
      "Every candidate uses the same entry, contract, quantity, session, and configuration era.",
      "Threshold exits are credited at the threshold and do not model spread, slippage, or queue position.",
      "An early floor can avoid a loss and still miss a later recovery; rebound-after-exit is reported explicitly.",
      "Historical-reference profiles are research controls, not current production configurations.",
    ],
  };
}

export function buildRunnerHandoffFrontier(input: {
  generatedAt: string;
  throughSession: string;
  opportunities: readonly TrailOpportunity[];
  profiles: readonly RunnerHandoffProfile[];
}): RunnerHandoffFrontierBook {
  const profiles = input.profiles.filter((profile) => profile.channel && profile.bankPct > 0
    && profile.runnerFraction > 0 && profile.runnerFraction < 1 && profile.armPct >= profile.bankPct
    && profile.retainPeakGain > 0 && profile.retainPeakGain < 1 && profile.catastropheStopPct > 0);
  const valid = input.opportunities.filter((row) => row.session <= input.throughSession
    && row.channel && row.configurationEra && row.entryPrice > 0 && row.quantity > 0
    && Number.isFinite(row.nativeReturnPct));
  const eras: RunnerHandoffEra[] = [];
  const channelSpecRollups: RunnerHandoffEra[] = [];
  for (const profile of profiles) {
    const matching = valid.filter((row) => row.channel === profile.channel);
    const byEra = new Map<string, TrailOpportunity[]>();
    for (const row of matching) {
      const key = `${row.evidenceLayer}\u0000${row.configurationEra}`;
      byEra.set(key, [...(byEra.get(key) ?? []), row]);
    }
    for (const [key, rows] of byEra) {
      const [evidenceLayer, configurationEra] = key.split("\u0000") as [TrailEvidenceLayer, string];
      eras.push(buildEra(profile, configurationEra, evidenceLayer, rows));
    }
    if (profile.channelSpecDatabaseId) {
      for (const evidenceLayer of ["executed", "virtual"] as const) {
        const exact = matching.filter((row) => row.evidenceLayer === evidenceLayer
          && (row.configurationEra === `channel-spec:${profile.channelSpecDatabaseId}`
            || row.configurationEra.startsWith(`epoch:${profile.channelSpecDatabaseId}:`)));
        const included = [...new Set(exact.map((row) => row.configurationEra))];
        if (exact.length && included.length > 1) channelSpecRollups.push(buildEra(profile,
          `channel-spec-rollup:${profile.channelSpecDatabaseId}`, evidenceLayer, exact, included));
      }
    }
  }
  return {
    schemaVersion: 1,
    frontierVersion: RUNNER_HANDOFF_FRONTIER_VERSION,
    generatedAt: input.generatedAt,
    throughSession: input.throughSession,
    candidates: RUNNER_HANDOFF_CANDIDATES,
    profiles: [...profiles].sort((left, right) => left.channel.localeCompare(right.channel)
      || left.profileSource.localeCompare(right.profileSource)),
    eras: eras.sort((left, right) => left.channel.localeCompare(right.channel)
      || left.profile.profileSource.localeCompare(right.profile.profileSource)
      || left.evidenceLayer.localeCompare(right.evidenceLayer)
      || right.opportunities - left.opportunities
      || left.configurationEra.localeCompare(right.configurationEra)),
    channelSpecRollups: channelSpecRollups.sort((left, right) => left.channel.localeCompare(right.channel)
      || left.evidenceLayer.localeCompare(right.evidenceLayer)),
    sourceOpportunities: valid.length,
    productionWrites: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
}
