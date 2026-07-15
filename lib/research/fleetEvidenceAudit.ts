// Pure Phase 1K-A fleet evidence model. This file owns no client, timer,
// subscription, persistence, policy mutation, or execution behavior.

export const FLEET_EVIDENCE_AUDIT_SCHEMA_VERSION = 1 as const;

export type ChannelMode = "automatic" | "operator_twin";
export type EvidenceTier =
  | "no_observations"
  | "signals_only"
  | "legacy_ledger_only"
  | "durable_lineage_partial"
  | "durable_lineage_complete";
export type OutcomeClass =
  | "native"
  | "operator_managed"
  | "annotated_exclusion"
  | "execution_correction"
  | "legacy_unattributed";

export interface FleetChannelReceipt {
  strategistId: string;
  slug: string;
  name: string;
  accountId: string | null;
  accountName: string | null;
  accountMode: string | null;
  underlying: string | null;
  executor: string | null;
  status: string | null;
  active: boolean;
  muted: boolean | null;
}

export interface FleetSignalReceipt {
  strategistId: string;
  actedOn: boolean;
  blockedReason: string | null;
}

export interface FleetPositionReceipt {
  id: string;
  strategistId: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number | null;
  realizedPnl: number | null;
  closeReason: string | null;
  runnerOf: string | null;
}

export interface FleetExecutionReceipt {
  strategistId: string;
  positionId: string | null;
  eventKind: "decision" | "broker_result" | string;
  action: "enter" | "add" | "exit" | "reconcile" | string;
  opportunityId: string | null;
  blockedReason: string | null;
}

export interface FleetOutcomeReceipt {
  positionId: string;
  eventKind: string;
  opportunityId: string | null;
}

export interface FleetManagerReceipt {
  strategistId: string;
  positionId: string;
  status: "active" | "terminal" | "censored" | string;
  economicMode: string;
  terminalPnl: number | null;
  actualRealizedPnl: number | null;
}

export interface FleetAnnotationReceipt {
  positionId: string;
  analysisClass: string;
  note: string;
}

export interface CoverageCount {
  covered: number;
  eligible: number;
  pct: number | null;
}

export interface ChannelPassport {
  identity: {
    strategistId: string;
    slug: string;
    name: string;
    familyId: string;
    mode: ChannelMode;
    accountId: string | null;
    accountName: string | null;
    accountMode: string | null;
    underlying: string | null;
    executor: string | null;
    status: string | null;
    active: boolean;
    muted: boolean | null;
  };
  signals: {
    observed: number;
    actedOn: number;
    notActedOn: number;
    blockedWithReason: number;
    notActedWithoutReason: number;
  };
  ledger: {
    positionRows: number;
    rootTrades: number;
    runnerRows: number;
    openRows: number;
    closedRows: number;
    closedRowsWithPnl: number;
    independentEntrySessions: number;
    entryResearchRootTrades: number;
    multiContractRootTrades: number;
    fourPlusContractRootTrades: number;
  };
  outcomeProvenance: {
    nativeRows: number;
    nativeRowsWithPnl: number;
    nativeWinningRows: number;
    nativeLosingRows: number;
    nativeFlatRows: number;
    operatorManagedRows: number;
    annotatedExcludedRows: number;
    executionCorrectionRows: number;
    legacyUnattributedRows: number;
  };
  economics: {
    grossLedgerPnl: number | null;
    nativeOutcomePnl: number | null;
    operatorManagedPnl: number | null;
    annotatedExcludedPnl: number | null;
    executionCorrectionPnl: number | null;
    legacyUnattributedPnl: number | null;
  };
  durableLineage: {
    openedReceiptCoverage: CoverageCount;
    bookedReceiptCoverage: CoverageCount;
    opportunityCoverage: CoverageCount;
    entryDecisionCoverage: CoverageCount;
    entryBrokerResultCoverage: CoverageCount;
    exitBrokerResultCoverage: CoverageCount;
  };
  managerObservation: {
    currentFourPlusEligibleRootTrades: number;
    enrolledPositions: number;
    runRows: number;
    activeRuns: number;
    terminalRuns: number;
    censoredRuns: number;
    completeComparisonRuns: number;
    completeComparisonPositions: number;
  };
  evidenceTier: EvidenceTier;
  nativeOutcomeComparable: boolean;
  managerComparisonObserved: boolean;
  promotionEligible: false;
  blockers: string[];
}

export interface FamilyEvidenceSummary {
  familyId: string;
  channels: number;
  channelsWithTrades: number;
  rootTrades: number;
  closedRows: number;
  nativeRows: number;
  operatorManagedRows: number;
  annotatedExcludedRows: number;
  grossLedgerPnl: number | null;
  nativeOutcomePnl: number | null;
  completeLineageChannels: number;
}

export interface FleetEvidenceAudit {
  schemaVersion: typeof FLEET_EVIDENCE_AUDIT_SCHEMA_VERSION;
  summary: {
    channels: number;
    channelsWithTrades: number;
    channelsWithSignalsOnly: number;
    rootTrades: number;
    closedRows: number;
    nativeRows: number;
    operatorManagedRows: number;
    annotatedExcludedRows: number;
    executionCorrectionRows: number;
    legacyUnattributedRows: number;
    grossLedgerPnl: number | null;
    nativeOutcomePnl: number | null;
    completeLineageChannels: number;
  };
  unmappedEvidence: {
    signals: number;
    positions: number;
    executionRows: number;
    outcomeRows: number;
    managerRuns: number;
  };
  families: FamilyEvidenceSummary[];
  channels: ChannelPassport[];
  promotionEligible: false;
  caveats: string[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round2 = (value: number): number => Math.round(value * 100) / 100;

function coverage(covered: number, eligible: number): CoverageCount {
  return { covered, eligible, pct: eligible === 0 ? null : round2(covered * 100 / eligible) };
}

function etDate(iso: string): string | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function channelMode(slug: string): ChannelMode {
  return /-manual$/i.test(slug) ? "operator_twin" : "automatic";
}

// Reporting label only. It is not an admission, covariance, or risk family.
export function inferResearchFamily(slug: string, underlying: string | null): string {
  const value = slug.toLowerCase();
  const symbol = underlying?.toUpperCase() ?? "";
  if (value.startsWith("pb-")) return "PB";
  if (value.startsWith("momo-")) return "MOMO";
  if (value.startsWith("grind")) return "GRIND";
  if (value.startsWith("vb-")) return "VB";
  if (symbol === "IWM" || /(?:^|-)iwm(?:-|$)/.test(value)) return "IWM";
  if (symbol === "QQQ" || /(?:^|-)qqq(?:-|$)/.test(value)) return "QQQ";
  if (value.startsWith("orb-")) return "ORB-SPY";
  if (value.startsWith("breakout")) return "BREAKOUT-SPY";
  return (value.split("-")[0] || "UNCLASSIFIED").toUpperCase();
}

function outcomeClass(
  position: FleetPositionReceipt,
  mode: ChannelMode,
  annotations: ReadonlyMap<string, FleetAnnotationReceipt>,
): OutcomeClass {
  if (annotations.has(position.id)) return "annotated_exclusion";
  if (mode === "operator_twin" || /^manual(?::|$)/i.test(position.closeReason ?? "")) return "operator_managed";
  if ((position.closeReason ?? "").toLowerCase() === "reconciled") return "execution_correction";
  if (!position.closeReason?.trim()) return "legacy_unattributed";
  return "native";
}

function pnl(rows: readonly FleetPositionReceipt[]): number | null {
  if (rows.some((row) => !finite(row.realizedPnl))) return null;
  return round2(rows.reduce((sum, row) => sum + (row.realizedPnl ?? 0), 0));
}

function addPnl(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : round2(left + right);
}

function tier(input: {
  signals: number;
  positions: number;
  closed: number;
  lineageRows: number;
  bookedCovered: number;
  entryDecisionCovered: number;
  entryBrokerCovered: number;
  exitBrokerCovered: number;
  rootTrades: number;
}): EvidenceTier {
  if (input.positions === 0) return input.signals > 0 ? "signals_only" : "no_observations";
  if (input.lineageRows === 0) return "legacy_ledger_only";
  return input.bookedCovered === input.closed
    && input.entryDecisionCovered === input.rootTrades
    && input.entryBrokerCovered === input.rootTrades
    && input.exitBrokerCovered === input.closed
    ? "durable_lineage_complete"
    : "durable_lineage_partial";
}

export function buildFleetEvidenceAudit(input: {
  channels: readonly FleetChannelReceipt[];
  signals: readonly FleetSignalReceipt[];
  positions: readonly FleetPositionReceipt[];
  executions: readonly FleetExecutionReceipt[];
  outcomes: readonly FleetOutcomeReceipt[];
  managerRuns: readonly FleetManagerReceipt[];
  annotations?: readonly FleetAnnotationReceipt[];
}): FleetEvidenceAudit {
  const channelById = new Map<string, FleetChannelReceipt>();
  for (const channel of input.channels) {
    if (!channel.strategistId || !channel.slug) throw new Error("fleet channel identity is required");
    if (channelById.has(channel.strategistId)) throw new Error(`duplicate strategistId: ${channel.strategistId}`);
    channelById.set(channel.strategistId, channel);
  }
  const annotations = new Map((input.annotations ?? []).map((annotation) => [annotation.positionId, annotation]));
  const positionById = new Map(input.positions.map((position) => [position.id, position]));

  const signalMap = new Map<string, FleetSignalReceipt[]>();
  const positionMap = new Map<string, FleetPositionReceipt[]>();
  const executionMap = new Map<string, FleetExecutionReceipt[]>();
  const managerMap = new Map<string, FleetManagerReceipt[]>();
  for (const row of input.signals) signalMap.set(row.strategistId, [...(signalMap.get(row.strategistId) ?? []), row]);
  for (const row of input.positions) positionMap.set(row.strategistId, [...(positionMap.get(row.strategistId) ?? []), row]);
  for (const row of input.executions) executionMap.set(row.strategistId, [...(executionMap.get(row.strategistId) ?? []), row]);
  for (const row of input.managerRuns) managerMap.set(row.strategistId, [...(managerMap.get(row.strategistId) ?? []), row]);

  const outcomeByPosition = new Map<string, FleetOutcomeReceipt[]>();
  for (const row of input.outcomes) outcomeByPosition.set(row.positionId, [...(outcomeByPosition.get(row.positionId) ?? []), row]);

  const passports: ChannelPassport[] = [];
  for (const channel of input.channels) {
    const mode = channelMode(channel.slug);
    const signals = signalMap.get(channel.strategistId) ?? [];
    const positions = positionMap.get(channel.strategistId) ?? [];
    const executions = executionMap.get(channel.strategistId) ?? [];
    const managers = managerMap.get(channel.strategistId) ?? [];
    const positionIds = new Set(positions.map((position) => position.id));
    const roots = positions.filter((position) => position.runnerOf == null);
    const closed = positions.filter((position) => position.closedAt != null);
    const entryResearchRoots = roots.filter((position) => !annotations.has(position.id));

    const classified = new Map<OutcomeClass, FleetPositionReceipt[]>([
      ["native", []],
      ["operator_managed", []],
      ["annotated_exclusion", []],
      ["execution_correction", []],
      ["legacy_unattributed", []],
    ]);
    for (const position of closed) classified.get(outcomeClass(position, mode, annotations))?.push(position);

    const openedIds = new Set<string>();
    const bookedIds = new Set<string>();
    const opportunityIds = new Set<string>();
    const opportunityIdsByPosition = new Map<string, Set<string>>();
    for (const position of positions) {
      for (const row of outcomeByPosition.get(position.id) ?? []) {
        if (row.eventKind === "position_opened" || row.eventKind === "position_remainder_opened") openedIds.add(position.id);
        if (row.eventKind === "position_booked" || row.eventKind === "reconciliation_estimated") bookedIds.add(position.id);
        if (row.opportunityId) {
          opportunityIds.add(position.id);
          const ids = opportunityIdsByPosition.get(position.id) ?? new Set<string>();
          ids.add(row.opportunityId);
          opportunityIdsByPosition.set(position.id, ids);
        }
      }
    }
    const rootIdsByOpportunity = new Map<string, Set<string>>();
    for (const root of roots) {
      for (const opportunityId of opportunityIdsByPosition.get(root.id) ?? []) {
        const ids = rootIdsByOpportunity.get(opportunityId) ?? new Set<string>();
        ids.add(root.id);
        rootIdsByOpportunity.set(opportunityId, ids);
      }
    }
    const resolvedEntryIds = (row: FleetExecutionReceipt): string[] => {
      if (row.positionId && positionIds.has(row.positionId)) {
        const position = positionById.get(row.positionId);
        return [position?.runnerOf ?? row.positionId];
      }
      return row.opportunityId ? [...(rootIdsByOpportunity.get(row.opportunityId) ?? [])] : [];
    };
    const entryDecisionIds = new Set(executions
      .filter((row) => row.eventKind === "decision" && (row.action === "enter" || row.action === "add"))
      .flatMap(resolvedEntryIds));
    const entryBrokerIds = new Set(executions
      .filter((row) => row.eventKind === "broker_result" && (row.action === "enter" || row.action === "add"))
      .flatMap(resolvedEntryIds));
    const exitBrokerIds = new Set(executions.filter((row) => row.positionId && row.eventKind === "broker_result" && (row.action === "exit" || row.action === "reconcile")).map((row) => row.positionId as string));
    for (const row of executions) if (row.positionId && row.opportunityId) opportunityIds.add(row.positionId);

    const rootIds = new Set(roots.map((position) => position.id));
    const closedIds = new Set(closed.map((position) => position.id));
    const countIn = (set: ReadonlySet<string>, eligible: ReadonlySet<string>): number => [...set].filter((id) => eligible.has(id)).length;
    const openedCovered = countIn(openedIds, positionIds);
    const bookedCovered = countIn(bookedIds, closedIds);
    const opportunityCovered = countIn(opportunityIds, rootIds);
    const entryDecisionCovered = countIn(entryDecisionIds, rootIds);
    const entryBrokerCovered = countIn(entryBrokerIds, rootIds);
    const exitBrokerCovered = countIn(exitBrokerIds, closedIds);
    const lineageRows = positions.reduce((sum, position) => sum + (outcomeByPosition.get(position.id)?.length ?? 0), 0) + executions.length;

    const eligibleManagerRoots = entryResearchRoots.filter((position) => Math.abs(position.quantity ?? 0) >= 4);
    const enrolledPositions = new Set(managers.map((run) => run.positionId));
    const completeManagerRuns = managers.filter((run) => run.status === "terminal" && finite(run.terminalPnl) && finite(run.actualRealizedPnl));
    const completeManagerPositions = new Set(completeManagerRuns.map((run) => run.positionId));

    const native = classified.get("native") ?? [];
    const operatorManaged = classified.get("operator_managed") ?? [];
    const annotatedExcluded = classified.get("annotated_exclusion") ?? [];
    const executionCorrection = classified.get("execution_correction") ?? [];
    const legacyUnattributed = classified.get("legacy_unattributed") ?? [];
    const nativeBooked = native.filter((position) => bookedIds.has(position.id)).length;
    const nativeEntryBroker = native.filter((position) => entryBrokerIds.has(position.runnerOf ?? position.id)).length;
    const evidenceTier = tier({
      signals: signals.length,
      positions: positions.length,
      closed: closed.length,
      lineageRows,
      bookedCovered,
      entryDecisionCovered,
      entryBrokerCovered,
      exitBrokerCovered,
      rootTrades: roots.length,
    });

    const blockers: string[] = [];
    if (positions.length === 0) blockers.push(signals.length > 0 ? "signals observed, but no position path was booked" : "no signal or position evidence in the window");
    if (annotatedExcluded.length > 0) blockers.push(`${annotatedExcluded.length} operator-test/correction row(s) excluded by durable annotation`);
    if (operatorManaged.length > 0) blockers.push(`${operatorManaged.length} operator-managed row(s) kept separate from native outcomes`);
    if (legacyUnattributed.length > 0) blockers.push(`${legacyUnattributed.length} legacy row(s) have no close reason`);
    if (executionCorrection.length > 0) blockers.push(`${executionCorrection.length} reconciled row(s) kept separate from strategy outcomes`);
    if (closed.some((position) => !finite(position.realizedPnl))) blockers.push(`${closed.filter((position) => !finite(position.realizedPnl)).length} closed row(s) lack realized P&L; aggregate P&L is unknown`);
    if (bookedCovered < closed.length) blockers.push(`${closed.length - bookedCovered} closed row(s) lack durable booked-outcome receipts`);
    if (entryDecisionCovered < roots.length) blockers.push(`${roots.length - entryDecisionCovered} root trade(s) lack linked entry-decision evidence`);
    if (entryBrokerCovered < roots.length) blockers.push(`${roots.length - entryBrokerCovered} root trade(s) lack linked entry broker-result evidence`);
    if (exitBrokerCovered < closed.length) blockers.push(`${closed.length - exitBrokerCovered} closed row(s) lack auxiliary exit broker-result evidence`);
    if (mode === "operator_twin") blockers.push("operator-twin evidence is a separate human-management experiment");

    passports.push({
      identity: {
        strategistId: channel.strategistId,
        slug: channel.slug,
        name: channel.name,
        familyId: inferResearchFamily(channel.slug, channel.underlying),
        mode,
        accountId: channel.accountId,
        accountName: channel.accountName,
        accountMode: channel.accountMode,
        underlying: channel.underlying,
        executor: channel.executor,
        status: channel.status,
        active: channel.active,
        muted: channel.muted,
      },
      signals: {
        observed: signals.length,
        actedOn: signals.filter((signal) => signal.actedOn).length,
        notActedOn: signals.filter((signal) => !signal.actedOn).length,
        blockedWithReason: signals.filter((signal) => !signal.actedOn && !!signal.blockedReason).length,
        notActedWithoutReason: signals.filter((signal) => !signal.actedOn && !signal.blockedReason).length,
      },
      ledger: {
        positionRows: positions.length,
        rootTrades: roots.length,
        runnerRows: positions.length - roots.length,
        openRows: positions.length - closed.length,
        closedRows: closed.length,
        closedRowsWithPnl: closed.filter((position) => finite(position.realizedPnl)).length,
        independentEntrySessions: new Set(entryResearchRoots.flatMap((position) => {
          const date = etDate(position.openedAt);
          return date ? [date] : [];
        })).size,
        entryResearchRootTrades: entryResearchRoots.length,
        multiContractRootTrades: entryResearchRoots.filter((position) => Math.abs(position.quantity ?? 0) >= 2).length,
        fourPlusContractRootTrades: eligibleManagerRoots.length,
      },
      outcomeProvenance: {
        nativeRows: native.length,
        nativeRowsWithPnl: native.filter((position) => finite(position.realizedPnl)).length,
        nativeWinningRows: native.filter((position) => finite(position.realizedPnl) && position.realizedPnl > 0).length,
        nativeLosingRows: native.filter((position) => finite(position.realizedPnl) && position.realizedPnl < 0).length,
        nativeFlatRows: native.filter((position) => position.realizedPnl === 0).length,
        operatorManagedRows: operatorManaged.length,
        annotatedExcludedRows: annotatedExcluded.length,
        executionCorrectionRows: executionCorrection.length,
        legacyUnattributedRows: legacyUnattributed.length,
      },
      economics: {
        grossLedgerPnl: pnl(closed),
        nativeOutcomePnl: pnl(native),
        operatorManagedPnl: pnl(operatorManaged),
        annotatedExcludedPnl: pnl(annotatedExcluded),
        executionCorrectionPnl: pnl(executionCorrection),
        legacyUnattributedPnl: pnl(legacyUnattributed),
      },
      durableLineage: {
        openedReceiptCoverage: coverage(openedCovered, positions.length),
        bookedReceiptCoverage: coverage(bookedCovered, closed.length),
        opportunityCoverage: coverage(opportunityCovered, roots.length),
        entryDecisionCoverage: coverage(entryDecisionCovered, roots.length),
        entryBrokerResultCoverage: coverage(entryBrokerCovered, roots.length),
        exitBrokerResultCoverage: coverage(exitBrokerCovered, closed.length),
      },
      managerObservation: {
        currentFourPlusEligibleRootTrades: eligibleManagerRoots.length,
        enrolledPositions: enrolledPositions.size,
        runRows: managers.length,
        activeRuns: managers.filter((run) => run.status === "active").length,
        terminalRuns: managers.filter((run) => run.status === "terminal").length,
        censoredRuns: managers.filter((run) => run.status === "censored").length,
        completeComparisonRuns: completeManagerRuns.length,
        completeComparisonPositions: completeManagerPositions.size,
      },
      evidenceTier,
      nativeOutcomeComparable: native.length > 0
        && native.filter((position) => finite(position.realizedPnl)).length === native.length
        && nativeBooked === native.length
        && nativeEntryBroker === native.length,
      managerComparisonObserved: completeManagerRuns.length > 0,
      promotionEligible: false,
      blockers,
    });
  }

  passports.sort((a, b) => a.identity.familyId.localeCompare(b.identity.familyId) || a.identity.slug.localeCompare(b.identity.slug));
  const familyMap = new Map<string, FamilyEvidenceSummary>();
  for (const passport of passports) {
    const family = familyMap.get(passport.identity.familyId) ?? {
      familyId: passport.identity.familyId,
      channels: 0,
      channelsWithTrades: 0,
      rootTrades: 0,
      closedRows: 0,
      nativeRows: 0,
      operatorManagedRows: 0,
      annotatedExcludedRows: 0,
      grossLedgerPnl: 0,
      nativeOutcomePnl: 0,
      completeLineageChannels: 0,
    };
    family.channels += 1;
    family.channelsWithTrades += passport.ledger.rootTrades > 0 ? 1 : 0;
    family.rootTrades += passport.ledger.rootTrades;
    family.closedRows += passport.ledger.closedRows;
    family.nativeRows += passport.outcomeProvenance.nativeRows;
    family.operatorManagedRows += passport.outcomeProvenance.operatorManagedRows;
    family.annotatedExcludedRows += passport.outcomeProvenance.annotatedExcludedRows;
    family.grossLedgerPnl = addPnl(family.grossLedgerPnl, passport.economics.grossLedgerPnl);
    family.nativeOutcomePnl = addPnl(family.nativeOutcomePnl, passport.economics.nativeOutcomePnl);
    family.completeLineageChannels += passport.evidenceTier === "durable_lineage_complete" ? 1 : 0;
    familyMap.set(passport.identity.familyId, family);
  }

  const summary = passports.reduce((result, passport) => ({
    channels: result.channels + 1,
    channelsWithTrades: result.channelsWithTrades + (passport.ledger.rootTrades > 0 ? 1 : 0),
    channelsWithSignalsOnly: result.channelsWithSignalsOnly + (passport.evidenceTier === "signals_only" ? 1 : 0),
    rootTrades: result.rootTrades + passport.ledger.rootTrades,
    closedRows: result.closedRows + passport.ledger.closedRows,
    nativeRows: result.nativeRows + passport.outcomeProvenance.nativeRows,
    operatorManagedRows: result.operatorManagedRows + passport.outcomeProvenance.operatorManagedRows,
    annotatedExcludedRows: result.annotatedExcludedRows + passport.outcomeProvenance.annotatedExcludedRows,
    executionCorrectionRows: result.executionCorrectionRows + passport.outcomeProvenance.executionCorrectionRows,
    legacyUnattributedRows: result.legacyUnattributedRows + passport.outcomeProvenance.legacyUnattributedRows,
    grossLedgerPnl: addPnl(result.grossLedgerPnl, passport.economics.grossLedgerPnl),
    nativeOutcomePnl: addPnl(result.nativeOutcomePnl, passport.economics.nativeOutcomePnl),
    completeLineageChannels: result.completeLineageChannels + (passport.evidenceTier === "durable_lineage_complete" ? 1 : 0),
  }), {
    channels: 0, channelsWithTrades: 0, channelsWithSignalsOnly: 0, rootTrades: 0, closedRows: 0,
    nativeRows: 0, operatorManagedRows: 0, annotatedExcludedRows: 0, executionCorrectionRows: 0,
    legacyUnattributedRows: 0, grossLedgerPnl: 0, nativeOutcomePnl: 0, completeLineageChannels: 0,
  } as FleetEvidenceAudit["summary"]);

  return {
    schemaVersion: FLEET_EVIDENCE_AUDIT_SCHEMA_VERSION,
    summary,
    unmappedEvidence: {
      signals: input.signals.filter((row) => !channelById.has(row.strategistId)).length,
      positions: input.positions.filter((row) => !channelById.has(row.strategistId)).length,
      executionRows: input.executions.filter((row) => !channelById.has(row.strategistId)).length,
      outcomeRows: input.outcomes.filter((row) => !positionById.has(row.positionId)).length,
      managerRuns: input.managerRuns.filter((row) => !channelById.has(row.strategistId) || !positionById.has(row.positionId)).length,
    },
    families: [...familyMap.values()].sort((a, b) => a.familyId.localeCompare(b.familyId)),
    channels: passports,
    promotionEligible: false,
    caveats: [
      "Reporting families are labels only; they are not covariance, admission, or risk groups.",
      "Gross ledger P&L includes every closed row; native outcome P&L excludes operator-managed, annotated, reconciled, and unattributed rows.",
      "A P&L aggregate is null when any included closed row lacks realized P&L; missing evidence is never converted to zero.",
      "Manual closes remain usable for entry-path research unless a durable annotation excludes the position, but they cannot teach the native exit policy.",
      "Current manager enrollment requires at least four contracts; multi-contract entry coverage separately begins at two and does not impose a four-contract trading rule.",
      "R2 intraminute and full OPRA quote-path coverage are not joined by Phase 1K-A; this audit cannot grade MFE, MAE, slippage, or exit efficiency.",
      "Evidence completeness never implies promotion; every policy or roster change requires explicit operator review.",
    ],
  };
}
