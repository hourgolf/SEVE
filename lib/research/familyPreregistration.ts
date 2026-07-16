// Pure Phase 1K-E preregistration contract. July 15 evidence informed these
// hypotheses, so it is development-only. Validation begins with July 16.
// This module owns no client, filesystem, strategy, order, or runtime import.

export const FAMILY_PREREGISTRATION_VERSION = "phase1k-e-family-preregister-v1" as const;
export const FAMILY_DEVELOPMENT_THROUGH_ET = "2026-07-15" as const;
export const FAMILY_PROSPECTIVE_HOLDOUT_FROM_ET = "2026-07-16" as const;

export type PreregisteredFamily = "PB" | "ORB-SPY" | "GRIND" | "QQQ" | "IWM";
export type FamilyTestMode = "collision_one_survivor" | "matched_clock_pair" | "channel_path_viability";
export type FamilyEndpoint =
  | "survivor_delta_vs_native_cluster"
  | "paired_realized_pnl_delta"
  | "paired_mfe_pct_delta"
  | "paired_mae_pct_delta"
  | "paired_realized_capture_delta"
  | "touch_10_pct_rate"
  | "touch_15_pct_rate"
  | "mae_at_or_below_minus_30_pct_rate"
  | "median_mfe_pct"
  | "median_mae_pct"
  | "median_seconds_to_peak";

export interface FamilyEvidenceFloor {
  minimumIndependentSessions: 5;
  minimumCompletedCollisionGroups: 0 | 10;
  minimumMatchedClocks: 0 | 10;
  minimumExactNativePaths: 0 | 20;
  requireBothOutcomeSigns: true;
}

export interface FamilyReviewRule {
  // These are review gates, never execution or promotion rules.
  minimumPositiveDeltaShare: 0.6 | null;
  requirePositiveTotalDelta: boolean;
  requirePositiveMedianDelta: boolean;
  maximumMedianMaeDeteriorationPctPoints: 5 | null;
  maximumSingleSessionShareOfPositiveDelta: 0.5 | null;
  minimumTouch10Rate: 0.5 | null;
  maximumMaeMinus30Rate: 0.25 | null;
}

export interface FamilyPreregisteredTest {
  id: string;
  family: PreregisteredFamily;
  underlying: "SPY" | "QQQ" | "IWM";
  mode: FamilyTestMode;
  channels: readonly string[];
  controlChannel: string | null;
  challengerChannel: string | null;
  primaryEndpoint: FamilyEndpoint;
  secondaryEndpoints: readonly FamilyEndpoint[];
  hypothesis: string;
  evidenceFloor: FamilyEvidenceFloor;
  reviewRule: FamilyReviewRule;
  selectionRule: "none_preselected" | "challenger_vs_control" | "single_channel_gate";
  policyChangeAuthorized: false;
}

const collisionFloor: FamilyEvidenceFloor = {
  minimumIndependentSessions: 5,
  minimumCompletedCollisionGroups: 10,
  minimumMatchedClocks: 0,
  minimumExactNativePaths: 0,
  requireBothOutcomeSigns: true,
};

const pairFloor: FamilyEvidenceFloor = {
  minimumIndependentSessions: 5,
  minimumCompletedCollisionGroups: 0,
  minimumMatchedClocks: 10,
  minimumExactNativePaths: 0,
  requireBothOutcomeSigns: true,
};

const pathFloor: FamilyEvidenceFloor = {
  minimumIndependentSessions: 5,
  minimumCompletedCollisionGroups: 0,
  minimumMatchedClocks: 0,
  minimumExactNativePaths: 20,
  requireBothOutcomeSigns: true,
};

const collisionRule: FamilyReviewRule = {
  minimumPositiveDeltaShare: 0.6,
  requirePositiveTotalDelta: true,
  requirePositiveMedianDelta: true,
  maximumMedianMaeDeteriorationPctPoints: null,
  maximumSingleSessionShareOfPositiveDelta: 0.5,
  minimumTouch10Rate: null,
  maximumMaeMinus30Rate: null,
};

const pairRule: FamilyReviewRule = {
  minimumPositiveDeltaShare: 0.6,
  requirePositiveTotalDelta: true,
  requirePositiveMedianDelta: true,
  maximumMedianMaeDeteriorationPctPoints: 5,
  maximumSingleSessionShareOfPositiveDelta: 0.5,
  minimumTouch10Rate: null,
  maximumMaeMinus30Rate: null,
};

const pathRule: FamilyReviewRule = {
  minimumPositiveDeltaShare: null,
  requirePositiveTotalDelta: false,
  requirePositiveMedianDelta: false,
  maximumMedianMaeDeteriorationPctPoints: null,
  maximumSingleSessionShareOfPositiveDelta: null,
  minimumTouch10Rate: 0.5,
  maximumMaeMinus30Rate: 0.25,
};

export const FAMILY_PREREGISTERED_TESTS: readonly FamilyPreregisteredTest[] = [
  {
    id: "PB-COLLISION-ONE-SURVIVOR",
    family: "PB",
    underlying: "SPY",
    mode: "collision_one_survivor",
    channels: ["pb-ride", "pb-ride-2", "pb-ride-itm"],
    controlChannel: null,
    challengerChannel: null,
    primaryEndpoint: "survivor_delta_vs_native_cluster",
    secondaryEndpoints: ["paired_realized_pnl_delta"],
    hypothesis: "A consistently selected single PB survivor reduces correlated cluster loss without relying on one session.",
    evidenceFloor: collisionFloor,
    reviewRule: collisionRule,
    selectionRule: "none_preselected",
    policyChangeAuthorized: false,
  },
  {
    id: "PB-RIDE2-VS-RIDE-CAPTURE",
    family: "PB",
    underlying: "SPY",
    mode: "matched_clock_pair",
    channels: ["pb-ride", "pb-ride-2"],
    controlChannel: "pb-ride",
    challengerChannel: "pb-ride-2",
    primaryEndpoint: "paired_realized_pnl_delta",
    secondaryEndpoints: ["paired_mfe_pct_delta", "paired_mae_pct_delta", "paired_realized_capture_delta"],
    hypothesis: "The higher observed PB-ride-2 opportunity becomes useful only if it also improves matched-clock realized capture without materially worse MAE.",
    evidenceFloor: pairFloor,
    reviewRule: pairRule,
    selectionRule: "challenger_vs_control",
    policyChangeAuthorized: false,
  },
  {
    id: "ORB-SPY-COLLISION-ONE-SURVIVOR",
    family: "ORB-SPY",
    underlying: "SPY",
    mode: "collision_one_survivor",
    channels: ["orb-trend-rider", "orb-ustop", "orb-ustop-ctl"],
    controlChannel: null,
    challengerChannel: null,
    primaryEndpoint: "survivor_delta_vs_native_cluster",
    secondaryEndpoints: ["paired_realized_pnl_delta"],
    hypothesis: "A consistently selected single SPY-ORB survivor reduces duplicated family risk without relying on one session.",
    evidenceFloor: collisionFloor,
    reviewRule: collisionRule,
    selectionRule: "none_preselected",
    policyChangeAuthorized: false,
  },
  {
    id: "ORB-TREND-VS-USTOP-CTL-CAPTURE",
    family: "ORB-SPY",
    underlying: "SPY",
    mode: "matched_clock_pair",
    channels: ["orb-ustop-ctl", "orb-trend-rider"],
    controlChannel: "orb-ustop-ctl",
    challengerChannel: "orb-trend-rider",
    primaryEndpoint: "paired_realized_pnl_delta",
    secondaryEndpoints: ["paired_mfe_pct_delta", "paired_mae_pct_delta", "paired_realized_capture_delta"],
    hypothesis: "ORB trend-rider retains its development capture advantage over the u-stop control on future matched clocks without materially worse MAE.",
    evidenceFloor: pairFloor,
    reviewRule: pairRule,
    selectionRule: "challenger_vs_control",
    policyChangeAuthorized: false,
  },
  {
    id: "GRIND-V3-VS-V3-2-CAPTURE",
    family: "GRIND",
    underlying: "SPY",
    mode: "matched_clock_pair",
    channels: ["grind-v3-2", "grind-v3"],
    controlChannel: "grind-v3-2",
    challengerChannel: "grind-v3",
    primaryEndpoint: "paired_realized_pnl_delta",
    secondaryEndpoints: ["paired_mfe_pct_delta", "paired_mae_pct_delta", "paired_realized_capture_delta"],
    hypothesis: "Grind-v3's greater development opportunity is durable only if future matched-clock realized capture exceeds v3-2 without materially worse MAE.",
    evidenceFloor: pairFloor,
    reviewRule: pairRule,
    selectionRule: "challenger_vs_control",
    policyChangeAuthorized: false,
  },
  {
    id: "GRIND-SMART-PATH-VIABILITY",
    family: "GRIND",
    underlying: "SPY",
    mode: "channel_path_viability",
    channels: ["grind-smart-entries"],
    controlChannel: null,
    challengerChannel: "grind-smart-entries",
    primaryEndpoint: "touch_10_pct_rate",
    secondaryEndpoints: ["touch_15_pct_rate", "mae_at_or_below_minus_30_pct_rate", "median_mfe_pct", "median_mae_pct", "median_seconds_to_peak"],
    hypothesis: "Grind-smart entries show repeatable executable upside rather than a path dominated by severe adverse excursion.",
    evidenceFloor: pathFloor,
    reviewRule: pathRule,
    selectionRule: "single_channel_gate",
    policyChangeAuthorized: false,
  },
  {
    id: "QQQ-THRUST-VS-WD-CAPTURE",
    family: "QQQ",
    underlying: "QQQ",
    mode: "matched_clock_pair",
    channels: ["qqq-thrust-trail-wd", "qqq-thrust-trail"],
    controlChannel: "qqq-thrust-trail-wd",
    challengerChannel: "qqq-thrust-trail",
    primaryEndpoint: "paired_realized_pnl_delta",
    secondaryEndpoints: ["paired_mfe_pct_delta", "paired_mae_pct_delta", "paired_realized_capture_delta"],
    hypothesis: "The standard QQQ thrust manager outperforms the wide-downside variant on future matched clocks without materially worse MAE.",
    evidenceFloor: pairFloor,
    reviewRule: pairRule,
    selectionRule: "challenger_vs_control",
    policyChangeAuthorized: false,
  },
  {
    id: "QQQ-ORB-PATH-VIABILITY",
    family: "QQQ",
    underlying: "QQQ",
    mode: "channel_path_viability",
    channels: ["orb-qqq-trail"],
    controlChannel: null,
    challengerChannel: "orb-qqq-trail",
    primaryEndpoint: "touch_10_pct_rate",
    secondaryEndpoints: ["touch_15_pct_rate", "mae_at_or_below_minus_30_pct_rate", "median_mfe_pct", "median_mae_pct", "median_seconds_to_peak"],
    hypothesis: "QQQ ORB entries show repeatable executable upside rather than a path dominated by severe adverse excursion.",
    evidenceFloor: pathFloor,
    reviewRule: pathRule,
    selectionRule: "single_channel_gate",
    policyChangeAuthorized: false,
  },
  {
    id: "IWM-ALT-VS-SMART-CAPTURE",
    family: "IWM",
    underlying: "IWM",
    mode: "matched_clock_pair",
    channels: ["breakout-smart-entries-iwm", "breakout-alt-v3-iwm"],
    controlChannel: "breakout-smart-entries-iwm",
    challengerChannel: "breakout-alt-v3-iwm",
    primaryEndpoint: "paired_realized_pnl_delta",
    secondaryEndpoints: ["paired_mfe_pct_delta", "paired_mae_pct_delta", "paired_realized_capture_delta"],
    hypothesis: "The IWM alt-v3 admission logic outperforms the smart-entry control on future matched clocks without materially worse MAE.",
    evidenceFloor: pairFloor,
    reviewRule: pairRule,
    selectionRule: "challenger_vs_control",
    policyChangeAuthorized: false,
  },
] as const;

export const FAMILY_PREREGISTRATION = {
  version: FAMILY_PREREGISTRATION_VERSION,
  developmentThroughEt: FAMILY_DEVELOPMENT_THROUGH_ET,
  prospectiveHoldoutFromEt: FAMILY_PROSPECTIVE_HOLDOUT_FROM_ET,
  quoteEligibility: {
    source: "databento_cbbo_1s",
    maximumStartLagSec: 1.1,
    maximumEndLeadSec: 1.1,
    maximumInternalGapSec: 5,
  },
  outcomeEligibility: {
    included: "native_closed_with_booked_pnl",
    operatorManaged: "censored",
    testOrCorrection: "censored",
    missingOrInvalidPath: "censored",
  },
  matching: {
    matchedClock: "same source_bar_at + underlying + call/put side",
    familyCollision: "durable Phase 1I family observation with every candidate outcome present",
    qqqAndIwmPooling: false,
  },
  tests: FAMILY_PREREGISTERED_TESTS,
  multipleComparisons: "Each test and channel arm is reported separately; no post-hoc best-arm promotion is permitted.",
  policyChangeAuthorized: false,
  productionChangeAuthorized: false,
} as const;

export type FamilyPreregistrationCohort = "development" | "prospective_holdout";

export function classifyFamilyPreregistrationCohort(sessionDatesEt: readonly string[]): FamilyPreregistrationCohort {
  if (!sessionDatesEt.length) throw new Error("family preregistration cohort requires at least one ET session date");
  if (sessionDatesEt.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error("family preregistration cohort contains an invalid ET session date");
  const hasDevelopment = sessionDatesEt.some((date) => date <= FAMILY_DEVELOPMENT_THROUGH_ET);
  const hasHoldout = sessionDatesEt.some((date) => date >= FAMILY_PROSPECTIVE_HOLDOUT_FROM_ET);
  if (hasDevelopment && hasHoldout) throw new Error("family development and prospective holdout evidence cannot be pooled");
  return hasHoldout ? "prospective_holdout" : "development";
}

export function validateFamilyPreregistration(): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const test of FAMILY_PREREGISTERED_TESTS) {
    if (ids.has(test.id)) issues.push(`duplicate test id ${test.id}`);
    ids.add(test.id);
    if (new Set(test.channels).size !== test.channels.length) issues.push(`${test.id} repeats a channel`);
    if (test.mode === "collision_one_survivor" && test.channels.length < 2) issues.push(`${test.id} needs at least two collision channels`);
    if (test.mode === "matched_clock_pair" && (test.channels.length !== 2 || !test.controlChannel || !test.challengerChannel)) issues.push(`${test.id} needs one explicit control and challenger`);
    if (test.mode === "channel_path_viability" && test.channels.length !== 1) issues.push(`${test.id} must own one channel`);
    if ((test.family === "QQQ" && test.underlying !== "QQQ") || (test.family === "IWM" && test.underlying !== "IWM")) issues.push(`${test.id} pools or mislabels QQQ/IWM evidence`);
    if (test.policyChangeAuthorized) issues.push(`${test.id} cannot authorize policy`);
  }
  if (FAMILY_DEVELOPMENT_THROUGH_ET >= FAMILY_PROSPECTIVE_HOLDOUT_FROM_ET) issues.push("holdout must begin after development cutoff");
  return issues;
}
