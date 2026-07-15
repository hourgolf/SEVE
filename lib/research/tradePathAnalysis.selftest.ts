import assert from "node:assert/strict";
import {
  analyzeTradePath,
  buildTradePathAudit,
  DEFAULT_TRADE_PATH_THRESHOLDS,
  type TradePathPosition,
  type TradePathQuote,
} from "./tradePathAnalysis.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks++;
};

const base: TradePathPosition = {
  id: "p1",
  opportunityId: "o1",
  strategistId: "s1",
  channel: "pb-ride",
  familyId: "PB",
  underlying: "SPY",
  occSymbol: "SPY260715C00600000",
  quantity: 5,
  entryPrice: 1,
  openedAtMs: 0,
  sourceBarAtMs: 0,
  closedAtMs: 100_000,
  realizedPnl: 50,
  closeReason: "target_premium",
  outcomeClass: "native",
  runnerOf: null,
  entryDecision: { atMs: -1_000, bid: 0.98, ask: 1.02, fillPrice: null, quoteAgeMs: 500 },
  entryFill: { atMs: 0, bid: 1, ask: 1.04, fillPrice: 1.03, quoteAgeMs: 1_000 },
  exitDecision: { atMs: 99_000, bid: 1.08, ask: 1.12, fillPrice: null, quoteAgeMs: 400 },
  exitFill: { atMs: 100_000, bid: 1.08, ask: 1.12, fillPrice: 1.1, quoteAgeMs: 500 },
  intraminute: { sourceBarAtMs: 0, receiptCount: 2, schemaVersions: [2], gapCount: 0, checksumVerified: true },
};

const path: TradePathQuote[] = [
  { atMs: 0, bid: 0.9, ask: 1, source: "local_archive" },
  { atMs: 25_000, bid: 1.1, ask: 1.15, source: "local_archive" },
  { atMs: 50_000, bid: 1.5, ask: 1.55, source: "local_archive" },
  { atMs: 75_000, bid: 0.8, ask: 0.85, source: "local_archive" },
  { atMs: 100_000, bid: 1.05, ask: 1.1, source: "local_archive" },
];

const result = analyzeTradePath(base, path);
check("complete path", result.coverage.complete, true);
check("path coverage boundaries", [result.coverage.startLagSec, result.coverage.endLeadSec, result.coverage.maxInternalGapSec], [0, 0, 25]);
check("path source retained", result.coverage.sources, ["local_archive"]);
check("mfe is executable-bid return", [result.path.observedMfePct, result.path.peakBid, result.path.secondsToPeak], [50, 1.5, 50]);
check("mae is executable-bid return", [result.path.observedMaePct, result.path.troughBid, result.path.secondsToTrough], [-20, 0.8, 75]);
check("actual exit reconstructed from booked pnl", [result.path.actualExitPrice, result.path.realizedReturnPct], [1.1, 10]);
check("giveback and capture are explicit", [result.path.peakGivebackPctPoints, result.path.realizedCaptureRatio], [40, 0.2]);
check("target first touch", result.path.targetTouches.slice(0, 3).map((target) => [target.targetPct, target.secondsFromOpen]), [[10, 25], [15, 50], [20, 50]]);
check("whole-lot scale eligibility begins at two", [result.multiContract, result.fourPlusContracts, result.scalePathEligible], [true, true, true]);
check("fresh entry slippage uses decision ask", [result.execution.entryQuoteFresh, result.execution.entryFillVsAsk, result.execution.entryFillVsAskPct], [true, 0.01, 0.9804]);
check("fresh exit slippage uses decision bid", [result.execution.exitQuoteFresh, result.execution.exitFillVsBid, result.execution.exitFillVsBidPct], [true, 0.02, 1.8519]);
check("decision spreads stay visible beside slippage", [result.execution.entryDecisionSpreadPct, result.execution.exitDecisionSpreadPct], [4, 3.6364]);
check("intraminute verification retained", result.intraminute?.checksumVerified, true);
check("promotion is impossible", result.promotionEligible, false);

const staleMarks = analyzeTradePath({
  ...base,
  entryDecision: { ...base.entryDecision!, quoteAgeMs: DEFAULT_TRADE_PATH_THRESHOLDS.maxExecutionQuoteAgeMs + 1 },
  exitDecision: { ...base.exitDecision!, quoteAgeMs: null },
}, path);
check("stale entry quote censors slippage", [staleMarks.execution.entryQuoteFresh, staleMarks.execution.entryFillVsAsk], [false, null]);
check("missing exit quote age censors slippage", [staleMarks.execution.exitQuoteFresh, staleMarks.execution.exitFillVsBid], [false, null]);

const crossedMarks = analyzeTradePath({
  ...base,
  entryDecision: { ...base.entryDecision!, bid: 1.05, ask: 1.04 },
  exitDecision: { ...base.exitDecision!, bid: 1.12, ask: 1.08 },
}, path);
check("crossed decision marks cannot manufacture slippage", [
  crossedMarks.execution.entryQuoteFresh,
  crossedMarks.execution.entryDecisionSpreadPct,
  crossedMarks.execution.entryFillVsAsk,
  crossedMarks.execution.exitQuoteFresh,
  crossedMarks.execution.exitDecisionSpreadPct,
  crossedMarks.execution.exitFillVsBid,
], [false, null, null, false, null, null]);

const incomplete = analyzeTradePath(base, [
  { atMs: 80_000, bid: 1, ask: 1.1, source: "databento_cbbo_1m" },
]);
check("late first observation is left-censored", incomplete.coverage.censorCodes.includes("left_censored"), true);
check("early last observation is not right-censored inside tolerance", incomplete.coverage.censorCodes.includes("right_censored"), false);
check("left-censored path is not exit-comparable", incomplete.nativeExitEligible, false);

const gaps = analyzeTradePath({ ...base, closedAtMs: 200_000 }, [
  { atMs: 0, bid: 1, ask: 1.1, source: "local_archive" },
  { atMs: 100_000, bid: 1.2, ask: 1.3, source: "local_archive" },
  { atMs: 200_000, bid: 1, ask: 1.1, source: "local_archive" },
]);
check("internal gap is explicit", [gaps.coverage.complete, gaps.coverage.censorCodes.includes("internal_gap")], [false, true]);

const right = analyzeTradePath({ ...base, closedAtMs: 200_000 }, [
  { atMs: 0, bid: 1, ask: 1.1, source: "local_archive" },
  { atMs: 50_000, bid: 1.2, ask: 1.3, source: "local_archive" },
]);
check("missing terminal observation is right-censored", right.coverage.censorCodes.includes("right_censored"), true);

const empty = analyzeTradePath(base, []);
check("no path is missing, not zero", [empty.coverage.complete, empty.path.observedMfePct, empty.coverage.censorCodes.includes("no_quotes")], [false, null, true]);

const outsideWindow = analyzeTradePath(base, [
  { atMs: 200_000, bid: 1, ask: 1.1, source: "local_archive" },
]);
check("contract rows outside the holding window are distinct from invalid quotes", [
  outsideWindow.coverage.censorCodes.includes("no_window_quotes"),
  outsideWindow.coverage.censorCodes.includes("no_valid_quotes"),
], [true, false]);

const invalid = analyzeTradePath(base, [
  { atMs: 10_000, bid: 0, ask: 1, source: "local_archive" },
  { atMs: 20_000, bid: 1.2, ask: 1.1, source: "local_archive" },
]);
check("zero and crossed quotes are rejected", [invalid.coverage.validRows, invalid.coverage.invalidRows, invalid.coverage.censorCodes.includes("no_valid_quotes")], [0, 2, true]);

const annotated = analyzeTradePath({ ...base, outcomeClass: "annotated_exclusion" }, path);
check("annotated test cannot teach entry or exit", [annotated.entryPathEligible, annotated.nativeExitEligible, annotated.coverage.censorCodes.includes("annotated_exclusion")], [false, false, true]);

const operator = analyzeTradePath({ ...base, outcomeClass: "operator_managed", closeReason: "manual:thesis" }, path);
check("operator close can teach entry path", operator.entryPathEligible, true);
check("operator close cannot teach native exit", [operator.nativeExitEligible, operator.path.realizedReturnPct, operator.coverage.censorCodes.includes("non_native_exit")], [false, null, true]);

const missingPnl = analyzeTradePath({ ...base, realizedPnl: null }, path);
check("missing pnl is not flat", [missingPnl.nativeExitEligible, missingPnl.path.actualExitPrice, missingPnl.coverage.censorCodes.includes("missing_realized_pnl")], [false, null, true]);

const open = analyzeTradePath({ ...base, closedAtMs: null, realizedPnl: null }, path);
check("open position is entry-only evidence", [open.coverage.censorCodes.includes("position_open"), open.nativeExitEligible], [true, false]);

const single = analyzeTradePath({ ...base, quantity: 1 }, path);
check("single lot remains exit-comparable but not scaleable", [single.nativeExitEligible, single.scalePathEligible, single.multiContract], [true, false, false]);

const audit = buildTradePathAudit({
  positions: [base, { ...base, id: "p2", channel: "pb-ride-2", realizedPnl: -100, outcomeClass: "native" }],
  quotesByOcc: new Map([[base.occSymbol, path]]),
});
check("family summary counts channels and paths", [audit.summary.trades, audit.summary.completePaths, audit.families[0].channels], [2, 2, 2]);
check("channel summaries retain the family denominator", audit.channels.map((channel) => [channel.familyId, channel.channel, channel.nativeExitComparable]), [["PB", "pb-ride", 1], ["PB", "pb-ride-2", 1]]);
check("comparable pnl is denominator-scoped", [audit.summary.nativeComparablePnl, audit.families[0].nativeComparablePnl], [-50, -50]);
check("family medians are deterministic", [audit.families[0].observedMfePctMedian, audit.families[0].observedMaePctMedian], [50, -20]);
check("family target reach is denominator-stamped", audit.families[0].targetReach[0], { targetPct: 10, reached: 2, eligible: 2 });
check("audit retains no-promotion invariant", audit.promotionEligible, false);

const censoredAudit = buildTradePathAudit({
  positions: [base, { ...base, id: "p3", occSymbol: "SPY260715C00601000", realizedPnl: 100 }],
  quotesByOcc: new Map([[base.occSymbol, path]]),
});
check("censored native pnl remains visible beside the comparable denominator", [
  censoredAudit.summary.nativeClosedWithPnl,
  censoredAudit.summary.nativeExitComparable,
  censoredAudit.summary.nativeComparablePnl,
  censoredAudit.summary.nativeCensored,
  censoredAudit.summary.nativeCensoredPnl,
], [2, 1, 50, 1, 100]);

console.log(`trade-path-analysis-selftest: ${checks}/${checks} PASS`);
