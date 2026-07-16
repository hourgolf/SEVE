// Pure integrity audit for a frozen trade-path receipt. It distinguishes
// blocking ledger defects from truthful research censoring and OCC stacking.

import type { TradePathResult } from "./tradePathAnalysis.js";

export interface OccStackSummary {
  occSymbol: string;
  maximumConcurrentPositions: number;
  maximumConcurrentContracts: number;
  channels: string[];
  positionIds: string[];
}

export interface SameClockSummary {
  clockKey: string;
  sourceBarAtMs: number;
  underlying: string;
  optionSide: "call" | "put";
  positions: number;
  contracts: number;
  channels: string[];
  families: string[];
}

export interface HeldLedgerIntegrityReport {
  positions: number;
  uniquePositionIds: number;
  duplicatePositionIds: string[];
  duplicateTradeKeys: string[];
  unresolvedPositions: string[];
  invalidQuantityPositions: string[];
  invalidTimelinePositions: string[];
  invalidOccPositions: string[];
  unexpectedPromotionEligible: string[];
  nativeWithManualReason: string[];
  operatorWithoutManualReason: string[];
  runnerMissingParent: string[];
  outcomeClasses: Array<{ outcomeClass: string; positions: number; realizedPnl: number }>;
  operatorReasons: Array<{ reason: string; positions: number; realizedPnl: number }>;
  censoredNativePaths: Array<{ positionId: string; channel: string; realizedPnl: number; censorCodes: string[] }>;
  occStacks: OccStackSummary[];
  sameClockGroups: SameClockSummary[];
  maximumConcurrentPositionsOnOneOcc: number;
  maximumConcurrentContractsOnOneOcc: number;
  blockingIssues: string[];
  readyForExactBackfill: boolean;
  policyChangeAuthorized: false;
  productionChangeAuthorized: false;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: number): number => Math.round(value * 100) / 100;

function optionSide(trade: TradePathResult): "call" | "put" | null {
  const marker = trade.occSymbol.slice(trade.underlying.length + 6, trade.underlying.length + 7);
  return marker === "C" ? "call" : marker === "P" ? "put" : null;
}

function summarizeOccStack(occSymbol: string, trades: readonly TradePathResult[]): OccStackSummary {
  const events = trades.flatMap((trade) => [
    { atMs: trade.openedAtMs, kind: "open" as const, trade },
    { atMs: trade.closedAtMs as number, kind: "close" as const, trade },
  ]).sort((a, b) => a.atMs - b.atMs || (a.kind === "close" ? -1 : 1));
  const active = new Map<string, TradePathResult>();
  let maximumConcurrentPositions = 0;
  let maximumConcurrentContracts = 0;
  for (const event of events) {
    if (event.kind === "close") active.delete(event.trade.positionId);
    else active.set(event.trade.positionId, event.trade);
    maximumConcurrentPositions = Math.max(maximumConcurrentPositions, active.size);
    maximumConcurrentContracts = Math.max(maximumConcurrentContracts, [...active.values()].reduce((sum, trade) => sum + Math.abs(trade.quantity ?? 0), 0));
  }
  return {
    occSymbol,
    maximumConcurrentPositions,
    maximumConcurrentContracts,
    channels: [...new Set(trades.map((trade) => trade.channel))].sort(),
    positionIds: trades.map((trade) => trade.positionId).sort(),
  };
}

export function auditHeldLedger(trades: readonly TradePathResult[]): HeldLedgerIntegrityReport {
  const idCounts = new Map<string, number>();
  const keyCounts = new Map<string, number>();
  for (const trade of trades) {
    idCounts.set(trade.positionId, (idCounts.get(trade.positionId) ?? 0) + 1);
    const key = `${trade.channel}|${trade.occSymbol}|${trade.openedAtMs}|${trade.closedAtMs}|${trade.quantity}`;
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const duplicatePositionIds = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id).sort();
  const duplicateTradeKeys = [...keyCounts].filter(([, count]) => count > 1).map(([key]) => key).sort();
  const unresolvedPositions = trades.filter((trade) => !finite(trade.closedAtMs) || !finite(trade.realizedPnl)).map((trade) => trade.positionId).sort();
  const invalidQuantityPositions = trades.filter((trade) => !Number.isInteger(trade.quantity) || (trade.quantity ?? 0) <= 0).map((trade) => trade.positionId).sort();
  const invalidTimelinePositions = trades.filter((trade) => !finite(trade.openedAtMs) || !finite(trade.closedAtMs) || (trade.closedAtMs as number) < trade.openedAtMs).map((trade) => trade.positionId).sort();
  const invalidOccPositions = trades.filter((trade) => !trade.occSymbol.startsWith(trade.underlying) || !optionSide(trade)).map((trade) => trade.positionId).sort();
  const unexpectedPromotionEligible = trades.filter((trade) => trade.promotionEligible !== false).map((trade) => trade.positionId).sort();
  const nativeWithManualReason = trades.filter((trade) => trade.outcomeClass === "native" && trade.closeReason?.startsWith("manual:")).map((trade) => trade.positionId).sort();
  const operatorWithoutManualReason = trades.filter((trade) => trade.outcomeClass === "operator_managed" && !trade.closeReason?.startsWith("manual:")).map((trade) => trade.positionId).sort();
  const ids = new Set(trades.map((trade) => trade.positionId));
  const runnerMissingParent = trades.filter((trade) => trade.runnerOf && !ids.has(trade.runnerOf)).map((trade) => trade.positionId).sort();

  const outcomeClasses = [...new Set(trades.map((trade) => trade.outcomeClass))].sort().map((outcomeClass) => {
    const rows = trades.filter((trade) => trade.outcomeClass === outcomeClass);
    return { outcomeClass, positions: rows.length, realizedPnl: money(rows.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)) };
  });
  const operator = trades.filter((trade) => trade.outcomeClass === "operator_managed");
  const operatorReasons = [...new Set(operator.map((trade) => trade.closeReason ?? "missing"))].sort().map((reason) => {
    const rows = operator.filter((trade) => (trade.closeReason ?? "missing") === reason);
    return { reason, positions: rows.length, realizedPnl: money(rows.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)) };
  });
  const censoredNativePaths = trades.filter((trade) => trade.outcomeClass === "native" && !trade.nativeExitEligible).map((trade) => ({
    positionId: trade.positionId,
    channel: trade.channel,
    realizedPnl: trade.realizedPnl ?? 0,
    censorCodes: [...trade.coverage.censorCodes],
  })).sort((a, b) => a.channel.localeCompare(b.channel) || a.positionId.localeCompare(b.positionId));

  const byOcc = new Map<string, TradePathResult[]>();
  for (const trade of trades.filter((row) => finite(row.closedAtMs))) byOcc.set(trade.occSymbol, [...(byOcc.get(trade.occSymbol) ?? []), trade]);
  const occStacks = [...byOcc].map(([occ, rows]) => summarizeOccStack(occ, rows)).filter((row) => row.maximumConcurrentPositions > 1)
    .sort((a, b) => b.maximumConcurrentContracts - a.maximumConcurrentContracts || b.maximumConcurrentPositions - a.maximumConcurrentPositions || a.occSymbol.localeCompare(b.occSymbol));

  const clockGroups = new Map<string, TradePathResult[]>();
  for (const trade of trades) {
    const side = optionSide(trade);
    if (!finite(trade.sourceBarAtMs) || !side) continue;
    const key = `${trade.sourceBarAtMs}|${trade.underlying}|${side}`;
    clockGroups.set(key, [...(clockGroups.get(key) ?? []), trade]);
  }
  const sameClockGroups = [...clockGroups].filter(([, rows]) => new Set(rows.map((row) => row.channel)).size > 1).map(([clockKey, rows]) => ({
    clockKey,
    sourceBarAtMs: rows[0].sourceBarAtMs as number,
    underlying: rows[0].underlying,
    optionSide: optionSide(rows[0]) as "call" | "put",
    positions: rows.length,
    contracts: rows.reduce((sum, row) => sum + Math.abs(row.quantity ?? 0), 0),
    channels: [...new Set(rows.map((row) => row.channel))].sort(),
    families: [...new Set(rows.map((row) => row.familyId))].sort(),
  })).sort((a, b) => a.sourceBarAtMs - b.sourceBarAtMs || a.clockKey.localeCompare(b.clockKey));

  const blockingIssues: string[] = [];
  if (duplicatePositionIds.length) blockingIssues.push(`${duplicatePositionIds.length} duplicate position ids`);
  if (duplicateTradeKeys.length) blockingIssues.push(`${duplicateTradeKeys.length} duplicate logical trade keys`);
  if (unresolvedPositions.length) blockingIssues.push(`${unresolvedPositions.length} unresolved positions`);
  if (invalidQuantityPositions.length) blockingIssues.push(`${invalidQuantityPositions.length} invalid quantities`);
  if (invalidTimelinePositions.length) blockingIssues.push(`${invalidTimelinePositions.length} invalid timelines`);
  if (invalidOccPositions.length) blockingIssues.push(`${invalidOccPositions.length} invalid OCC/underlying identities`);
  if (unexpectedPromotionEligible.length) blockingIssues.push(`${unexpectedPromotionEligible.length} rows unexpectedly authorize promotion`);
  if (nativeWithManualReason.length) blockingIssues.push(`${nativeWithManualReason.length} native rows carry manual close reasons`);
  if (operatorWithoutManualReason.length) blockingIssues.push(`${operatorWithoutManualReason.length} operator rows lack manual reasons`);
  if (runnerMissingParent.length) blockingIssues.push(`${runnerMissingParent.length} runner rows lack a parent`);

  return {
    positions: trades.length,
    uniquePositionIds: idCounts.size,
    duplicatePositionIds,
    duplicateTradeKeys,
    unresolvedPositions,
    invalidQuantityPositions,
    invalidTimelinePositions,
    invalidOccPositions,
    unexpectedPromotionEligible,
    nativeWithManualReason,
    operatorWithoutManualReason,
    runnerMissingParent,
    outcomeClasses,
    operatorReasons,
    censoredNativePaths,
    occStacks,
    sameClockGroups,
    maximumConcurrentPositionsOnOneOcc: Math.max(0, ...occStacks.map((row) => row.maximumConcurrentPositions)),
    maximumConcurrentContractsOnOneOcc: Math.max(0, ...occStacks.map((row) => row.maximumConcurrentContracts)),
    blockingIssues,
    readyForExactBackfill: blockingIssues.length === 0,
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
  };
}
