import assert from "node:assert/strict";
import {
  buildFamilyPreregisteredScorecard,
  type CollisionScoreInput,
  type MatchedPairScoreInput,
  type PathViabilityScoreInput,
} from "./familyPreregisteredScorer.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks += 1;
};

const dates = ["2026-07-16", "2026-07-17", "2026-07-20", "2026-07-21", "2026-07-22"];
const collision: CollisionScoreInput[] = Array.from({ length: 10 }, (_, index) => {
  const native = index === 9 ? 100 : -300;
  return {
    testId: "PB-COLLISION-ONE-SURVIVOR",
    observationId: `pb-${index}`,
    sessionDateEt: dates[index % dates.length],
    family: "PB",
    nativeClusterPnl: native,
    arms: [
      { channel: "pb-ride", survivorPnl: native + (index === 0 ? 500 : index < 6 ? 100 : -50) },
      { channel: "pb-ride-2", survivorPnl: native + (index < 5 ? 60 : -60) },
      { channel: "pb-ride-itm", survivorPnl: native },
    ],
  };
});
collision.push({ ...collision[0], observationId: "malformed", arms: collision[0].arms.slice(0, 2) });

const pairs: MatchedPairScoreInput[] = Array.from({ length: 10 }, (_, index) => ({
  testId: "GRIND-V3-VS-V3-2-CAPTURE",
  clockId: `g-${index}`,
  sessionDateEt: dates[index % dates.length],
  controlChannel: "grind-v3-2",
  challengerChannel: "grind-v3",
  control: { realizedPnl: index % 2 ? -20 : 20, mfePct: 10, maePct: -10, realizedCaptureRatio: 0.2 },
  challenger: { realizedPnl: (index % 2 ? -20 : 20) + (index === 0 ? 300 : index < 6 ? 50 : -20), mfePct: 15, maePct: -12, realizedCaptureRatio: 0.4 },
}));
pairs.push({ ...pairs[0], clockId: "wrong-channel", controlChannel: "wrong" });

const paths: PathViabilityScoreInput[] = Array.from({ length: 20 }, (_, index) => ({
  testId: "QQQ-ORB-PATH-VIABILITY",
  positionId: `q-${index}`,
  sessionDateEt: dates[index % dates.length],
  channel: "orb-qqq-trail",
  realizedPnl: index % 2 ? -20 : 40,
  mfePct: index < 12 ? 15 : 5,
  maePct: index < 4 ? -35 : -10,
  secondsToPeak: 30 + index,
  touched10Pct: index < 12,
  touched15Pct: index < 8,
}));
paths.push({ ...paths[0], positionId: "wrong-channel", channel: "wrong" });

const score = buildFamilyPreregisteredScorecard({ collisions: collision, matchedPairs: pairs, paths });
const pb = score.collisionTests.find((row) => row.test.id === "PB-COLLISION-ONE-SURVIVOR")!;
const grind = score.matchedPairTests.find((row) => row.test.id === "GRIND-V3-VS-V3-2-CAPTURE")!;
const qqq = score.pathViabilityTests.find((row) => row.test.id === "QQQ-ORB-PATH-VIABILITY")!;

check("contract version", score.version, "phase1k-e-family-preregister-v1");
check("all frozen tests are present", [score.collisionTests.length, score.matchedPairTests.length, score.pathViabilityTests.length], [2, 5, 2]);
check("collision malformed group is censored", [pb.observedGroups, pb.completedGroups, pb.censoredGroups], [11, 10, 1]);
check("collision session and sign gates", [pb.independentSessions, pb.nativeWinningGroups, pb.nativeLosingGroups], [5, 1, 9]);
check("collision arm delta distribution", [pb.arms[0].totalDelta, pb.arms[0].medianDelta, pb.arms[0].positiveDelta, pb.arms[0].negativeDelta], [800, 100, 6, 4]);
check("collision positive share", pb.arms[0].positiveDeltaShare, 0.6);
check("concentrated collision benefit is not a review candidate", [pb.arms[0].evidenceFloorMet, pb.arms[0].reviewCandidate, pb.arms[0].maximumSingleSessionShareOfPositiveDelta], [true, false, 0.6]);
check("unobserved collision test stays empty", score.collisionTests.find((row) => row.test.id.startsWith("ORB-SPY"))?.cohort, null);
check("pair malformed clock is censored", [grind.matchedClocks, grind.censoredClocks], [10, 1]);
check("pair deltas are challenger minus control", [grind.totalRealizedDelta, grind.medianRealizedDelta, grind.positiveRealizedDelta, grind.negativeRealizedDelta], [470, 50, 6, 4]);
check("pair opportunity and adverse deltas", [grind.medianMfeDelta, grind.medianMaeDelta, grind.medianMaeDeteriorationPctPoints], [5, -2, 2]);
check("pair evidence floor passes but concentration rule blocks", [grind.evidenceFloorMet, grind.reviewCandidate, grind.maximumSingleSessionShareOfPositiveDelta], [true, false, 0.6364]);
check("path malformed row is censored", [qqq.exactNativePaths, qqq.censoredPaths], [20, 1]);
check("path rates are deterministic", [qqq.touch10Rate, qqq.touch15Rate, qqq.maeMinus30Rate], [0.6, 0.4, 0.2]);
check("path distribution retained", [qqq.medianMfePct, qqq.medianMaePct, qqq.medianSecondsToPeak, qqq.realizedPnl], [15, -10, 39.5, 200]);
check("path meets frozen continuation gate", [qqq.evidenceFloorMet, qqq.reviewCandidate], [true, true]);
check("empty tests expose blockers rather than zero-edge claims", score.pathViabilityTests.find((row) => row.test.id.startsWith("GRIND-SMART"))?.blockers, [
  "need 20 more exact native paths",
  "need 5 more independent sessions",
  "need at least one positive native outcome",
  "need at least one negative native outcome",
]);
check("no result authorizes production or policy", [score.policyChangeAuthorized, score.productionChangeAuthorized,
  score.collisionTests.every((row) => row.policyChangeAuthorized === false),
  score.matchedPairTests.every((row) => row.policyChangeAuthorized === false),
  score.pathViabilityTests.every((row) => row.policyChangeAuthorized === false)], [false, false, true, true, true]);

assert.throws(() => buildFamilyPreregisteredScorecard({
  collisions: [{ ...collision[0], sessionDateEt: "2026-07-15" }, collision[1]],
  matchedPairs: [],
  paths: [],
}), /cannot be pooled/); checks += 1;

console.log(`family-preregistered-scorer-selftest: ${checks}/${checks} PASS`);
