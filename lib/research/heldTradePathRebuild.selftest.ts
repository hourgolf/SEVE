import assert from "node:assert/strict";
import { analyzeTradePath, type TradePathPosition, type TradePathQuote } from "./tradePathAnalysis.js";
import { rebuildHeldTradePathAudit } from "./heldTradePathRebuild.js";

let checks = 0;
const check = (name: string, actual: unknown, expected: unknown): void => { assert.deepEqual(actual, expected, name); checks += 1; };
const openedAtMs = Date.parse("2026-07-15T14:00:00Z");
const occ = "SPY260715C00750000";
const coarse: TradePathQuote[] = [{ atMs: openedAtMs + 30_000, bid: 0.9, ask: 0.92, source: "supabase_live" }];
const exact: TradePathQuote[] = [
  { atMs: openedAtMs, bid: 1, ask: 1.02, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 1_000, bid: 1.2, ask: 1.22, source: "databento_cbbo_1s" },
  { atMs: openedAtMs + 2_000, bid: 0.5, ask: 0.52, source: "databento_cbbo_1s" },
];
const position: TradePathPosition = {
  id: "p1", opportunityId: "o1", strategistId: "s1", channel: "momo-shape", familyId: "MOMO", underlying: "SPY", occSymbol: occ,
  quantity: 4, entryPrice: 1, openedAtMs, sourceBarAtMs: openedAtMs - 60_000, closedAtMs: openedAtMs + 2_000,
  realizedPnl: -200, closeReason: "premium_stop", outcomeClass: "native", runnerOf: null,
  entryDecision: null, entryFill: null, exitDecision: null, exitFill: null, intraminute: null,
};
const frozen = analyzeTradePath(position, coarse);
const audit = rebuildHeldTradePathAudit({ frozenTrades: [frozen], quotesByOcc: new Map([[occ, exact]]) });
check("identity and outcome stay frozen", [audit.trades[0].positionId, audit.trades[0].realizedPnl, audit.trades[0].outcomeClass], ["p1", -200, "native"]);
check("exact quote source replaces coarse path", audit.trades[0].coverage.sources, ["databento_cbbo_1s"]);
check("exact path restores one-second eligibility", [audit.trades[0].nativeExitEligible, audit.trades[0].coverage.startLagSec, audit.trades[0].coverage.endLeadSec], [true, 0, 0]);
check("exact excursion is recalculated", [audit.trades[0].path.observedMfePct, audit.trades[0].path.observedMaePct], [20, -50]);
check("summary derives from rebuilt results", [audit.summary.trades, audit.summary.nativeExitComparable, audit.summary.nativeComparablePnl], [1, 1, -200]);
check("rebuild cannot promote", audit.promotionEligible, false);

console.log(`held-trade-path-rebuild-selftest: ${checks}/${checks} PASS`);
