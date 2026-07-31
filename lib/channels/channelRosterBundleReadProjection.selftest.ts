import assert from "node:assert/strict";
import { projectRosterBundleOperatorState } from "./channelRosterBundleReadProjection.js";

assert.equal(projectRosterBundleOperatorState({
  lifecycleState: "approved",
  hasActivationReceipt: true,
}), "activated");
assert.equal(projectRosterBundleOperatorState({
  lifecycleState: "rolled-back",
  hasActivationReceipt: true,
}), "rolled-back");
assert.equal(projectRosterBundleOperatorState({
  lifecycleState: "validated",
  hasActivationReceipt: false,
}), "validated");
assert.throws(() => projectRosterBundleOperatorState({
  lifecycleState: "approved",
  hasActivationReceipt: false,
}), /missing its activation receipt/);
assert.throws(() => projectRosterBundleOperatorState({
  lifecycleState: "draft",
  hasActivationReceipt: true,
}), /disagrees with lifecycle state/);
assert.throws(() => projectRosterBundleOperatorState({
  lifecycleState: "mystery",
  hasActivationReceipt: false,
}), /state is unknown/);

console.log("channel-roster-bundle-read-projection-selftest: 6/6 passed");
