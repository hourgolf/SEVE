// Pure scorer for phase1k-e-family-preregister-v1. It consumes normalized,
// already-provenanced receipts and has no client, persistence, or runtime path.

import {
  FAMILY_PREREGISTERED_TESTS,
  classifyFamilyPreregistrationCohort,
  type FamilyPreregisteredTest,
  type FamilyPreregistrationCohort,
} from "./familyPreregistration.js";

export interface CollisionScoreInput {
  testId: string;
  observationId: string;
  sessionDateEt: string;
  family: string;
  nativeClusterPnl: number;
  arms: ReadonlyArray<{ channel: string; survivorPnl: number }>;
  eligible?: boolean;
}

export interface MatchedPairScoreInput {
  testId: string;
  clockId: string;
  sessionDateEt: string;
  controlChannel: string;
  challengerChannel: string;
  control: PairMetrics;
  challenger: PairMetrics;
  eligible?: boolean;
}

export interface PairMetrics {
  realizedPnl: number;
  mfePct: number;
  maePct: number;
  realizedCaptureRatio: number | null;
}

export interface PathViabilityScoreInput {
  testId: string;
  positionId: string;
  sessionDateEt: string;
  channel: string;
  realizedPnl: number;
  mfePct: number;
  maePct: number;
  secondsToPeak: number | null;
  touched10Pct: boolean;
  touched15Pct: boolean;
  eligible?: boolean;
}

export interface ReviewGate {
  evidenceFloorMet: boolean;
  reviewCandidate: boolean;
  blockers: string[];
  policyChangeAuthorized: false;
}

export interface CollisionArmScore extends ReviewGate {
  channel: string;
  completedGroups: number;
  independentSessions: number;
  survivorPnl: number;
  nativeClusterPnl: number;
  totalDelta: number;
  medianDelta: number | null;
  positiveDelta: number;
  negativeDelta: number;
  unchangedDelta: number;
  positiveDeltaShare: number | null;
  maximumSingleSessionShareOfPositiveDelta: number | null;
}

export interface CollisionTestScore {
  mode: "collision_one_survivor";
  test: FamilyPreregisteredTest;
  cohort: FamilyPreregistrationCohort | null;
  observedGroups: number;
  completedGroups: number;
  censoredGroups: number;
  independentSessions: number;
  nativeWinningGroups: number;
  nativeLosingGroups: number;
  arms: CollisionArmScore[];
  policyChangeAuthorized: false;
}

export interface MatchedPairTestScore extends ReviewGate {
  mode: "matched_clock_pair";
  test: FamilyPreregisteredTest;
  cohort: FamilyPreregistrationCohort | null;
  matchedClocks: number;
  censoredClocks: number;
  independentSessions: number;
  controlRealizedPnl: number;
  challengerRealizedPnl: number;
  totalRealizedDelta: number;
  medianRealizedDelta: number | null;
  positiveRealizedDelta: number;
  negativeRealizedDelta: number;
  unchangedRealizedDelta: number;
  positiveDeltaShare: number | null;
  medianMfeDelta: number | null;
  medianMaeDelta: number | null;
  medianMaeDeteriorationPctPoints: number | null;
  medianRealizedCaptureDelta: number | null;
  maximumSingleSessionShareOfPositiveDelta: number | null;
  nativeWinningOutcomes: number;
  nativeLosingOutcomes: number;
}

export interface PathViabilityTestScore extends ReviewGate {
  mode: "channel_path_viability";
  test: FamilyPreregisteredTest;
  cohort: FamilyPreregistrationCohort | null;
  exactNativePaths: number;
  censoredPaths: number;
  independentSessions: number;
  nativeWinningOutcomes: number;
  nativeLosingOutcomes: number;
  realizedPnl: number;
  touch10Rate: number | null;
  touch15Rate: number | null;
  maeMinus30Rate: number | null;
  medianMfePct: number | null;
  medianMaePct: number | null;
  medianSecondsToPeak: number | null;
}

export interface FamilyPreregisteredScorecard {
  version: "phase1k-e-family-preregister-v1";
  collisionTests: CollisionTestScore[];
  matchedPairTests: MatchedPairTestScore[];
  pathViabilityTests: PathViabilityTestScore[];
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round = (value: number, digits = 4): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const money = (value: number): number => round(value, 2);

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}

function positiveShare(values: readonly number[]): number | null {
  const decided = values.filter((value) => value !== 0);
  return decided.length ? round(decided.filter((value) => value > 0).length / decided.length) : null;
}

function sessionConcentration(rows: ReadonlyArray<{ sessionDateEt: string; delta: number }>): number | null {
  const positive = rows.filter((row) => row.delta > 0);
  const total = positive.reduce((sum, row) => sum + row.delta, 0);
  if (total <= 0) return null;
  const bySession = new Map<string, number>();
  for (const row of positive) bySession.set(row.sessionDateEt, (bySession.get(row.sessionDateEt) ?? 0) + row.delta);
  return round(Math.max(...bySession.values()) / total);
}

function cohort(dates: readonly string[]): FamilyPreregistrationCohort | null {
  return dates.length ? classifyFamilyPreregistrationCohort(dates) : null;
}

function commonEvidenceBlockers(input: {
  count: number;
  minimum: number;
  countLabel: string;
  sessions: number;
  minimumSessions: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
}): string[] {
  const blockers: string[] = [];
  if (input.count < input.minimum) blockers.push(`need ${input.minimum - input.count} more ${input.countLabel}`);
  if (input.sessions < input.minimumSessions) blockers.push(`need ${input.minimumSessions - input.sessions} more independent sessions`);
  if (input.positiveOutcomes === 0) blockers.push("need at least one positive native outcome");
  if (input.negativeOutcomes === 0) blockers.push("need at least one negative native outcome");
  return blockers;
}

function scoreCollision(test: FamilyPreregisteredTest, input: readonly CollisionScoreInput[]): CollisionTestScore {
  const observed = input.filter((row) => row.testId === test.id);
  const observedCohort = cohort(observed.map((row) => row.sessionDateEt));
  const complete = observed.filter((row) => row.eligible !== false && row.family === test.family
    && finite(row.nativeClusterPnl)
    && row.arms.length === test.channels.length
    && new Set(row.arms.map((arm) => arm.channel)).size === test.channels.length
    && test.channels.every((channel) => row.arms.some((arm) => arm.channel === channel && finite(arm.survivorPnl))));
  const dates = complete.map((row) => row.sessionDateEt);
  const sessions = new Set(dates).size;
  const nativeWins = complete.filter((row) => row.nativeClusterPnl > 0).length;
  const nativeLosses = complete.filter((row) => row.nativeClusterPnl < 0).length;
  const arms = test.channels.map((channel): CollisionArmScore => {
    const rows = complete.map((row) => {
      const survivorPnl = row.arms.find((arm) => arm.channel === channel)?.survivorPnl as number;
      return { sessionDateEt: row.sessionDateEt, nativePnl: row.nativeClusterPnl, survivorPnl, delta: survivorPnl - row.nativeClusterPnl };
    });
    const deltas = rows.map((row) => row.delta);
    const totalDelta = money(deltas.reduce((sum, value) => sum + value, 0));
    const medianDelta = median(deltas);
    const share = positiveShare(deltas);
    const concentration = sessionConcentration(rows);
    const blockers = commonEvidenceBlockers({
      count: rows.length,
      minimum: test.evidenceFloor.minimumCompletedCollisionGroups,
      countLabel: "completed collision groups",
      sessions,
      minimumSessions: test.evidenceFloor.minimumIndependentSessions,
      positiveOutcomes: nativeWins,
      negativeOutcomes: nativeLosses,
    });
    const evidenceFloorMet = blockers.length === 0;
    const reviewCandidate = evidenceFloorMet
      && share != null && share >= (test.reviewRule.minimumPositiveDeltaShare ?? Infinity)
      && (!test.reviewRule.requirePositiveTotalDelta || totalDelta > 0)
      && (!test.reviewRule.requirePositiveMedianDelta || (medianDelta ?? -Infinity) > 0)
      && concentration != null && concentration <= (test.reviewRule.maximumSingleSessionShareOfPositiveDelta ?? -Infinity);
    if (evidenceFloorMet && !reviewCandidate) blockers.push("frozen effect and concentration rules are not all met");
    return {
      channel,
      completedGroups: rows.length,
      independentSessions: sessions,
      survivorPnl: money(rows.reduce((sum, row) => sum + row.survivorPnl, 0)),
      nativeClusterPnl: money(rows.reduce((sum, row) => sum + row.nativePnl, 0)),
      totalDelta,
      medianDelta,
      positiveDelta: deltas.filter((value) => value > 0).length,
      negativeDelta: deltas.filter((value) => value < 0).length,
      unchangedDelta: deltas.filter((value) => value === 0).length,
      positiveDeltaShare: share,
      maximumSingleSessionShareOfPositiveDelta: concentration,
      evidenceFloorMet,
      reviewCandidate,
      blockers,
      policyChangeAuthorized: false,
    };
  });
  return {
    mode: "collision_one_survivor",
    test,
    cohort: observedCohort,
    observedGroups: observed.length,
    completedGroups: complete.length,
    censoredGroups: observed.length - complete.length,
    independentSessions: sessions,
    nativeWinningGroups: nativeWins,
    nativeLosingGroups: nativeLosses,
    arms,
    policyChangeAuthorized: false,
  };
}

function scorePair(test: FamilyPreregisteredTest, input: readonly MatchedPairScoreInput[]): MatchedPairTestScore {
  const observed = input.filter((row) => row.testId === test.id);
  const observedCohort = cohort(observed.map((row) => row.sessionDateEt));
  const complete = observed.filter((row) => row.eligible !== false && row.controlChannel === test.controlChannel
    && row.challengerChannel === test.challengerChannel
    && [row.control.realizedPnl, row.control.mfePct, row.control.maePct,
      row.challenger.realizedPnl, row.challenger.mfePct, row.challenger.maePct].every(finite));
  const dates = complete.map((row) => row.sessionDateEt);
  const sessions = new Set(dates).size;
  const nativeOutcomes = complete.flatMap((row) => [row.control.realizedPnl, row.challenger.realizedPnl]);
  const nativeWins = nativeOutcomes.filter((value) => value > 0).length;
  const nativeLosses = nativeOutcomes.filter((value) => value < 0).length;
  const deltas = complete.map((row) => row.challenger.realizedPnl - row.control.realizedPnl);
  const mfeDeltas = complete.map((row) => row.challenger.mfePct - row.control.mfePct);
  const maeDeltas = complete.map((row) => row.challenger.maePct - row.control.maePct);
  const captureDeltas = complete.flatMap((row) => finite(row.control.realizedCaptureRatio) && finite(row.challenger.realizedCaptureRatio)
    ? [(row.challenger.realizedCaptureRatio as number) - (row.control.realizedCaptureRatio as number)] : []);
  const totalDelta = money(deltas.reduce((sum, value) => sum + value, 0));
  const medianDelta = median(deltas);
  const share = positiveShare(deltas);
  const concentration = sessionConcentration(complete.map((row, index) => ({ sessionDateEt: row.sessionDateEt, delta: deltas[index] })));
  const medianMaeDelta = median(maeDeltas);
  const maeDeterioration = medianMaeDelta == null ? null : round(Math.max(0, -medianMaeDelta));
  const blockers = commonEvidenceBlockers({
    count: complete.length,
    minimum: test.evidenceFloor.minimumMatchedClocks,
    countLabel: "matched clocks",
    sessions,
    minimumSessions: test.evidenceFloor.minimumIndependentSessions,
    positiveOutcomes: nativeWins,
    negativeOutcomes: nativeLosses,
  });
  const evidenceFloorMet = blockers.length === 0;
  const reviewCandidate = evidenceFloorMet
    && share != null && share >= (test.reviewRule.minimumPositiveDeltaShare ?? Infinity)
    && (!test.reviewRule.requirePositiveTotalDelta || totalDelta > 0)
    && (!test.reviewRule.requirePositiveMedianDelta || (medianDelta ?? -Infinity) > 0)
    && maeDeterioration != null && maeDeterioration <= (test.reviewRule.maximumMedianMaeDeteriorationPctPoints ?? -Infinity)
    && concentration != null && concentration <= (test.reviewRule.maximumSingleSessionShareOfPositiveDelta ?? -Infinity);
  if (evidenceFloorMet && !reviewCandidate) blockers.push("frozen effect, MAE, and concentration rules are not all met");
  return {
    mode: "matched_clock_pair",
    test,
    cohort: observedCohort,
    matchedClocks: complete.length,
    censoredClocks: observed.length - complete.length,
    independentSessions: sessions,
    controlRealizedPnl: money(complete.reduce((sum, row) => sum + row.control.realizedPnl, 0)),
    challengerRealizedPnl: money(complete.reduce((sum, row) => sum + row.challenger.realizedPnl, 0)),
    totalRealizedDelta: totalDelta,
    medianRealizedDelta: medianDelta,
    positiveRealizedDelta: deltas.filter((value) => value > 0).length,
    negativeRealizedDelta: deltas.filter((value) => value < 0).length,
    unchangedRealizedDelta: deltas.filter((value) => value === 0).length,
    positiveDeltaShare: share,
    medianMfeDelta: median(mfeDeltas),
    medianMaeDelta,
    medianMaeDeteriorationPctPoints: maeDeterioration,
    medianRealizedCaptureDelta: median(captureDeltas),
    maximumSingleSessionShareOfPositiveDelta: concentration,
    nativeWinningOutcomes: nativeWins,
    nativeLosingOutcomes: nativeLosses,
    evidenceFloorMet,
    reviewCandidate,
    blockers,
    policyChangeAuthorized: false,
  };
}

function scorePath(test: FamilyPreregisteredTest, input: readonly PathViabilityScoreInput[]): PathViabilityTestScore {
  const observed = input.filter((row) => row.testId === test.id);
  const observedCohort = cohort(observed.map((row) => row.sessionDateEt));
  const complete = observed.filter((row) => row.eligible !== false && row.channel === test.channels[0]
    && [row.realizedPnl, row.mfePct, row.maePct].every(finite)
    && (row.secondsToPeak == null || (finite(row.secondsToPeak) && row.secondsToPeak >= 0)));
  const dates = complete.map((row) => row.sessionDateEt);
  const sessions = new Set(dates).size;
  const nativeWins = complete.filter((row) => row.realizedPnl > 0).length;
  const nativeLosses = complete.filter((row) => row.realizedPnl < 0).length;
  const rate = (count: number): number | null => complete.length ? round(count / complete.length) : null;
  const touch10Rate = rate(complete.filter((row) => row.touched10Pct).length);
  const touch15Rate = rate(complete.filter((row) => row.touched15Pct).length);
  const maeMinus30Rate = rate(complete.filter((row) => row.maePct <= -30).length);
  const blockers = commonEvidenceBlockers({
    count: complete.length,
    minimum: test.evidenceFloor.minimumExactNativePaths,
    countLabel: "exact native paths",
    sessions,
    minimumSessions: test.evidenceFloor.minimumIndependentSessions,
    positiveOutcomes: nativeWins,
    negativeOutcomes: nativeLosses,
  });
  const evidenceFloorMet = blockers.length === 0;
  const reviewCandidate = evidenceFloorMet
    && touch10Rate != null && touch10Rate >= (test.reviewRule.minimumTouch10Rate ?? Infinity)
    && maeMinus30Rate != null && maeMinus30Rate <= (test.reviewRule.maximumMaeMinus30Rate ?? -Infinity)
    && (median(complete.map((row) => row.mfePct)) ?? -Infinity) > 0;
  if (evidenceFloorMet && !reviewCandidate) blockers.push("frozen upside and adverse-path rules are not all met");
  return {
    mode: "channel_path_viability",
    test,
    cohort: observedCohort,
    exactNativePaths: complete.length,
    censoredPaths: observed.length - complete.length,
    independentSessions: sessions,
    nativeWinningOutcomes: nativeWins,
    nativeLosingOutcomes: nativeLosses,
    realizedPnl: money(complete.reduce((sum, row) => sum + row.realizedPnl, 0)),
    touch10Rate,
    touch15Rate,
    maeMinus30Rate,
    medianMfePct: median(complete.map((row) => row.mfePct)),
    medianMaePct: median(complete.map((row) => row.maePct)),
    medianSecondsToPeak: median(complete.flatMap((row) => finite(row.secondsToPeak) ? [row.secondsToPeak] : [])),
    evidenceFloorMet,
    reviewCandidate,
    blockers,
    policyChangeAuthorized: false,
  };
}

export function buildFamilyPreregisteredScorecard(input: {
  collisions: readonly CollisionScoreInput[];
  matchedPairs: readonly MatchedPairScoreInput[];
  paths: readonly PathViabilityScoreInput[];
}): FamilyPreregisteredScorecard {
  return {
    version: "phase1k-e-family-preregister-v1",
    collisionTests: FAMILY_PREREGISTERED_TESTS.filter((test) => test.mode === "collision_one_survivor").map((test) => scoreCollision(test, input.collisions)),
    matchedPairTests: FAMILY_PREREGISTERED_TESTS.filter((test) => test.mode === "matched_clock_pair").map((test) => scorePair(test, input.matchedPairs)),
    pathViabilityTests: FAMILY_PREREGISTERED_TESTS.filter((test) => test.mode === "channel_path_viability").map((test) => scorePath(test, input.paths)),
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}
