import { strict as assert } from "node:assert";
import {
  replayRc54Composite,
  replayRc54SealedManager,
  type Rc54ReplayQuote,
} from "./rc54CompositeReplay.js";
import type { Bar } from "../../engine/types.js";

let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  assert.deepEqual(actual, expected, label);
}

const start = Date.parse("2026-07-24T14:30:00.000Z");
const at = (minute: number, bid: number): Rc54ReplayQuote => ({
  atMs: start + minute * 60_000,
  bid,
});
const replay = (
  profile: Parameters<typeof replayRc54Composite>[0]["profile"],
  quotes: Rc54ReplayQuote[],
) => replayRc54Composite({
  profile,
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes,
});

const b30a13 = replay("B30/A13", [
  at(0, 0.98), at(1, 1.31), at(2, 1.5), at(3, 2), at(4, 1.65),
  at(300, 1.2),
]);
check("B30 bank uses first executable target overshoot", [
  b30a13.lots[0].exitReason, b30a13.lots[0].exitBid, b30a13.lots[0].pnl,
], ["target", 1.31, 31]);
check("A13 keeps two thirds of peak gain", [
  b30a13.lots[1].exitReason, b30a13.lots[1].exitBid, b30a13.lots[1].peakReturnPct,
], ["a13_giveback", 1.65, 100]);
check("two lots sum, not average, into profile pnl", [
  b30a13.pnl, b30a13.pnlPerContract, b30a13.exitAtMs,
], [96, 48, at(4, 0).atMs]);

const stopped = replay("B50/A13", [at(0, 0.69), at(300, 1)]);
check("risk precedes reward and stops both unarmed lots", stopped.lots.map((lot) => lot.exitReason), [
  "stop", "prearm_stop",
]);
check("stopped two-lot pnl is executable bid based", stopped.pnl, -62);

const locks = replay("L30/L50", [at(0, 1), at(1, 1.32), at(2, 1.51)]);
check("L30/L50 exits independently", locks.lots.map((lot) => [lot.exitReason, lot.exitBid]), [
  ["target", 1.32], ["target", 1.51],
]);

const bell = replay("L30/L50", [at(0, 1), at(299, 1.1), at(301, 2)]);
check("time flatten is last executable state without lookahead", bell.lots.map((lot) => [
  lot.exitReason, lot.exitBid,
]), [["time_flatten", 1.1], ["time_flatten", 1.1]]);

const noBid = replay("L30/L50", [at(0, 0), at(299, 0)]);
check("no executable bid fails closed", [noBid.exact, noBid.censors], [
  false, ["missing_executable_path"],
]);

const nativeMissing = replay("B20/NATIVE-ATR", [at(0, 1), at(1, 1.21)]);
check("native ATR cannot be inferred from option quotes", [
  nativeMissing.exact, nativeMissing.censors, nativeMissing.lots.length,
], [false, ["native_atr_path_unavailable"], 1]);

const nativeExact = replayRc54Composite({
  profile: "B20/NATIVE-ATR",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 1), at(1, 1.21)],
  nativeAtrReceipt: { exitAtMs: at(20, 0).atMs, exitBid: 1.4 },
});
check("native ATR is accepted only with an explicit exact receipt", [
  nativeExact.exact, nativeExact.pnl, nativeExact.lots[1].basis,
], [true, 61, "native_atr_exact_receipt"]);

const afterBell = replayRc54Composite({
  profile: "B30/A13",
  entryAsk: 1,
  entryAtMs: start + 301 * 60_000,
  flattenAtMs: start + 300 * 60_000,
  quotes: [],
});
check("entries after the cutoff are ineligible", afterBell.censors, [
  "invalid_clock", "entry_after_flatten", "missing_executable_path",
]);
check("replay can never authorize writes, orders, or policy", [
  b30a13.externalWrites, b30a13.orderPathAuthorized, b30a13.policyChangeAuthorized,
], [false, false, false]);

const sealedRide = replayRc54SealedManager({
  profile: "RC53-RIDE",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 1), at(20, 1.8), at(300, 1.25)],
  occSymbol: "QQQ260724C00500000",
});
check("full-position RIDE preserves both original contracts through flatten", [
  sealedRide.lots.map((lot) => [lot.lot, lot.exitReason, lot.exitBid]),
  sealedRide.pnl,
], [[["bank", "time_flatten", 1.25], ["runner", "time_flatten", 1.25]], 50]);

const sealedA13 = replayRc54SealedManager({
  profile: "RC53-A13",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 1), at(20, 1.6), at(21, 1.39), at(300, 1.8)],
  occSymbol: "QQQ260724C00500000",
});
check("full-position A13 applies one immutable exit to both contracts", [
  sealedA13.lots.map((lot) => [lot.lot, lot.exitReason, lot.exitBid]),
  sealedA13.pnl,
], [[["bank", "a13_giveback", 1.39], ["runner", "a13_giveback", 1.39]], 78]);

const bar = (minute: number, close: number, range = 0.1): Bar => ({
  ts: start + minute * 60_000,
  open: close,
  high: close + range / 2,
  low: close - range / 2,
  close,
  volume: 100,
  vwap: close,
});
const warmupBars = Array.from({ length: 16 }, (_, index) => bar(index - 15, 100));
const atrBars = [
  ...warmupBars,
  bar(1, 101),
  bar(2, 102),
  bar(3, 101.7),
];
const nativeNoBars = replayRc54SealedManager({
  profile: "QQQ54-B20-NATIVE-ATR",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 1), at(1, 1.21), at(300, 1.1)],
  occSymbol: "QQQ260724C00500000",
});
check("sealed native ATR fails closed without underlying evidence", [
  nativeNoBars.exact, nativeNoBars.censors,
], [false, ["native_atr_underlying_path_unavailable"]]);

const sealedNative = replayRc54SealedManager({
  profile: "QQQ54-B20-NATIVE-ATR",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 1), at(1, 1.21), at(2, 1.5), at(3, 1.4), at(300, 1.1)],
  occSymbol: "QQQ260724C00500000",
  underlyingBars: atrBars,
  nativeAtrTrailK: 1.5,
});
check("native ATR banks once then values the underlying trigger at executable bid", [
  sealedNative.exact,
  sealedNative.lots.map((lot) => [lot.lot, lot.exitReason, lot.exitBid]),
  sealedNative.pnl,
], [true, [["bank", "target", 1.21], ["runner", "native_atr", 1.4]], 61]);

const nativePrebankStop = replayRc54SealedManager({
  profile: "QQQ54-B20-NATIVE-ATR",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 0.69), at(1, 1.5)],
  occSymbol: "QQQ260724P00500000",
  underlyingBars: atrBars,
});
check("a pre-bank catastrophe closes the original two-contract row", [
  nativePrebankStop.lots.map((lot) => [lot.lot, lot.exitReason, lot.exitBid]),
  nativePrebankStop.pnl,
], [[["bank", "stop", 0.69], ["runner", "stop", 0.69]], -62]);

const nativeStopAfterBank = replayRc54SealedManager({
  profile: "QQQ54-B20-NATIVE-ATR",
  entryAsk: 1,
  entryAtMs: start,
  flattenAtMs: start + 300 * 60_000,
  quotes: [at(0, 1), at(1, 1.21), at(2, 0.69), at(3, 1.4)],
  occSymbol: "QQQ260724C00500000",
  underlyingBars: atrBars,
});
check("post-bank catastrophe owns an earlier clock than a later ATR exit", [
  nativeStopAfterBank.lots.map((lot) => [lot.exitReason, lot.exitBid]),
  nativeStopAfterBank.pnl,
], [[["target", 1.21], ["stop", 0.69]], -10]);

check("sealed replay remains research-only", [
  sealedNative.externalWrites,
  sealedNative.orderPathAuthorized,
  sealedNative.policyChangeAuthorized,
], [false, false, false]);

console.log(`rc54-composite-replay-selftest: ${checks}/${checks} PASS`);
