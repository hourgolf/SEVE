import assert from "node:assert/strict";
import type { TradePathResult } from "./tradePathAnalysis.js";
import { auditHeldLedger } from "./heldLedgerIntegrity.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  assert.deepEqual(actual, expected, name);
  checks += 1;
};

const trade = (id: string, channel: string, openedAtMs: number, closedAtMs: number, quantity = 4): TradePathResult => ({
  positionId: id, opportunityId: null, channel, familyId: "PB", underlying: "SPY", occSymbol: "SPY260715C00750000",
  outcomeClass: "native", quantity, openedAtMs, sourceBarAtMs: 1_000, closedAtMs, realizedPnl: channel === "loss" ? -20 : 40,
  closeReason: "target_premium", runnerOf: null, multiContract: true, fourPlusContracts: quantity >= 4,
  entryPathEligible: true, nativeExitEligible: true, scalePathEligible: true,
  coverage: { sources: ["databento_cbbo_1s"], inputRows: 1, validRows: 1, invalidRows: 0, firstAtMs: openedAtMs, lastAtMs: closedAtMs, startLagSec: 0, endLeadSec: 0, maxInternalGapSec: 1, complete: true, censorCodes: [] },
  path: { entryPrice: 1, actualExitPrice: 1.1, durationSec: 1, observedMfePct: 10, observedMaePct: -5, peakBid: 1.1, peakAtMs: openedAtMs, secondsToPeak: 0, troughBid: 0.95, troughAtMs: openedAtMs, secondsToTrough: 0, realizedReturnPct: 10, peakGivebackPctPoints: 0, realizedCaptureRatio: 1, targetTouches: [] },
  execution: { entryDecisionBid: null, entryDecisionAsk: null, entryDecisionSpreadPct: null, entryFillPrice: null, entryFillVsAsk: null, entryFillVsAskPct: null, entryQuoteFresh: false, exitDecisionBid: null, exitDecisionAsk: null, exitDecisionSpreadPct: null, exitFillPrice: null, exitFillVsBid: null, exitFillVsBidPct: null, exitQuoteFresh: false },
  intraminute: null, promotionEligible: false,
});

const clean = [trade("a", "pb-ride", 1_000, 4_000, 4), trade("b", "pb-ride-2", 2_000, 5_000, 6), trade("c", "loss", 6_000, 7_000, 2)];
const report = auditHeldLedger(clean);
check("clean ledger has no blockers", [report.readyForExactBackfill, report.blockingIssues], [true, []]);
check("overlap is measured, not called corruption", [report.occStacks.length, report.maximumConcurrentPositionsOnOneOcc, report.maximumConcurrentContractsOnOneOcc], [1, 2, 10]);
check("same clock retains channels", report.sameClockGroups[0].channels, ["loss", "pb-ride", "pb-ride-2"]);
check("outcome rollup", report.outcomeClasses, [{ outcomeClass: "native", positions: 3, realizedPnl: 60 }]);
check("policy stays powerless", [report.policyChangeAuthorized, report.productionChangeAuthorized], [false, false]);

const badOperator = { ...trade("manual", "pb-ride", 8_000, 9_000), outcomeClass: "operator_managed" as const, closeReason: "target_premium" };
const bad = auditHeldLedger([...clean, clean[0], badOperator, { ...trade("open", "pb-ride", 10_000, 11_000), closedAtMs: null, realizedPnl: null }]);
check("duplicate id blocks", bad.duplicatePositionIds, ["a"]);
check("duplicate logical key blocks", bad.duplicateTradeKeys.length, 1);
check("unresolved blocks", bad.unresolvedPositions, ["open"]);
check("operator provenance mismatch blocks", bad.operatorWithoutManualReason, ["manual"]);
check("bad ledger is not backfill-ready", bad.readyForExactBackfill, false);

console.log(`held-ledger-integrity-selftest: ${checks}/${checks} PASS`);
