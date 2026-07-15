import { buildObserverScorecard, type FamilyAdmissionReceipt, type Pb2ShadowReceipt } from "./observerScorecard.js";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${name}: expected ${e}, got ${a}`);
  passed += 1;
}

const arm = (keep: string, reject: string[]) => ({ keepOpportunityId: keep, rejectOpportunityIds: reject });
const group = (
  id: string,
  familyId: string,
  sourceBarAt: string,
  candidates: Array<[string, string]>,
): FamilyAdmissionReceipt => ({
  id,
  familyId,
  sourceBarAt,
  candidates: candidates.map(([opportunityId, channelSlug]) => ({ opportunityId, channelSlug, requestedQty: 5 })),
  admissionArms: candidates.map(([keep]) => arm(keep, candidates.filter(([id2]) => id2 !== keep).map(([id2]) => id2))),
});

const family = [
  group("g1", "PB", "2026-07-15T13:31:00.000Z", [["opp:a", "pb-ride"], ["opp:b", "pb-ride-2"]]),
  group("g2", "PB", "2026-07-16T13:31:00.000Z", [["opp:c", "pb-ride"], ["opp:d", "pb-ride-itm"]]),
  group("g3", "ORB-SPY", "2026-07-16T15:00:00.000Z", [["opp:e", "orb-trend-rider"], ["opp:missing", "orb-ustop"]]),
];
const outcomes = [
  { opportunityId: "opp:a", realizedPnl: 40 },
  { opportunityId: "opp:a", realizedPnl: 60 },
  { opportunityId: "opp:b", realizedPnl: -400 },
  { opportunityId: "opp:c", realizedPnl: 200 },
  { opportunityId: "opp:d", realizedPnl: 100 },
  { opportunityId: "opp:e", realizedPnl: -50 },
];

const pb2: Pb2ShadowReceipt[] = [
  { id: "p1", sessionDateEt: "2026-07-15", status: "terminal", terminalPnl: 250, actualRealizedPnl: 100, bankReturnPct: 16, censorCode: null },
  { id: "p2", sessionDateEt: "2026-07-16", status: "terminal", terminalPnl: -50, actualRealizedPnl: -200, bankReturnPct: null, censorCode: null },
  { id: "p3", sessionDateEt: "2026-07-16", status: "censored", terminalPnl: null, actualRealizedPnl: null, bankReturnPct: null, censorCode: "quote_gap" },
  { id: "p4", sessionDateEt: "2026-07-16", status: "active", terminalPnl: null, actualRealizedPnl: null, bankReturnPct: null, censorCode: null },
  { id: "p5", sessionDateEt: "2026-07-16", status: "terminal", terminalPnl: 1, actualRealizedPnl: null, bankReturnPct: 15, censorCode: null },
];

const score = buildObserverScorecard({
  familyObservations: family,
  opportunityOutcomes: outcomes,
  pb2Runs: pb2,
  thresholds: { familyCompletedGroups: 2, pb2CompletedPaths: 2, independentSessions: 2 },
});

check("schema version", score.schemaVersion, 1);
check("family observed", score.familyAdmission.observedGroups, 3);
check("family completed", score.familyAdmission.completedGroups, 2);
check("family censored", score.familyAdmission.censoredGroups, 1);
check("family sessions use ET", score.familyAdmission.independentSessions, 2);
check("native win and loss paths", [score.familyAdmission.nativeWinningGroups, score.familyAdmission.nativeLosingGroups], [1, 1]);
check("duplicate outcome rows aggregate", score.familyAdmission.groups[0]?.nativePnl, -300);
check("winning survivor delta", score.familyAdmission.groups[0]?.arms[0], {
  keepOpportunityId: "opp:a", keepChannelSlug: "pb-ride", armPnl: 100, deltaVsNative: 400,
});
check("family threshold is a review gate", score.familyAdmission.evidenceFloorMet, true);
check("family channel rollup", score.familyAdmission.channels.find((row) => row.channelSlug === "pb-ride"), {
  familyId: "PB", channelSlug: "pb-ride", completedGroups: 2, survivorPnl: 300, deltaVsNative: 300,
});
check("pb2 observed", score.pb2.observedPaths, 5);
check("pb2 completed", score.pb2.completedPaths, 2);
check("pb2 censored includes incomplete terminal", score.pb2.censoredPaths, 2);
check("pb2 active", score.pb2.activePaths, 1);
check("pb2 bank trigger distinct", score.pb2.bankTriggeredPaths, 1);
check("pb2 sessions", score.pb2.independentSessions, 2);
check("pb2 native path signs", [score.pb2.actualWinningPaths, score.pb2.actualLosingPaths], [1, 1]);
check("pb2 pnl", [score.pb2.actualPnl, score.pb2.modeledPnl, score.pb2.deltaVsActual], [-100, 200, 300]);
check("pb2 threshold is a review gate", score.pb2.evidenceFloorMet, true);
check("promotion can never be automatic", [score.promotionEligible, score.promotionReason.includes("explicit operator")], [false, true]);

const defaultFloor = buildObserverScorecard({ familyObservations: family, opportunityOutcomes: outcomes, pb2Runs: pb2 });
check("default family floor blocks", defaultFloor.familyAdmission.evidenceFloorMet, false);
check("default pb2 floor blocks", defaultFloor.pb2.evidenceFloorMet, false);
check("default blockers quantify deficit", defaultFloor.familyAdmission.blockers[0], "need 8 more completed collision groups");

const badArm = group("bad", "PB", "2026-07-17T14:00:00Z", [["opp:x", "pb-ride"], ["opp:y", "pb-ride-2"]]);
badArm.admissionArms = [arm("opp:x", []), arm("opp:y", ["opp:x"])];
const badArmScore = buildObserverScorecard({
  familyObservations: [badArm],
  opportunityOutcomes: [{ opportunityId: "opp:x", realizedPnl: 1 }, { opportunityId: "opp:y", realizedPnl: 2 }],
  pb2Runs: [],
});
check("malformed arm censors group", [badArmScore.familyAdmission.completedGroups, badArmScore.familyAdmission.censoredGroups], [0, 1]);

let invalidThreshold = "";
try {
  buildObserverScorecard({ familyObservations: [], opportunityOutcomes: [], pb2Runs: [], thresholds: { independentSessions: 0 } });
} catch (error) {
  invalidThreshold = error instanceof Error ? error.message : String(error);
}
check("threshold injection validates", invalidThreshold, "observer scorecard thresholds must be positive integers");

console.log(`observer-scorecard-selftest: ${passed}/${passed} PASS`);
