import assert from "node:assert/strict";
import { resolveChannelRuntimeAuthority } from "./channelRuntimeAuthority";

const view = {
  state: "receipt-bound",
  bySlug: {
    live: { executionPosture: "paper", accountId: "paper-2", accountLabel: "PAPER 2", quantity: 3 },
    watch: { executionPosture: "observe-only", accountLabel: "PAPER 2", quantity: 1 },
  },
} as never;

assert.equal(resolveChannelRuntimeAuthority("live", undefined, view).label, "TRADING");
assert.equal(resolveChannelRuntimeAuthority("live", undefined, view, "paper-1").label, "TRADING ELSEWHERE");
assert.equal(resolveChannelRuntimeAuthority("watch", undefined, view).label, "OBSERVING");
assert.equal(resolveChannelRuntimeAuthority("stale-paper", { lifecycle: "paper-root", lifecycleFact: "old" } as never, view).label, "NOT TRADING");
assert.equal(resolveChannelRuntimeAuthority("fallback", { lifecycle: "paper-root", lifecycleFact: "sealed" } as never, null).label, "TRADING");

console.log("channel-runtime-authority-selftest: PASS");
