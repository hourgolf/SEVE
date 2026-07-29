import { strict as assert } from "node:assert";
import type { Bar } from "../../engine/types";
import type { DatabentoCbboQuote } from "./databentoExactPath";
import {
  deriveRc54SealedManagerStudy,
} from "./rc54SealedManagerStudy";
import type { Rc54ComparableCandidate } from "./rc54ComparableReplay";

let checks = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  assert.deepEqual(actual, expected, label);
}

const start = Date.parse("2026-07-24T14:30:00.000Z");
const sessionDateEt = "2026-07-24";
const occ = "QQQ260724C00500000";
const quote = (minute: number, bid: number, ask = bid): DatabentoCbboQuote => ({
  occSymbol: occ,
  atMs: start + minute * 60_000,
  bid,
  ask,
  bidSize: 1,
  askSize: 1,
  publisherId: 1,
  source: "databento_cbbo_1s",
});
const candidate = (
  candidateId: string,
  channelSlug: string,
  minute: number,
): Rc54ComparableCandidate => ({
  candidateId,
  sessionDateEt,
  channelSlug,
  occSymbol: occ,
  decisionAtMs: start + minute * 60_000,
});
const bar = (minute: number, close: number, range = 0.1): Bar => ({
  ts: start + minute * 60_000,
  open: close,
  high: close + range / 2,
  low: close - range / 2,
  close,
  volume: 100,
  vwap: close,
});
const bars = [
  ...Array.from({ length: 16 }, (_, index) => bar(index - 15, 100)),
  bar(1, 101),
  bar(2, 102),
  bar(3, 101.7),
  bar(295, 101),
];
const quotes = [
  quote(0, 0.99, 1),
  quote(1, 1.21, 1.22),
  quote(2, 1.5, 1.51),
  quote(3, 1.4, 1.41),
  quote(295, 1.1, 1.11),
];
const source = new Map([[`${sessionDateEt}\u0000${occ}`, quotes]]);
const barSource = new Map([[`${sessionDateEt}\u0000QQQ`, bars]]);

const study = deriveRc54SealedManagerStudy({
  candidates: [candidate("a", "orb-qqq-trail", 0)],
  quotesByOccSession: source,
  barsByUnderlyingSession: barSource,
  nativeAtrTargetGrid: [20],
});
check("QQQ native lane includes full baselines and target sweep", study.paths.map(
  (path) => path.profileId,
), ["BANK20/NATIVE-ATR", "FULL-A13", "FULL-RIDE"]);
check("native lane uses underlying trigger and exact executable option bid", study.paths
  .find((path) => path.profileId === "BANK20/NATIVE-ATR")?.lotExits
  .map((lot) => [lot.exitReason, lot.exitBid]), [
  ["target", 1.21],
  ["native_atr", 1.4],
]);
check("study is immutable local research", [
  study.methodology.externalWrites,
  study.methodology.orderPathAuthorized,
  study.methodology.policyChangeAuthorized,
], [false, false, false]);

const dark = deriveRc54SealedManagerStudy({
  candidates: [candidate("dark", "vb-ribbon-cross-qqq", 0)],
  quotesByOccSession: source,
  barsByUnderlyingSession: new Map(),
  nativeAtrTargetGrid: [20],
});
check("dark and VB lanes receive faithful full-position controls", dark.paths.map(
  (path) => path.profileId,
), ["FULL-A13", "FULL-RIDE"]);
check("native ATR is not invented for channels without the sealed native profile",
  dark.censors.filter((row) => row.code === "missing_underlying_bars").length, 0);

const missingBars = deriveRc54SealedManagerStudy({
  candidates: [candidate("missing", "orb-qqq-trail", 0)],
  quotesByOccSession: source,
  barsByUnderlyingSession: new Map(),
  nativeAtrTargetGrid: [20],
});
check("native ATR fails closed when underlying evidence is absent", missingBars.censors
  .filter((row) => row.code === "missing_underlying_bars")
  .map((row) => row.profileId), ["BANK20/NATIVE-ATR"]);

const overlap = deriveRc54SealedManagerStudy({
  candidates: [
    candidate("first", "vb-ribbon-cross-qqq", 0),
    candidate("second", "vb-ribbon-cross-qqq", 1),
  ],
  quotesByOccSession: source,
  barsByUnderlyingSession: barSource,
  nativeAtrTargetGrid: [20],
});
check("sequential no-reentry is enforced per manager lane",
  overlap.censors.filter((row) => row.code === "sequential_reentry_active").length, 2);

const invalidSource = new Map([[`${sessionDateEt}\u0000${occ}`, [
  { ...quotes[0], source: "not-exact" as never },
]]]);
const failed = deriveRc54SealedManagerStudy({
  candidates: [candidate("bad", "orb-qqq-trail", 0)],
  quotesByOccSession: invalidSource,
  barsByUnderlyingSession: barSource,
  nativeAtrTargetGrid: [20],
});
check("non-exact option evidence fails closed", [
  failed.paths.length,
  failed.censors.map((row) => row.code),
], [0, ["non_exact_path_source"]]);

console.log(`rc54-sealed-manager-study-selftest: ${checks}/${checks} PASS`);
