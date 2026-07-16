// Pure adapter from durable observer + exact trade-path receipts into the
// phase1k-e-family-preregister-v1 scorer. It owns no client, filesystem,
// persistence, strategy, order, or production dependency.

import type { FamilyAdmissionReceipt } from "./observerScorecard.js";
import { isExactDatabentoPathEligible, optionSideForTrade } from "./preregisteredPathTests.js";
import type { TradePathResult } from "./tradePathAnalysis.js";
import {
  FAMILY_PREREGISTERED_TESTS,
  type FamilyPreregisteredTest,
} from "./familyPreregistration.js";
import type {
  CollisionScoreInput,
  MatchedPairScoreInput,
  PairMetrics,
  PathViabilityScoreInput,
} from "./familyPreregisteredScorer.js";

export type FamilyReceiptCensorCode =
  | "invalid_observation_clock"
  | "candidate_set_mismatch"
  | "admission_arm_mismatch"
  | "missing_opportunity_path"
  | "opportunity_path_ineligible"
  | "opportunity_quantity_mismatch"
  | "opportunity_clock_mismatch"
  | "duplicate_channel_at_clock"
  | "exact_path_ineligible"
  | "missing_path_metrics";

export interface FamilyReceiptCensor {
  testId: string;
  receiptId: string;
  sessionDateEt: string | null;
  code: FamilyReceiptCensorCode;
}

export interface FamilyPreregisteredAdapterResult {
  collisions: CollisionScoreInput[];
  matchedPairs: MatchedPairScoreInput[];
  paths: PathViabilityScoreInput[];
  censors: FamilyReceiptCensor[];
  source: {
    familyObservations: number;
    tradePaths: number;
    exactNativeTradePaths: number;
  };
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const dateEt = (atMs: number): string | null => finite(atMs) ? ET_DATE.format(new Date(atMs)) : null;
const observationDateEt = (iso: string): string | null => {
  const atMs = Date.parse(iso);
  return finite(atMs) ? dateEt(atMs) : null;
};

function metrics(trade: TradePathResult | null): PairMetrics {
  return {
    realizedPnl: trade?.realizedPnl ?? Number.NaN,
    mfePct: trade?.path.observedMfePct ?? Number.NaN,
    maePct: trade?.path.observedMaePct ?? Number.NaN,
    realizedCaptureRatio: trade?.path.realizedCaptureRatio ?? null,
  };
}

function allPairMetricsFinite(value: PairMetrics): boolean {
  return [value.realizedPnl, value.mfePct, value.maePct].every(finite);
}

function sameChannels(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collisionInputs(
  test: FamilyPreregisteredTest,
  observations: readonly FamilyAdmissionReceipt[],
  tradesByOpportunity: ReadonlyMap<string, readonly TradePathResult[]>,
  censors: FamilyReceiptCensor[],
): CollisionScoreInput[] {
  return observations.filter((observation) => observation.familyId === test.family).map((observation) => {
    const sessionDateEt = observationDateEt(observation.sourceBarAt);
    const sourceBarAtMs = Date.parse(observation.sourceBarAt);
    const codes = new Set<FamilyReceiptCensorCode>();
    if (!sessionDateEt || !finite(sourceBarAtMs)) codes.add("invalid_observation_clock");
    if (!sameChannels(observation.candidates.map((candidate) => candidate.channelSlug), test.channels)) {
      codes.add("candidate_set_mismatch");
    }
    const candidateByOpportunity = new Map(observation.candidates.map((candidate) => [candidate.opportunityId, candidate]));
    const survivorByChannel = new Map<string, number>();
    let nativeClusterPnl = 0;
    for (const candidate of observation.candidates) {
      const paths = tradesByOpportunity.get(candidate.opportunityId) ?? [];
      if (!paths.length) {
        codes.add("missing_opportunity_path");
        continue;
      }
      if (paths.some((trade) => !isExactDatabentoPathEligible(trade))) codes.add("opportunity_path_ineligible");
      if (paths.some((trade) => trade.channel !== candidate.channelSlug || trade.sourceBarAtMs !== sourceBarAtMs)) {
        codes.add("opportunity_clock_mismatch");
      }
      const quantity = paths.reduce((sum, trade) => sum + (trade.quantity ?? 0), 0);
      if (quantity !== candidate.requestedQty) codes.add("opportunity_quantity_mismatch");
      const pnl = paths.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0);
      nativeClusterPnl += pnl;
      survivorByChannel.set(candidate.channelSlug, pnl);
    }
    const arms = observation.admissionArms.flatMap((arm) => {
      const keep = candidateByOpportunity.get(arm.keepOpportunityId);
      if (!keep || arm.rejectOpportunityIds.length !== observation.candidates.length - 1
          || observation.candidates.some((candidate) => candidate.opportunityId !== arm.keepOpportunityId
            && !arm.rejectOpportunityIds.includes(candidate.opportunityId))) {
        codes.add("admission_arm_mismatch");
        return [];
      }
      const survivorPnl = survivorByChannel.get(keep.channelSlug);
      return finite(survivorPnl) ? [{ channel: keep.channelSlug, survivorPnl }] : [];
    });
    if (!sameChannels(arms.map((arm) => arm.channel), test.channels)) codes.add("admission_arm_mismatch");
    for (const code of codes) censors.push({ testId: test.id, receiptId: observation.id, sessionDateEt, code });
    return {
      testId: test.id,
      observationId: observation.id,
      sessionDateEt: sessionDateEt ?? "invalid-date",
      family: observation.familyId,
      nativeClusterPnl: codes.size ? Number.NaN : nativeClusterPnl,
      arms,
      eligible: codes.size === 0,
    };
  });
}

function matchedPairInputs(
  test: FamilyPreregisteredTest,
  trades: readonly TradePathResult[],
  censors: FamilyReceiptCensor[],
): MatchedPairScoreInput[] {
  const byClock = new Map<string, TradePathResult[]>();
  for (const trade of trades) {
    const side = optionSideForTrade(trade);
    if (trade.sourceBarAtMs == null || !side || trade.underlying !== test.underlying) continue;
    const key = `${trade.underlying}|${side}|${trade.sourceBarAtMs}`;
    byClock.set(key, [...(byClock.get(key) ?? []), trade]);
  }
  const controlChannel = test.controlChannel as string;
  const challengerChannel = test.challengerChannel as string;
  return [...byClock.entries()].flatMap(([clockId, rows]): MatchedPairScoreInput[] => {
    const controlRows = rows.filter((trade) => trade.channel === controlChannel);
    const challengerRows = rows.filter((trade) => trade.channel === challengerChannel);
    if (!controlRows.length || !challengerRows.length) return [];
    const sessionDateEt = dateEt(rows[0].sourceBarAtMs as number) ?? "invalid-date";
    const codes = new Set<FamilyReceiptCensorCode>();
    if (controlRows.length !== 1 || challengerRows.length !== 1) codes.add("duplicate_channel_at_clock");
    const controlTrade = controlRows.length === 1 ? controlRows[0] : null;
    const challengerTrade = challengerRows.length === 1 ? challengerRows[0] : null;
    if (!controlTrade || !challengerTrade
        || !isExactDatabentoPathEligible(controlTrade)
        || !isExactDatabentoPathEligible(challengerTrade)) codes.add("exact_path_ineligible");
    const control = metrics(controlTrade);
    const challenger = metrics(challengerTrade);
    if (!allPairMetricsFinite(control) || !allPairMetricsFinite(challenger)) codes.add("missing_path_metrics");
    for (const code of codes) censors.push({ testId: test.id, receiptId: clockId, sessionDateEt, code });
    return [{
      testId: test.id,
      clockId,
      sessionDateEt,
      controlChannel,
      challengerChannel,
      control,
      challenger,
      eligible: codes.size === 0,
    }];
  }).sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt) || a.clockId.localeCompare(b.clockId));
}

function pathInputs(
  test: FamilyPreregisteredTest,
  trades: readonly TradePathResult[],
  censors: FamilyReceiptCensor[],
): PathViabilityScoreInput[] {
  const channel = test.channels[0];
  return trades.filter((trade) => trade.channel === channel && trade.underlying === test.underlying).map((trade) => {
    const sessionDateEt = dateEt(trade.openedAtMs) ?? "invalid-date";
    const codes = new Set<FamilyReceiptCensorCode>();
    if (!isExactDatabentoPathEligible(trade)) codes.add("exact_path_ineligible");
    if (![trade.realizedPnl, trade.path.observedMfePct, trade.path.observedMaePct].every(finite)) codes.add("missing_path_metrics");
    for (const code of codes) censors.push({ testId: test.id, receiptId: trade.positionId, sessionDateEt, code });
    const touched = (targetPct: number): boolean => trade.path.targetTouches.some((row) => row.targetPct === targetPct && row.firstAtMs != null);
    return {
      testId: test.id,
      positionId: trade.positionId,
      sessionDateEt,
      channel,
      realizedPnl: trade.realizedPnl ?? Number.NaN,
      mfePct: trade.path.observedMfePct ?? Number.NaN,
      maePct: trade.path.observedMaePct ?? Number.NaN,
      secondsToPeak: trade.path.secondsToPeak,
      touched10Pct: touched(10),
      touched15Pct: touched(15),
      eligible: codes.size === 0,
    };
  }).sort((a, b) => a.sessionDateEt.localeCompare(b.sessionDateEt) || a.positionId.localeCompare(b.positionId));
}

export function adaptFamilyPreregisteredReceipts(input: {
  familyObservations: readonly FamilyAdmissionReceipt[];
  trades: readonly TradePathResult[];
}): FamilyPreregisteredAdapterResult {
  const censors: FamilyReceiptCensor[] = [];
  const byOpportunity = new Map<string, TradePathResult[]>();
  for (const trade of input.trades) if (trade.opportunityId) {
    byOpportunity.set(trade.opportunityId, [...(byOpportunity.get(trade.opportunityId) ?? []), trade]);
  }
  const collisionTests = FAMILY_PREREGISTERED_TESTS.filter((test) => test.mode === "collision_one_survivor");
  const pairTests = FAMILY_PREREGISTERED_TESTS.filter((test) => test.mode === "matched_clock_pair");
  const pathTests = FAMILY_PREREGISTERED_TESTS.filter((test) => test.mode === "channel_path_viability");
  return {
    collisions: collisionTests.flatMap((test) => collisionInputs(test, input.familyObservations, byOpportunity, censors)),
    matchedPairs: pairTests.flatMap((test) => matchedPairInputs(test, input.trades, censors)),
    paths: pathTests.flatMap((test) => pathInputs(test, input.trades, censors)),
    censors: censors.sort((a, b) => a.testId.localeCompare(b.testId) || a.receiptId.localeCompare(b.receiptId) || a.code.localeCompare(b.code)),
    source: {
      familyObservations: input.familyObservations.length,
      tradePaths: input.trades.length,
      exactNativeTradePaths: input.trades.filter(isExactDatabentoPathEligible).length,
    },
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}
