import assert from "node:assert/strict";
import {
  buildDay1ProspectiveScorecard,
  DAY1_EVIDENCE_FLOOR,
  DAY1_OPPORTUNITY_CLUSTER_RULE,
  DAY1_PORTFOLIO_RULE,
  DAY1_PROSPECTIVE_SCORER_VERSION,
  DAY1_ZERO_DELTA_RULE,
  type ProspectiveMatchedPairInput,
  type ProspectivePolicyIdentity,
} from "./day1ProspectiveScorer.js";

let checks = 0;
const ok = (condition: unknown, message: string): void => { assert.ok(condition, message); checks += 1; };
const equal = (actual: unknown, expected: unknown, message: string): void => { assert.equal(actual, expected, message); checks += 1; };

const identity = (overrides: Partial<ProspectivePolicyIdentity> = {}): ProspectivePolicyIdentity => ({
  channelSlug: "root",
  channelVersion: "sha256:channel-v1",
  managerVersion: "manager-v1",
  configurationEpoch: "monday-epoch-1",
  ...overrides,
});

const row = (delta: number, overrides: Partial<ProspectiveMatchedPairInput> = {}): ProspectiveMatchedPairInput => ({
  testId: "root-vs-shadow",
  comparisonId: `comparison-${delta}-${overrides.clockId ?? "clock"}`,
  sessionDateEt: "2026-07-20",
  clockId: overrides.clockId ?? `2026-07-20T10:00:0${Math.abs(delta)}-04:00`,
  provenanceId: overrides.provenanceId ?? `receipt-${delta}-${overrides.clockId ?? "clock"}`,
  controlIdentity: identity(),
  challengerIdentity: identity({ channelSlug: "shadow" }),
  controlPnl: 100,
  challengerPnl: 100 + delta,
  ...overrides,
});

const zeroRule = buildDay1ProspectiveScorecard([row(10), row(0, { clockId: "b" }), row(-5, { clockId: "c" })]);
equal(zeroRule.scorerVersion, DAY1_PROSPECTIVE_SCORER_VERSION, "new scorer owns a distinct version");
equal(zeroRule.scores[0].positiveDeltaShareDenominator, DAY1_ZERO_DELTA_RULE, "zero rule is explicit");
equal(zeroRule.scores[0].completedGroups, 3, "all complete groups are counted");
equal(zeroRule.scores[0].zeroDelta, 1, "zero deltas remain visible");
equal(zeroRule.scores[0].positiveDeltaShare, 0.3333, "zero delta is included in the denominator");
equal(zeroRule.scores[0].policyChangeAuthorized, false, "scorer cannot authorize policy changes");

const versioned = buildDay1ProspectiveScorecard([
  row(1),
  row(2, { controlIdentity: identity({ channelVersion: "sha256:channel-v2" }), clockId: "v2" }),
  row(3, { challengerIdentity: identity({ channelSlug: "shadow", managerVersion: "manager-v2" }), clockId: "m2" }),
  row(4, { challengerIdentity: identity({ channelSlug: "shadow", configurationEpoch: "monday-epoch-2" }), clockId: "e2" }),
]);
equal(versioned.scores.length, 4, "channel, manager, and configuration versions are never pooled");
ok(new Set(versioned.scores.map((score) => score.policyKey)).size === 4, "each version tuple has a distinct result key");

const censored = buildDay1ProspectiveScorecard([
  row(1),
  row(2, { controlIdentity: identity({ managerVersion: "" }), clockId: "bad-identity" }),
  row(3, { eligible: false, clockId: "ineligible" }),
]);
equal(censored.scores[0].completedGroups, 1, "valid prospective row remains scoreable");
equal(censored.censoredRows, 2, "malformed and ineligible rows are censored");
equal(censored.scores[0].censoredGroups, 1, "grouped ineligible identity is a truthful censored group");

const duplicateReceipt = row(5, { comparisonId: "duplicate", clockId: "duplicate-clock", provenanceId: "receipt-1" });
const duplicates = buildDay1ProspectiveScorecard([duplicateReceipt, { ...duplicateReceipt }, { ...duplicateReceipt }]);
equal(duplicates.scores[0].completedGroups, 1, "exact duplicate input is counted once");
equal(duplicates.scores[0].exactDuplicatesIgnored, 2, "repeated ingestion of the same receipt is ignored deterministically");
equal(duplicates.censoredRows, 0, "exact repeats are not mislabeled as censors");

const conflict = buildDay1ProspectiveScorecard([
  duplicateReceipt,
  { ...duplicateReceipt, challengerPnl: duplicateReceipt.challengerPnl + 10 },
]);
equal(conflict.scores[0].completedGroups, 0, "conflicting duplicate identity is never counted");
equal(conflict.scores[0].censoredGroups, 1, "conflicting duplicate creates one censored comparison group");
equal(conflict.censoredRows, 2, "both conflicting inputs remain visible as censored rows");
equal(conflict.conflictingDuplicateGroups, 1, "conflict summary is explicit");

const siblingClock = buildDay1ProspectiveScorecard([
  row(2, { comparisonId: "sibling-a", clockId: "shared-opportunity", provenanceId: "sibling-receipt-a" }),
  row(-1, { comparisonId: "sibling-b", clockId: "shared-opportunity", provenanceId: "sibling-receipt-b" }),
]);
equal(siblingClock.scores[0].completedGroups, 2, "distinct sibling comparisons remain distinct groups");
equal(siblingClock.scores[0].independentOpportunities, 1, "siblings on one clock count as one independent opportunity");
equal(siblingClock.scores[0].independentSessions, 1, "shared-clock siblings count as one independent session");
equal(siblingClock.scores[0].opportunityClusterRule, DAY1_OPPORTUNITY_CLUSTER_RULE, "opportunity clustering rule is explicit");
equal(siblingClock.scores[0].opportunityClusters[0].comparisonGroups, 2, "cluster metric exposes two comparisons on one opportunity");
equal(siblingClock.scores[0].opportunityClusterInvariantSatisfied, true, "every completed group belongs to exactly one opportunity cluster");
equal(siblingClock.scores[0].portfolioRule, DAY1_PORTFOLIO_RULE, "portfolio prohibition is explicit");
equal(siblingClock.scores[0].portfolioWeightingRule, null, "no portfolio weighting rule is silently invented");
equal(siblingClock.scores[0].portfolioClaimAuthorized, false, "sibling P&L cannot authorize a portfolio claim");

const tenRowsAcrossFourSessions = Array.from({ length: 10 }, (_, index) => {
  const sessionDay = 20 + (index % 4);
  return row(index + 1, {
    comparisonId: `floor-four-session-${index}`,
    sessionDateEt: `2026-07-${sessionDay}`,
    clockId: `clock-${index}`,
    provenanceId: `floor-four-session-receipt-${index}`,
  });
});
const insufficientSessions = buildDay1ProspectiveScorecard(tenRowsAcrossFourSessions).scores[0];
equal(insufficientSessions.completedGroups, 10, "completed groups may reach ten without satisfying the floor");
equal(insufficientSessions.independentOpportunities, 10, "ten distinct clocks are ten opportunities");
equal(insufficientSessions.independentSessions, 4, "session independence is counted separately");
equal(insufficientSessions.evidenceFloorMet, false, "completedGroups never substitutes for the independent session floor");
ok(insufficientSessions.evidenceFloorBlockers.some((value) => value.startsWith("independent_sessions_4_below_5")), "session-floor blocker is explicit");

const tenRowsAcrossFiveSessions = Array.from({ length: 10 }, (_, index) => {
  const sessionDay = 20 + Math.floor(index / 2);
  return row(index + 1, {
    comparisonId: `floor-five-session-${index}`,
    sessionDateEt: `2026-07-${sessionDay}`,
    clockId: `clock-${index}`,
    provenanceId: `floor-five-session-receipt-${index}`,
  });
});
const floorMet = buildDay1ProspectiveScorecard(tenRowsAcrossFiveSessions).scores[0];
equal(floorMet.evidenceFloor, DAY1_EVIDENCE_FLOOR, "ratified evidence floor is carried in every score");
equal(floorMet.independentOpportunities, 10, "floor requires ten independent opportunity clocks");
equal(floorMet.independentSessions, 5, "floor requires five independent sessions");
equal(floorMet.evidenceFloorMet, true, "both independent requirements satisfy the first-review floor");
equal(floorMet.evidenceFloorBlockers.length, 0, "a satisfied floor has no blockers");

const invalidDates = buildDay1ProspectiveScorecard([
  row(1),
  row(2, { sessionDateEt: "2026-02-30", comparisonId: "bad-calendar", clockId: "bad-calendar" }),
  row(3, { sessionDateEt: "not-a-date", comparisonId: "bad-format", clockId: "bad-format" }),
]);
equal(invalidDates.scores[0].completedGroups, 1, "valid session remains scoreable beside invalid dates");
equal(invalidDates.censoredRows, 2, "invalid calendar and format dates are censored");

assert.throws(
  () => buildDay1ProspectiveScorecard([row(1, { sessionDateEt: "2026-07-17" })]),
  /rejects pre-2026-07-20/,
  "prior evidence cannot leak into the prospective scorer",
);
checks += 1;

equal(zeroRule.productionChangeAuthorized, false, "scorecard cannot authorize production changes");
console.log(`day1-prospective-scorer-selftest: ${checks}/${checks} PASS`);
