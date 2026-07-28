import assert from "node:assert/strict";
import { BASE_MANAGER_IDS, PB_RIDE_2_MANAGER_ID } from "../../engine/managerPolicy.js";
import { auditSentinelManagerBook, type SentinelManagerPath } from "./managerBookAudit.js";

const terminalPaths = (positionId: string): SentinelManagerPath[] => BASE_MANAGER_IDS.map((managerId) => ({
  positionId,
  managerId,
  status: "terminal",
  censorCode: null,
}));

const root = { id: "root-a", runnerOf: null };
const runner = { id: "runner-a", runnerOf: root.id };

const splitCohort = auditSentinelManagerBook([root, runner], terminalPaths(root.id));
assert.equal(splitCohort.complete, true);
assert.equal(splitCohort.rootPositions, 1);
assert.equal(splitCohort.runnerPositions, 1);
assert.equal(splitCohort.requiredArms, 8);
assert.equal(splitCohort.observed, 8);
assert.equal(splitCohort.terminal, 8);
assert.equal(splitCohort.missingRequiredArms, 0);

const twoRoots = auditSentinelManagerBook(
  [root, runner, { id: "root-b", runnerOf: null }],
  [...terminalPaths(root.id), ...terminalPaths("root-b")],
);
assert.equal(twoRoots.complete, true);
assert.equal(twoRoots.requiredArms, 16);
assert.equal(twoRoots.observed, 16);

const missing = auditSentinelManagerBook([root, runner], terminalPaths(root.id).slice(1));
assert.equal(missing.complete, false);
assert.equal(missing.missingRequiredArms, 1);

const activePaths = terminalPaths(root.id);
activePaths[0] = { ...activePaths[0], status: "active" };
const active = auditSentinelManagerBook([root], activePaths);
assert.equal(active.complete, false);
assert.equal(active.active, 1);
assert.equal(active.terminal, 7);

const censoredPaths = terminalPaths(root.id);
censoredPaths[0] = { ...censoredPaths[0], status: "censored", censorCode: "no_fresh_cutoff_bid" };
const censored = auditSentinelManagerBook([root], censoredPaths);
assert.equal(censored.complete, false);
assert.equal(censored.censored, 1);

const candidate = auditSentinelManagerBook([root], [
  ...terminalPaths(root.id),
  { positionId: root.id, managerId: PB_RIDE_2_MANAGER_ID, status: "terminal", censorCode: null },
]);
assert.equal(candidate.complete, true);
assert.equal(candidate.observed, 9);
assert.equal(candidate.requiredArms, 8);

const runnerArm = auditSentinelManagerBook([root, runner], [
  ...terminalPaths(root.id),
  { positionId: runner.id, managerId: BASE_MANAGER_IDS[0], status: "terminal", censorCode: null },
]);
assert.equal(runnerArm.complete, false);
assert.equal(runnerArm.unexpectedPositionArms, 1);

const duplicate = auditSentinelManagerBook([root], [
  ...terminalPaths(root.id),
  { ...terminalPaths(root.id)[0] },
]);
assert.equal(duplicate.complete, false);
assert.equal(duplicate.duplicateRequiredArms, 1);

const empty = auditSentinelManagerBook([], []);
assert.equal(empty.complete, true);
assert.equal(empty.requiredArms, 0);

console.log("sentinel-manager-book-selftest: 26/26 passed");
