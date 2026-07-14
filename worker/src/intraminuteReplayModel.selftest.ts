import assert from "node:assert/strict";
import { assessBarFidelity, formingSnapshots, mergeReplayWindows, percentile, receiptOverlapsWindows } from "./intraminuteReplayModel.js";
import type { SipQuoteEvent, SipTradeEvent } from "./intraminuteObserverModel.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => { assert.deepEqual(actual, expected, name); checks++; };
const t0 = Date.parse("2026-07-14T14:16:00.000Z");

check("windows merge by symbol but not across symbols", mergeReplayWindows([
  { symbol: "spy", startMs: 10, endMs: 20 },
  { symbol: "SPY", startMs: 20, endMs: 30 },
  { symbol: "QQQ", startMs: 15, endMs: 25 },
]), [
  { symbol: "QQQ", startMs: 15, endMs: 25 },
  { symbol: "SPY", startMs: 10, endMs: 30 },
]);
check("receipt overlap is inclusive and symbol-scoped", receiptOverlapsWindows(
  { symbol: "SPY", providerMinMs: 30, providerMaxMs: 40 },
  [{ symbol: "SPY", startMs: 10, endMs: 30 }],
), true);
check("receipt outside window does not download", receiptOverlapsWindows(
  { symbol: "SPY", providerMinMs: 31, providerMaxMs: 40 },
  [{ symbol: "SPY", startMs: 10, endMs: 30 }],
), false);
check("nearest-rank percentile is deterministic", [percentile([40, 10, 30, 20], 0.5), percentile([40, 10, 30, 20], 0.95)], [20, 40]);

const trade = (id: string, sec: number, price: number, size: number): SipTradeEvent => ({
  symbol: "SPY", tradeId: id, exchange: null, tape: null, conditions: [], providerAtMs: t0 + sec * 1_000,
  receivedAtMs: t0 + sec * 1_000 + 10, receiveLagMs: 10, price, size,
});
const quote = (sec: number, bid: number, ask: number): SipQuoteEvent => ({
  symbol: "SPY", providerAtMs: t0 + sec * 1_000,
  receivedAtMs: t0 + sec * 1_000 + 12, receiveLagMs: 12,
  bid, ask, bidSize: 1, askSize: 1,
});
const snapshots = formingSnapshots("SPY", [trade("a", 1, 100, 2), trade("b", 7, 102, 3)], [quote(2, 99.99, 100.01), quote(9, 101.99, 102.01)], t0);
check("forming snapshots use only provider facts available by each clock", [
  snapshots[0].close, snapshots[0].volume, snapshots[0].bid,
  snapshots[1].close, snapshots[1].volume, snapshots[1].bid,
], [100, 2, 99.99, 102, 5, 101.99]);
check("one minute produces twelve five-second samples", snapshots.length, 12);
check("completed-bar fidelity accepts exact provider reproduction", assessBarFidelity(
  { open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { open: 100, high: 102, low: 99, close: 101, volume: 10 },
).reason, "matched");
check("excluded-price trade censors timing research", assessBarFidelity(
  { open: 100, high: 102.5, low: 99, close: 101, volume: 10 },
  { open: 100, high: 102, low: 99, close: 101, volume: 10 },
).reason, "ohlc_mismatch");
check("missing official volume censors timing research", assessBarFidelity(
  { open: 100, high: 102, low: 99, close: 101, volume: 9 },
  { open: 100, high: 102, low: 99, close: 101, volume: 10 },
).reason, "volume_mismatch");

console.log(`intraminute-replay-model-selftest: ${checks}/${checks} PASS`);
