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

state = positionCloseFlowReducer(state, { type: "TAG_START", id: "p1" });
assert.equal(state.tagging, true);
state = positionCloseFlowReducer(state, { type: "TAG_FAILED", id: "p1", error: "tag failed" });
assert.equal(state.tagging, false);
assert.equal(state.tagPrompt?.id, "p1");
assert.equal(state.error, "tag failed");

state = positionCloseFlowReducer(state, { type: "TAG_START", id: "p1" });
state = positionCloseFlowReducer(state, { type: "TAG_SUCCEEDED", id: "p1" });
assert.equal(state.tagPrompt, null);
assert.equal(state.error, null);

state = positionCloseFlowReducer(state, { type: "CLOSE_SUCCEEDED", prompt: { id: "p2", label: "740P" } });
state = positionCloseFlowReducer(state, { type: "DISMISS_TAG" });
assert.equal(state.tagPrompt, null);

assert.equal(positionCloseLabel({ strike: 755, opt_type: "call" }), "755C");
assert.equal(positionCloseLabel({ strike: 740, opt_type: "put" }), "740P");
state = positionCloseFlowReducer(INITIAL_POSITION_CLOSE_FLOW, { type: "CLOSE_PENDING", prompt: { id: "p3", label: "640C" } });
assert.equal(state.closingId, null); assert.equal(state.tagPrompt, null);
assert.deepEqual(positionCloseFlowReducer(state, { type: "ARM", id: "p3" }), state);
state = positionCloseFlowReducer(state, { type: "ARM", id: "another-position" });
assert.equal(state.confirmId, "another-position", "MACD reconciliation cannot block closing another channel");
state = positionCloseFlowReducer(state, { type: "CLOSE_CHECK_FAILED", error: "status unavailable" });
assert.equal(state.pendingPrompts[0]?.id, "p3"); assert.equal(state.tagPrompt, null);
state = positionCloseFlowReducer(state, { type: "CLOSE_START", id: "another-position" });
state = positionCloseFlowReducer(state, { type: "CLOSE_SETTLED", prompt: { id: "p3", label: "640C" }, canTag: false });
assert.deepEqual(state.pendingPrompts, []); assert.equal(state.closingId, "another-position"); assert.equal(state.tagPrompt, null);
state = positionCloseFlowReducer(state, { type: "CLOSE_PENDING", prompt: { id: "another-position", label: "600C" } });
state = positionCloseFlowReducer(state, { type: "CLOSE_PENDING", prompt: { id: "p4", label: "640P" } });
assert.equal(state.pendingPrompts.length, 2);
state = positionCloseFlowReducer(state, { type: "CLOSE_SETTLED", prompt: { id: "p4", label: "640P" }, canTag: true });
assert.equal(state.tagPrompt?.id, "p4"); assert.deepEqual(state.pendingPrompts.map(prompt => prompt.id), ["another-position"]);
state = positionCloseFlowReducer(state, { type: "CLOSE_SUCCEEDED", prompt: { id: "legacy", label: "700C" } });
assert.deepEqual(state.pendingPrompts.map(prompt => prompt.id), ["another-position"], "a legacy close must not drop fixed reconciliation tracking");
let tags = positionCloseFlowReducer(INITIAL_POSITION_CLOSE_FLOW, { type: "CLOSE_SUCCEEDED", prompt: { id: "a", label: "A" } });
tags = positionCloseFlowReducer(tags, { type: "TAG_START", id: "a" });
tags = positionCloseFlowReducer(tags, { type: "CLOSE_SETTLED", prompt: { id: "b", label: "B" }, canTag: true });
assert.equal(tags.tagPrompt?.id, "a"); assert.equal(tags.tagging, true); assert.equal(tags.tagQueue[0]?.id, "b");
tags = positionCloseFlowReducer(tags, { type: "TAG_SUCCEEDED", id: "a" });
assert.equal(tags.tagPrompt?.id, "b");
assert.deepEqual(positionCloseFlowReducer(tags, { type: "TAG_SUCCEEDED", id: "a" }), tags, "A's delayed response cannot clear B's annotation prompt");
assert.deepEqual(positionCloseFlowReducer(tags, { type: "TAG_FAILED", id: "a", error: "old error" }), tags);

console.log("position-close-flow-selftest: PASS · legacy close/tag, per-position pending settlement, other-channel closes remain available");
