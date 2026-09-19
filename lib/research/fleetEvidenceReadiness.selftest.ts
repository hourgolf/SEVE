import assert from "node:assert/strict";
import { buildFleetEvidenceReadiness } from "./fleetEvidenceReadiness";
import type { ChannelPassport, FleetEvidenceAudit } from "./fleetEvidenceAudit";

const coverage = (covered: number, eligible: number) => ({ covered, eligible, pct: eligible ? covered * 100 / eligible : null });
const passport = (slug: string, input: { roots: number; closed: number; covered: number; managers?: number }): ChannelPassport => ({
  identity: { strategistId: slug, slug, name: slug, familyId: "TEST", mode: "automatic", accountId: "account", accountName: "paper", accountMode: "paper", underlying: "SPY", executor: "stream", status: "armed", active: true, muted: false },
  signals: { observed: input.roots || 1, actedOn: input.roots, notActedOn: 0, blockedWithReason: 0, notActedWithoutReason: 0 },
  ledger: { positionRows: input.closed, rootTrades: input.roots, runnerRows: 0, openRows: 0, closedRows: input.closed, closedRowsWithPnl: input.closed, independentEntrySessions: input.roots ? 1 : 0, entryResearchRootTrades: input.roots, multiContractRootTrades: input.roots, fourPlusContractRootTrades: input.roots },
  outcomeProvenance: { nativeRows: input.closed, nativeRowsWithPnl: input.closed, nativeWinningRows: input.closed, nativeLosingRows: 0, nativeFlatRows: 0, operatorManagedRows: 0, annotatedExcludedRows: 0, executionCorrectionRows: 0, legacyUnattributedRows: 0 },
  economics: { grossLedgerPnl: input.closed * 10, nativeOutcomePnl: input.closed * 10, operatorManagedPnl: 0, annotatedExcludedPnl: 0, executionCorrectionPnl: 0, legacyUnattributedPnl: 0 },
  durableLineage: {
    openedReceiptCoverage: coverage(input.covered, input.closed),
    bookedReceiptCoverage: coverage(input.covered, input.closed),
    opportunityCoverage: coverage(input.covered, input.roots),
    entryDecisionCoverage: coverage(input.covered, input.roots),
    entryBrokerResultCoverage: coverage(input.covered, input.roots),
    exitBrokerResultCoverage: coverage(input.covered, input.closed),
  },
  managerObservation: { currentFourPlusEligibleRootTrades: input.roots, enrolledPositions: input.managers ?? 0, runRows: input.managers ?? 0, activeRuns: 0, terminalRuns: input.managers ?? 0, censoredRuns: 0, completeComparisonRuns: input.managers ?? 0, completeComparisonPositions: input.managers ?? 0 },
  evidenceTier: input.covered === input.closed ? "durable_lineage_complete" : "durable_lineage_partial",
  nativeOutcomeComparable: input.covered === input.closed,
  managerComparisonObserved: !!input.managers,
  promotionEligible: false,
  blockers: [],
});
const audit = (channels: ChannelPassport[]): FleetEvidenceAudit => ({
  schemaVersion: 1,
  summary: { channels: channels.length, channelsWithTrades: channels.length, channelsWithSignalsOnly: 0, rootTrades: 0, closedRows: 0, nativeRows: 0, operatorManagedRows: 0, annotatedExcludedRows: 0, executionCorrectionRows: 0, legacyUnattributedRows: 0, grossLedgerPnl: 0, nativeOutcomePnl: 0, completeLineageChannels: 0 },
  unmappedEvidence: { signals: 0, positions: 0, executionRows: 0, outcomeRows: 0, managerRuns: 0 },
  families: [], channels, promotionEligible: false, caveats: [],
});

const result = buildFleetEvidenceReadiness([
  { label: "history", fromDateEt: "2026-06-01", throughDateEt: "2026-09-18", audit: audit([passport("alpha", { roots: 4, closed: 4, covered: 2 })]) },
  { label: "recent", fromDateEt: "2026-09-14", throughDateEt: "2026-09-18", audit: audit([passport("alpha", { roots: 2, closed: 2, covered: 2, managers: 2 })]) },
], "2026-09-19T04:00:00.000Z");
assert.equal(result.state, "pass");
assert.equal(result.channels[0].evidenceState, "complete");
assert.equal(result.channels[0].pairedExitState, "observed");
assert.equal(result.channels[0].windows[0].bookedPct, 50);
assert.equal(result.channels[0].windows[1].nativeWinRate, 100);
assert.deepEqual(result.notes, []);

const partial = buildFleetEvidenceReadiness([
  { label: "recent", fromDateEt: "2026-09-14", throughDateEt: "2026-09-18", audit: audit([passport("beta", { roots: 2, closed: 2, covered: 1 })]) },
], "2026-09-19T04:00:00.000Z");
assert.equal(partial.state, "warn");
assert.equal(partial.summary.partialLatestTradedChannels, 1);
assert.match(partial.blockers[0], /bookedOutcomes=1/);
assert.match(partial.blockers[0], /exitBrokerResults=1/);
assert.equal(partial.channels[0].pairedExitState, "not_observed");

console.log("fleet-evidence-readiness-selftest: PASS");
