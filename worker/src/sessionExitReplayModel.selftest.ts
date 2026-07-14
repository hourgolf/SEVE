import assert from "node:assert/strict";
import { replayScaleBeforeNativeClose, type ExitReplayPosition } from "./sessionExitReplayModel.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => { assert.deepEqual(actual, expected, name); checks++; };
const base: ExitReplayPosition = {
  id: "p1", channel: "demo", quantity: 5, entryPrice: 1,
  openedAtMs: 0, nativeClosedAtMs: 100, nativeExitPrice: 0.7, nativePnl: -150,
};

const native = replayScaleBeforeNativeClose(base, [{ atMs: 10, bid: 1.1 }], 20, "native");
check("unreached target preserves native economics", [native.triggered, native.modeledPnl, native.deltaVsNative], [false, -150, 0]);

const scaled = replayScaleBeforeNativeClose(base, [{ atMs: 10, bid: 1.2 }, { atMs: 50, bid: 0.9 }], 20, "native");
check("odd lots split into whole-contract floor/remainder", [scaled.bankQty, scaled.runnerQty], [2, 3]);
check("bank plus native runner uses quantity-weighted dollars", [scaled.modeledPnl, scaled.deltaVsNative], [-50, 100]);

const protectedResult = replayScaleBeforeNativeClose(base, [
  { atMs: 10, bid: 1.2 }, { atMs: 20, bid: 1.3 }, { atMs: 30, bid: 1 }, { atMs: 40, bid: 0.8 },
], 20, "breakeven");
check("breakeven runner exits at first observed nonpositive return", [protectedResult.runnerAtMs, protectedResult.runnerPrice, protectedResult.modeledPnl], [30, 1, 40]);

const giveback = replayScaleBeforeNativeClose(base, [
  { atMs: 10, bid: 1.2 }, { atMs: 20, bid: 1.6 }, { atMs: 30, bid: 1.29 },
], 20, "half_giveback");
check("half-giveback ratchet uses the running peak", [giveback.runnerReason, giveback.runnerPrice, giveback.modeledPnl], ["half_giveback", 1.29, 127]);

const single = replayScaleBeforeNativeClose({ ...base, quantity: 1 }, [{ atMs: 10, bid: 2 }], 20, "native");
check("single lots are explicitly non-scalable", [single.eligible, single.triggered], [false, false]);

console.log(`session-exit-replay-model-selftest: ${checks}/${checks} PASS`);
