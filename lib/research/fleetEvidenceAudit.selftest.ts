import {
  buildFleetEvidenceAudit,
  channelMode,
  inferResearchFamily,
  type FleetChannelReceipt,
  type FleetExecutionReceipt,
  type FleetManagerReceipt,
  type FleetOutcomeReceipt,
  type FleetPositionReceipt,
  type FleetSignalReceipt,
} from "./fleetEvidenceAudit.js";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${name}: expected ${e}, got ${a}`);
  passed += 1;
}

const channel = (strategistId: string, slug: string, underlying: string | null = "SPY"): FleetChannelReceipt => ({
  strategistId,
  slug,
  name: slug,
  accountId: `account-${strategistId}`,
  accountName: "FIRST-TEAM",
  accountMode: "paper",
  underlying,
  executor: "stream",
  status: "armed",
  active: true,
  muted: false,
});
const position = (
  id: string,
  strategistId: string,
  pnl: number | null,
  closeReason: string | null,
  quantity = 1,
  runnerOf: string | null = null,
  closedAt: string | null = "2026-07-13T15:00:00Z",
): FleetPositionReceipt => ({
  id,
  strategistId,
  openedAt: "2026-07-13T14:00:00Z",
  closedAt,
  quantity,
  realizedPnl: pnl,
  closeReason,
  runnerOf,
});
const outcome = (positionId: string, eventKind: string, opportunityId: string | null): FleetOutcomeReceipt => ({ positionId, eventKind, opportunityId });
const execution = (
  strategistId: string,
  positionId: string | null,
  eventKind: string,
  action: string,
  opportunityId: string | null = null,
): FleetExecutionReceipt => ({ strategistId, positionId, eventKind, action, opportunityId, blockedReason: null });

const channels = [channel("momo", "momo-shape-2"), channel("manual", "grind-manual"), channel("vb", "vb-ribbon-cross")];
const signals: FleetSignalReceipt[] = [
  { strategistId: "momo", actedOn: true, blockedReason: null },
  { strategistId: "momo", actedOn: false, blockedReason: "daily_stop" },
  { strategistId: "vb", actedOn: false, blockedReason: "not_armed" },
  { strategistId: "ghost", actedOn: false, blockedReason: "unknown" },
];
const positions: FleetPositionReceipt[] = [
  position("m1", "momo", 348, "target_premium", 12),
  position("m2", "momo", 100, "manual:target", 2),
  position("m3", "momo", 50, "target_premium", 4),
  position("m4", "momo", 25, "target_premium", 2, "m3"),
  position("m5", "momo", -10, null),
  position("m6", "momo", 2, "reconciled"),
  position("m7", "momo", null, null, 3, null, null),
  position("g1", "manual", 20, "target_premium", 2),
  position("g2", "manual", -5, "manual_eod_backstop", 2),
  position("ghost-position", "ghost", 1, "target_premium"),
];
const outcomes: FleetOutcomeReceipt[] = [
  outcome("m1", "position_opened", "opp-1"), outcome("m1", "position_booked", "opp-1"),
  outcome("m2", "position_opened", "opp-2"), outcome("m2", "position_booked", "opp-2"),
  outcome("m3", "position_opened", "opp-3"), outcome("m3", "position_booked", "opp-3"),
  outcome("m4", "position_remainder_opened", "opp-3"), outcome("m4", "position_booked", "opp-3"),
  outcome("missing-position", "position_booked", "opp-x"),
];
const executions: FleetExecutionReceipt[] = [
  execution("momo", "m1", "decision", "enter", "opp-1"),
  execution("momo", "m1", "broker_result", "enter", "opp-1"),
  execution("momo", "m1", "broker_result", "exit", "opp-1"),
  execution("momo", "m2", "decision", "enter", "opp-2"),
  execution("momo", "m2", "broker_result", "enter", "opp-2"),
  execution("momo", "m2", "broker_result", "exit", "opp-2"),
  execution("momo", null, "decision", "enter", "opp-3"),
  execution("momo", null, "broker_result", "enter", "opp-3"),
  execution("momo", "m4", "broker_result", "add", "opp-3"),
  execution("momo", "m3", "broker_result", "exit", "opp-3"),
  execution("momo", "m4", "broker_result", "exit", "opp-3"),
  execution("ghost", null, "decision", "enter", null),
];
const managerRuns: FleetManagerReceipt[] = [
  { strategistId: "momo", positionId: "m3", status: "terminal", economicMode: "whole_lot_executable", terminalPnl: 75, actualRealizedPnl: 50 },
  { strategistId: "momo", positionId: "m3", status: "censored", economicMode: "whole_lot_executable", terminalPnl: null, actualRealizedPnl: null },
  { strategistId: "momo", positionId: "m4", status: "active", economicMode: "normalized_fractional", terminalPnl: null, actualRealizedPnl: null },
  { strategistId: "ghost", positionId: "ghost-position", status: "active", economicMode: "whole_lot_executable", terminalPnl: null, actualRealizedPnl: null },
];

const audit = buildFleetEvidenceAudit({
  channels,
  signals,
  positions,
  executions,
  outcomes,
  managerRuns,
  annotations: [{ positionId: "m1", analysisClass: "operator_test", note: "manual close drill" }],
});
const momo = audit.channels.find((passport) => passport.identity.slug === "momo-shape-2");
const manual = audit.channels.find((passport) => passport.identity.slug === "grind-manual");
const vb = audit.channels.find((passport) => passport.identity.slug === "vb-ribbon-cross");
if (!momo || !manual || !vb) throw new Error("fixture passports missing");

check("schema version", audit.schemaVersion, 1);
check("automatic mode", channelMode("momo-shape-2"), "automatic");
check("operator twin mode", channelMode("grind-manual"), "operator_twin");
check("MOMO family", inferResearchFamily("momo-shape-2", "SPY"), "MOMO");
check("QQQ family", inferResearchFamily("orb-qqq-trail", "QQQ"), "QQQ");
check("IWM family", inferResearchFamily("breakout-alt-v3-iwm", "IWM"), "IWM");
check("VB family retains alpha family", inferResearchFamily("vb-ribbon-cross-qqq", "QQQ"), "VB");
check("signal split", momo.signals, { observed: 2, actedOn: 1, notActedOn: 1, blockedWithReason: 1, notActedWithoutReason: 0 });
check("root and runner rows", [momo.ledger.positionRows, momo.ledger.rootTrades, momo.ledger.runnerRows], [7, 6, 1]);
check("closed and open rows", [momo.ledger.closedRows, momo.ledger.openRows], [6, 1]);
check("annotation removes entry research row", momo.ledger.entryResearchRootTrades, 5);
check("multi-contract begins at two", momo.ledger.multiContractRootTrades, 3);
check("four-plus manager eligibility is not a trade rule", momo.ledger.fourPlusContractRootTrades, 1);
check("provenance classes", momo.outcomeProvenance, {
  nativeRows: 2,
  nativeRowsWithPnl: 2,
  nativeWinningRows: 2,
  nativeLosingRows: 0,
  nativeFlatRows: 0,
  operatorManagedRows: 1,
  annotatedExcludedRows: 1,
  executionCorrectionRows: 1,
  legacyUnattributedRows: 1,
});
check("gross ledger remains intact", momo.economics.grossLedgerPnl, 515);
check("native outcome excludes contaminated rows", momo.economics.nativeOutcomePnl, 75);
check("operator outcome separated", momo.economics.operatorManagedPnl, 100);
check("annotated test separated", momo.economics.annotatedExcludedPnl, 348);
check("legacy and correction separate", [momo.economics.legacyUnattributedPnl, momo.economics.executionCorrectionPnl], [-10, 2]);
check("opened coverage deduplicates events", momo.durableLineage.openedReceiptCoverage, { covered: 4, eligible: 7, pct: 57.14 });
check("booked coverage", momo.durableLineage.bookedReceiptCoverage, { covered: 4, eligible: 6, pct: 66.67 });
check("opportunity coverage uses roots", momo.durableLineage.opportunityCoverage, { covered: 3, eligible: 6, pct: 50 });
check("entry broker coverage uses roots", momo.durableLineage.entryBrokerResultCoverage, { covered: 3, eligible: 6, pct: 50 });
check("unlinked entry evidence resolves through opportunity id", momo.durableLineage.entryDecisionCoverage, { covered: 3, eligible: 6, pct: 50 });
check("exit evidence coverage", momo.durableLineage.exitBrokerResultCoverage, { covered: 4, eligible: 6, pct: 66.67 });
check("partial lineage tier", momo.evidenceTier, "durable_lineage_partial");
check("partial lineage blocker names missing exit evidence", momo.blockers.includes("2 closed row(s) lack auxiliary exit broker-result evidence"), true);
check("native rows have comparable lineage", momo.nativeOutcomeComparable, true);
check("manager runs and positions remain distinct", momo.managerObservation, {
  currentFourPlusEligibleRootTrades: 1,
  enrolledPositions: 2,
  runRows: 3,
  activeRuns: 1,
  terminalRuns: 1,
  censoredRuns: 1,
  completeComparisonRuns: 1,
  completeComparisonPositions: 1,
});
check("manager comparison observed", momo.managerComparisonObserved, true);
check("manual twin is not native P&L", [manual.outcomeProvenance.nativeRows, manual.outcomeProvenance.operatorManagedRows, manual.economics.operatorManagedPnl], [0, 2, 15]);
check("manual legacy rows still have legacy-only lineage", manual.evidenceTier, "legacy_ledger_only");
check("signals without positions remain visible", [vb.evidenceTier, vb.signals.observed], ["signals_only", 1]);
check("unmapped evidence never silently disappears", audit.unmappedEvidence, { signals: 1, positions: 1, executionRows: 1, outcomeRows: 1, managerRuns: 1 });
check("promotion permanently prohibited", [audit.promotionEligible, momo.promotionEligible], [false, false]);
check("family rollup", audit.families.find((family) => family.familyId === "MOMO"), {
  familyId: "MOMO",
  channels: 1,
  channelsWithTrades: 1,
  rootTrades: 6,
  closedRows: 6,
  nativeRows: 2,
  operatorManagedRows: 1,
  annotatedExcludedRows: 1,
  grossLedgerPnl: 515,
  nativeOutcomePnl: 75,
  completeLineageChannels: 0,
});
check("fleet summary does not count unmapped rows", [audit.summary.channels, audit.summary.rootTrades, audit.summary.grossLedgerPnl], [3, 8, 530]);

let duplicateError = "";
try {
  buildFleetEvidenceAudit({ channels: [channel("dup", "a"), channel("dup", "b")], signals: [], positions: [], executions: [], outcomes: [], managerRuns: [] });
} catch (error) {
  duplicateError = error instanceof Error ? error.message : String(error);
}
check("duplicate channel ids rejected", duplicateError, "duplicate strategistId: dup");

const missingPnlAudit = buildFleetEvidenceAudit({
  channels: [channel("missing", "missing-pnl")],
  signals: [],
  positions: [position("missing-pnl-position", "missing", null, "target_premium")],
  executions: [
    execution("missing", null, "decision", "enter", "missing-opp"),
    execution("missing", null, "broker_result", "enter", "missing-opp"),
    execution("missing", "missing-pnl-position", "broker_result", "exit", "missing-opp"),
  ],
  outcomes: [
    outcome("missing-pnl-position", "position_opened", "missing-opp"),
    outcome("missing-pnl-position", "position_booked", "missing-opp"),
  ],
  managerRuns: [],
});
const missingPnlPassport = missingPnlAudit.channels[0];
check("missing realized P&L makes aggregates unknown", [missingPnlPassport?.economics.grossLedgerPnl, missingPnlPassport?.economics.nativeOutcomePnl], [null, null]);
check("missing realized P&L cannot become comparable", [missingPnlPassport?.nativeOutcomeComparable, missingPnlAudit.summary.grossLedgerPnl], [false, null]);

console.log(`fleet-evidence-audit-selftest: ${passed}/${passed} PASS`);
