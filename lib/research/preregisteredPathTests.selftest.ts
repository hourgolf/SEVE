import assert from "node:assert/strict";
import { analyzeTradePath, type TradePathPosition, type TradePathQuote } from "./tradePathAnalysis.js";
import { buildPreregisteredPathReport } from "./preregisteredPathTests.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks++;
};

const openedAtMs = Date.parse("2026-07-13T14:00:00Z");
const sourceBarAtMs = openedAtMs - 60_000;
const occ = "SPY260713P00600000";
const path: TradePathQuote[] = [
  { atMs: openedAtMs, bid: 1, ask: 1.02, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 1_000, bid: 1.2, ask: 1.22, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 2_000, bid: 0.9, ask: 0.92, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 3_000, bid: 0.5, ask: 0.52, source: "databento_cbbo_1s" },
];

const position = (id: string, channel: string, familyId: string, realizedPnl: number, opportunityId: string): TradePathPosition => ({
  id,
  opportunityId,
  strategistId: `s-${id}`,
  channel,
  familyId,
  underlying: "SPY",
  occSymbol: occ,
  quantity: 4,
  entryPrice: 1,
  openedAtMs,
  sourceBarAtMs,
  closedAtMs: openedAtMs + 3_000,
  realizedPnl,
  closeReason: "premium_stop",
  outcomeClass: "native",
  runnerOf: null,
  entryDecision: null,
  entryFill: null,
  exitDecision: null,
  exitFill: null,
  intraminute: null,
});

const trades = [
  analyzeTradePath(position("m1", "momo-shape", "MOMO", -200, "o1"), path),
  analyzeTradePath(position("m2", "momo-shape-2", "MOMO", -100, "o2"), path),
  analyzeTradePath(position("g1", "grind-v3", "GRIND", -80, "o3"), path),
];
const report = buildPreregisteredPathReport({ trades, quotesByOcc: new Map([[occ, path]]) });

check("completed development paths qualify at one-second fidelity", [report.cohort, report.exactPathEligible], ["development", 3]);
check("policy set is frozen and explicit", report.scalePolicies.map((row) => row.spec.id), [
  "MOMO-BANK15/RUN-NATIVE",
  "MOMO-BANK15/HALF-GIVEBACK",
  "MOMO-BANK20/HALF-GIVEBACK",
  "VB-RIBBON-BANK15/RUN-NATIVE",
  "VB-RIBBON-BANK15/HALF-GIVEBACK",
]);
check("MOMO bank/native scale replays whole lots", [report.scalePolicies[0].eligible, report.scalePolicies[0].triggered, report.scalePolicies[0].nativePnl, report.scalePolicies[0].modeledPnl, report.scalePolicies[0].deltaVsNative], [2, 2, -300, -70, 230]);
check("half-giveback arm remains distinct", [report.scalePolicies[1].modeledPnl, report.scalePolicies[1].deltaVsNative], [40, 340]);
check("family arm keeps channel-specific receipts", report.scalePolicies[0].byChannel.map((row) => [row.channel, row.nativePnl, row.modeledPnl, row.deltaVsNative]), [["momo-shape", -200, -60, 140], ["momo-shape-2", -100, -10, 90]]);
check("same clock creates one correlated group", [report.matchedClockGroups.length, report.matchedClockGroups[0].positions, report.matchedClockGroups[0].channels], [1, 3, ["grind-v3", "momo-shape", "momo-shape-2"]]);
check("pair comparisons are clock-matched, not opportunity-id matched", [report.matchedChannelPairs.length, report.sharedDurableOpportunityIds], [3, 0]);
check("admission family stays diagnostic", report.admissionDiagnostics[0], {
  familyId: "GRIND",
  channel: "grind-v3",
  eligible: 1,
  observedMfeNonPositive: 0,
  reached10Pct: 1,
  reached15Pct: 1,
  observedMaeAtOrBelowMinus30: 1,
  realizedPnl: -80,
  exitOptimizationAuthorized: false,
});
check("no development result authorizes policy", report.policyChangeAuthorized, false);
assert.throws(() => buildPreregisteredPathReport({
  trades: [trades[0], { ...trades[1], openedAtMs: Date.parse("2026-07-15T14:00:00Z") }],
  quotesByOcc: new Map([[occ, path]]),
}), /cannot be pooled/); checks++;

console.log(`preregistered-path-tests-selftest: ${checks}/${checks} PASS`);
