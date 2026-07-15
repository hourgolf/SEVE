import assert from "node:assert/strict";
import {
  INITIAL_POSITION_CLOSE_FLOW,
  positionCloseFlowReducer,
  positionCloseLabel,
} from "./positionCloseFlow";

let state = positionCloseFlowReducer(INITIAL_POSITION_CLOSE_FLOW, { type: "ARM", id: "p1" });
assert.equal(state.confirmId, "p1");
assert.equal(state.error, null);

state = positionCloseFlowReducer(state, { type: "DISARM", id: "other" });
assert.equal(state.confirmId, "p1");
state = positionCloseFlowReducer(state, { type: "DISARM", id: "p1" });
assert.equal(state.confirmId, null);

state = positionCloseFlowReducer(state, { type: "CLOSE_START", id: "p1" });
assert.equal(state.closingId, "p1");
assert.equal(state.confirmId, null);
assert.deepEqual(positionCloseFlowReducer(state, { type: "ARM", id: "p2" }), state);

state = positionCloseFlowReducer(state, { type: "CLOSE_FAILED", error: "broker rejected" });
assert.equal(state.closingId, null);
assert.equal(state.error, "broker rejected");

state = positionCloseFlowReducer(state, { type: "CLOSE_START", id: "p1" });
state = positionCloseFlowReducer(state, { type: "CLOSE_SUCCEEDED", prompt: { id: "p1", label: "755C" } });
assert.equal(state.closingId, null);
assert.deepEqual(state.tagPrompt, { id: "p1", label: "755C" });

state = positionCloseFlowReducer(state, { type: "TAG_START" });
assert.equal(state.tagging, true);
state = positionCloseFlowReducer(state, { type: "TAG_FAILED", error: "tag failed" });
assert.equal(state.tagging, false);
assert.equal(state.tagPrompt?.id, "p1");
assert.equal(state.error, "tag failed");

state = positionCloseFlowReducer(state, { type: "TAG_START" });
state = positionCloseFlowReducer(state, { type: "TAG_SUCCEEDED" });
assert.equal(state.tagPrompt, null);
assert.equal(state.error, null);

state = positionCloseFlowReducer(state, { type: "CLOSE_SUCCEEDED", prompt: { id: "p2", label: "740P" } });
state = positionCloseFlowReducer(state, { type: "DISMISS_TAG" });
assert.equal(state.tagPrompt, null);

assert.equal(positionCloseLabel({ strike: 755, opt_type: "call" }), "755C");
assert.equal(positionCloseLabel({ strike: 740, opt_type: "put" }), "740P");

console.log("position-close-flow-selftest: 16/16 checks passed ✓");
