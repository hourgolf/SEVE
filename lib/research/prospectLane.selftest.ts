import assert from "node:assert/strict";
import { DAY1_CONFIG_HASH, DAY1_RELEASE_ID, DAY1_ROOTS } from "../channels/day1Release.js";
import {
  deriveProspectLanePlan,
  deriveRootContinuityReceipt,
  ROOT_PROSPECTIVE_COHORT_START_ET,
  type ProspectCandidateEvidence,
} from "./prospectLane.js";

const stamp = (letter: string): string => `sha256:${letter.repeat(64)}`;
const candidate = (
  channelSlug: string,
  familyId: string,
  overrides: Partial<ProspectCandidateEvidence> = {},
): ProspectCandidateEvidence => ({
  channelSlug,
  familyId,
  underlying: "SPY",
  channelVersion: stamp("a"),
  configurationEpochId: stamp("b"),
  exactSessions: 3,
  independentManagerPaths: 30,
  censoredManagerPaths: 1,
  exactEvidenceSha256: stamp("c"),
  ...overrides,
});

const before = JSON.stringify(DAY1_ROOTS);
const continuity = deriveRootContinuityReceipt();
assert.equal(continuity.releaseId, DAY1_RELEASE_ID);
assert.equal(continuity.releaseConfigurationSha256, DAY1_CONFIG_HASH);
assert.equal(continuity.rootProspectiveCohortStartEt, ROOT_PROSPECTIVE_COHORT_START_ET);
assert.equal(continuity.rootEraReset, false);
assert.equal(continuity.rootConfigurationChangeAuthorized, false);
assert.equal(continuity.roots.length, 6);
assert.equal(JSON.stringify(DAY1_ROOTS), before);

const plan = deriveProspectLanePlan({
  candidates: [
    candidate("vb-ribbon-cross", "RIBBON"),
    candidate("vb-ribbon-cross-qqq", "RIBBON", { underlying: "QQQ", independentManagerPaths: 25 }),
    candidate("vb-level-break", "LEVEL", { exactSessions: 1 }),
    candidate("vb-squeeze-break-qqq", "SQUEEZE", { underlying: "QQQ" }),
    candidate("vb-invalid", "INVALID", { channelVersion: "legacy" }),
    candidate("pb-ride", "ROOT"),
    candidate("vb-negative", "NEGATIVE", { censoredManagerPaths: -1 }),
  ],
  evidenceFloor: {
    minimumExactSessions: 2,
    minimumIndependentManagerPaths: 24,
    maximumCensorRate: 0.1,
  },
  maxReviewCandidates: 2,
});

assert.deepEqual(plan.reviewCandidates.map((row) => row.channelSlug), [
  "vb-ribbon-cross",
  "vb-squeeze-break-qqq",
]);
assert.equal(plan.censors.some((row) => row.code === "duplicate_family"), true);
assert.equal(plan.censors.some((row) => row.code === "evidence_floor_not_met"), true);
assert.equal(plan.censors.some((row) => row.code === "invalid_identity"), true);
assert.equal(plan.censors.some((row) => row.code === "existing_root"), true);
assert.equal(plan.prospectCohortStartEt, null);
assert.equal(plan.prospectActivationAuthorized, false);
assert.equal(plan.productionChangeAuthorized, false);
assert.equal(plan.reviewCandidates.every((row) => !row.fillsAuthorized && !row.orderPathAuthorized), true);
assert.equal(plan.rootContinuity.rootIdentitySha256, continuity.rootIdentitySha256);
assert.throws(() => deriveProspectLanePlan({
  candidates: [],
  evidenceFloor: { minimumExactSessions: 0, minimumIndependentManagerPaths: 1, maximumCensorRate: 0 },
  maxReviewCandidates: 1,
}));

console.log("prospect-lane-selftest: 22/22 PASS");
