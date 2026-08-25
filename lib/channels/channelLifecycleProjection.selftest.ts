import assert from "node:assert/strict";
import { projectChannelLifecycle } from "./channelLifecycleProjection";

assert.deepEqual(projectChannelLifecycle({ runtimeLifecycle: "paper-root", researchBook: "experiment" }).states, ["trading", "researching"]);
assert.deepEqual(projectChannelLifecycle({ runtimeLifecycle: "dark-evidence", researchBook: "shadow" }).states, ["observing", "shadowing"]);
assert.deepEqual(projectChannelLifecycle({ runtimeLifecycle: "unverified", researchBook: "archive" }).states, ["unverified", "paused"]);
assert.equal(projectChannelLifecycle({ runtimeLifecycle: "unverified" }).research, "unassigned");
assert.equal(projectChannelLifecycle({ runtimeLifecycle: "unverified", researchBook: "archive" }).research, "paused", "archive is reversible pause, not retirement");
assert.equal(projectChannelLifecycle({ runtimeLifecycle: "unverified", terminalRetirementReceipt: true }).research, "retired", "retirement requires explicit terminal authority");

console.log("channel-lifecycle-projection-selftest: PASS");
