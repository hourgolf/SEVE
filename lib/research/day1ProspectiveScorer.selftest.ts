import assert from "node:assert/strict";
import {
  buildDay1ProspectiveScorecard,
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

assert.throws(
  () => buildDay1ProspectiveScorecard([row(1, { sessionDateEt: "2026-07-17" })]),
  /rejects pre-2026-07-20/,
  "prior evidence cannot leak into the prospective scorer",
);
checks += 1;

equal(zeroRule.productionChangeAuthorized, false, "scorecard cannot authorize production changes");
console.log(`day1-prospective-scorer-selftest: ${checks}/${checks} PASS`);
