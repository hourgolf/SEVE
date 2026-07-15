// Pure Phase 1K-B option-path model. It owns no client, filesystem, storage,
// broker, order, strategy, or policy dependency. Missing observations censor
// claims; they are never forward-filled or converted to zero.

import type { OutcomeClass } from "./fleetEvidenceAudit.js";

export const TRADE_PATH_AUDIT_SCHEMA_VERSION = 1 as const;

export type OptionPathSource = "supabase_live" | "local_archive" | "forward_data" | "databento_cbbo_1m" | "mixed";

export interface TradePathQuote {
  atMs: number;
  bid: number | null;
  ask: number | null;
  underlyingPrice?: number | null;
  source: OptionPathSource;
}

export interface ExecutionMark {
  atMs: number;
  bid: number | null;
  ask: number | null;
  fillPrice: number | null;
  quoteAgeMs: number | null;
}

export interface IntraminuteReceiptCoverage {
  sourceBarAtMs: number | null;
  receiptCount: number;
  schemaVersions: readonly number[];
  gapCount: number;
  checksumVerified: boolean;
}

export interface TradePathPosition {
  id: string;
  strategistId: string;
  channel: string;
  familyId: string;
  underlying: string;
  occSymbol: string;
  quantity: number | null;
  entryPrice: number | null;
  openedAtMs: number;
  closedAtMs: number | null;
  realizedPnl: number | null;
  closeReason: string | null;
  outcomeClass: OutcomeClass;
  runnerOf: string | null;
  entryDecision: ExecutionMark | null;
  entryFill: ExecutionMark | null;
  exitDecision: ExecutionMark | null;
  exitFill: ExecutionMark | null;
  intraminute: IntraminuteReceiptCoverage | null;
}

export interface TradePathThresholds {
  maxStartLagMs: number;
  maxEndLeadMs: number;
  maxInternalGapMs: number;
  maxExecutionQuoteAgeMs: number;
  targetReturnsPct: readonly number[];
}

export const DEFAULT_TRADE_PATH_THRESHOLDS: TradePathThresholds = {
  // Wide enough for one-minute CBBO while still exposing missing intervals.
  // These are injected evidence thresholds, not execution policy.
  maxStartLagMs: 75_000,
  maxEndLeadMs: 75_000,
  maxInternalGapMs: 75_000,
  maxExecutionQuoteAgeMs: 30_000,
  targetReturnsPct: [10, 15, 20, 25, 30, 50, 100],
};

export type PathCensorCode =
  | "invalid_position"
  | "position_open"
  | "annotated_exclusion"
  | "no_quotes"
  | "no_window_quotes"
  | "no_valid_quotes"
  | "left_censored"
  | "right_censored"
  | "internal_gap"
  | "non_native_exit"
  | "missing_realized_pnl";

export interface TargetTouch {
  targetPct: number;
  firstAtMs: number | null;
  secondsFromOpen: number | null;
  bid: number | null;
}

export interface TradePathResult {
  positionId: string;
  channel: string;
  familyId: string;
  underlying: string;
  occSymbol: string;
  outcomeClass: OutcomeClass;
  quantity: number | null;
  openedAtMs: number;
  closedAtMs: number | null;
  realizedPnl: number | null;
  closeReason: string | null;
  runnerOf: string | null;
  multiContract: boolean;
  fourPlusContracts: boolean;
  entryPathEligible: boolean;
  nativeExitEligible: boolean;
  scalePathEligible: boolean;
  coverage: {
    sources: OptionPathSource[];
    inputRows: number;
    validRows: number;
    invalidRows: number;
    firstAtMs: number | null;
    lastAtMs: number | null;
    startLagSec: number | null;
    endLeadSec: number | null;
    maxInternalGapSec: number | null;
    complete: boolean;
    censorCodes: PathCensorCode[];
  };
  path: {
    entryPrice: number | null;
    actualExitPrice: number | null;
    durationSec: number | null;
    observedMfePct: number | null;
    observedMaePct: number | null;
    peakBid: number | null;
    peakAtMs: number | null;
    secondsToPeak: number | null;
    troughBid: number | null;
    troughAtMs: number | null;
    secondsToTrough: number | null;
    realizedReturnPct: number | null;
    peakGivebackPctPoints: number | null;
    realizedCaptureRatio: number | null;
    targetTouches: TargetTouch[];
  };
  execution: {
    entryDecisionBid: number | null;
    entryDecisionAsk: number | null;
    entryDecisionSpreadPct: number | null;
    entryFillPrice: number | null;
    entryFillVsAsk: number | null;
    entryFillVsAskPct: number | null;
    entryQuoteFresh: boolean;
    exitDecisionBid: number | null;
    exitDecisionAsk: number | null;
    exitDecisionSpreadPct: number | null;
    exitFillPrice: number | null;
    exitFillVsBid: number | null;
    exitFillVsBidPct: number | null;
    exitQuoteFresh: boolean;
  };
  intraminute: IntraminuteReceiptCoverage | null;
  promotionEligible: false;
}

export interface TradePathFamilySummary {
  familyId: string;
  channels: number;
  trades: number;
  completePaths: number;
  nativeClosedWithPnl: number;
  nativeExitComparable: number;
  nativeComparablePnl: number;
  nativeCensored: number;
  nativeCensoredPnl: number;
  multiContractComparable: number;
  intraminuteReceiptCovered: number;
  checksumVerifiedIntraminute: number;
  observedMfePctMedian: number | null;
  observedMaePctMedian: number | null;
  realizedCaptureRatioMedian: number | null;
  secondsToPeakMedian: number | null;
  freshEntrySlippage: number;
  entryFillVsAskPctMedian: number | null;
  freshExitSlippage: number;
  exitFillVsBidPctMedian: number | null;
  actualExitAboveObservedPeak: number;
  targetReach: Array<{ targetPct: number; reached: number; eligible: number }>;
}

export interface TradePathChannelSummary extends Omit<TradePathFamilySummary, "familyId" | "channels"> {
  familyId: string;
  channel: string;
}

export interface TradePathAudit {
  schemaVersion: typeof TRADE_PATH_AUDIT_SCHEMA_VERSION;
  thresholds: TradePathThresholds;
  summary: {
    trades: number;
    completePaths: number;
    nativeClosedWithPnl: number;
    nativeExitComparable: number;
    nativeComparablePnl: number;
    nativeCensored: number;
    nativeCensoredPnl: number;
    multiContractComparable: number;
    annotatedExcluded: number;
    operatorManaged: number;
    missingPaths: number;
    leftCensored: number;
    rightCensored: number;
    internalGapCensored: number;
    intraminuteReceiptCovered: number;
    checksumVerifiedIntraminute: number;
  };
  families: TradePathFamilySummary[];
  channels: TradePathChannelSummary[];
  trades: TradePathResult[];
  promotionEligible: false;
  caveats: string[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round = (value: number, digits = 4): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const pct = (entry: number, price: number): number => round(((price / entry) - 1) * 100);
const sum = (values: readonly number[]): number => round(values.reduce((total, value) => total + value, 0), 2);

function median(values: readonly (number | null)[]): number | null {
  const ordered = values.filter(finite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}

function executionNbboFresh(mark: ExecutionMark | null, maxAgeMs: number): boolean {
  return !!mark && finite(mark.quoteAgeMs) && mark.quoteAgeMs >= 0 && mark.quoteAgeMs <= maxAgeMs
    && finite(mark.bid) && mark.bid > 0 && finite(mark.ask) && mark.ask >= mark.bid;
}

const spreadPct = (bid: number, ask: number): number => round(((ask - bid) / ((ask + bid) / 2)) * 100);

function validQuote(quote: TradePathQuote): quote is TradePathQuote & { bid: number; ask: number } {
  return finite(quote.atMs) && finite(quote.bid) && quote.bid > 0
    && finite(quote.ask) && quote.ask >= quote.bid;
}

function actualExitPrice(position: TradePathPosition): number | null {
  if (!finite(position.entryPrice) || position.entryPrice <= 0
      || !finite(position.quantity) || position.quantity === 0
      || !finite(position.realizedPnl)) return null;
  return round(position.entryPrice + position.realizedPnl / (Math.abs(position.quantity) * 100));
}

export function analyzeTradePath(
  position: TradePathPosition,
  quotes: readonly TradePathQuote[],
  thresholds: TradePathThresholds = DEFAULT_TRADE_PATH_THRESHOLDS,
): TradePathResult {
  const quantity = finite(position.quantity) ? Math.abs(position.quantity) : null;
  const validPosition = !!position.id && !!position.channel && !!position.familyId && !!position.occSymbol
    && finite(position.openedAtMs) && finite(position.entryPrice) && position.entryPrice > 0
    && quantity != null && Number.isInteger(quantity) && quantity > 0;
  const closed = validPosition && finite(position.closedAtMs) && (position.closedAtMs as number) >= position.openedAtMs;
  const eligibleWindowQuotes = quotes.filter((quote) => finite(quote.atMs)
    && quote.atMs >= position.openedAtMs
    && (!closed || quote.atMs <= (position.closedAtMs as number)));
  const path = eligibleWindowQuotes.filter(validQuote).sort((a, b) => a.atMs - b.atMs || a.bid - b.bid || a.ask - b.ask);
  const invalidRows = eligibleWindowQuotes.length - path.length;
  const first = path[0] ?? null;
  const last = path.at(-1) ?? null;
  const startLagMs = first ? Math.max(0, first.atMs - position.openedAtMs) : null;
  const endLeadMs = closed && last ? Math.max(0, (position.closedAtMs as number) - last.atMs) : null;
  let maxGapMs: number | null = path.length ? 0 : null;
  for (let index = 1; index < path.length; index++) maxGapMs = Math.max(maxGapMs ?? 0, path[index].atMs - path[index - 1].atMs);

  const censorCodes: PathCensorCode[] = [];
  if (!validPosition) censorCodes.push("invalid_position");
  if (validPosition && !closed) censorCodes.push("position_open");
  if (position.outcomeClass === "annotated_exclusion") censorCodes.push("annotated_exclusion");
  if (quotes.length === 0) censorCodes.push("no_quotes");
  else if (eligibleWindowQuotes.length === 0) censorCodes.push("no_window_quotes");
  else if (path.length === 0) censorCodes.push("no_valid_quotes");
  if (startLagMs != null && startLagMs > thresholds.maxStartLagMs) censorCodes.push("left_censored");
  if (endLeadMs != null && endLeadMs > thresholds.maxEndLeadMs) censorCodes.push("right_censored");
  if (maxGapMs != null && maxGapMs > thresholds.maxInternalGapMs) censorCodes.push("internal_gap");
  if (position.outcomeClass !== "native") censorCodes.push("non_native_exit");
  if (!finite(position.realizedPnl)) censorCodes.push("missing_realized_pnl");

  const complete = validPosition && closed && path.length > 0
    && startLagMs != null && startLagMs <= thresholds.maxStartLagMs
    && endLeadMs != null && endLeadMs <= thresholds.maxEndLeadMs
    && maxGapMs != null && maxGapMs <= thresholds.maxInternalGapMs;
  const entryPathEligible = validPosition && position.outcomeClass !== "annotated_exclusion" && path.length > 0;
  const nativeExitEligible = entryPathEligible && complete && position.outcomeClass === "native" && finite(position.realizedPnl);
  const scalePathEligible = nativeExitEligible && quantity != null && quantity >= 2;

  let peak = first, trough = first;
  for (const quote of path) {
    if (!peak || quote.bid > peak.bid || (quote.bid === peak.bid && quote.atMs < peak.atMs)) peak = quote;
    if (!trough || quote.bid < trough.bid || (quote.bid === trough.bid && quote.atMs < trough.atMs)) trough = quote;
  }
  const exitPrice = closed ? actualExitPrice(position) : null;
  const realizedReturnPct = nativeExitEligible && exitPrice != null && position.entryPrice != null
    ? pct(position.entryPrice, exitPrice) : null;
  const observedMfePct = entryPathEligible && peak && position.entryPrice != null ? pct(position.entryPrice, peak.bid) : null;
  const observedMaePct = entryPathEligible && trough && position.entryPrice != null ? pct(position.entryPrice, trough.bid) : null;
  const peakGivebackPctPoints = nativeExitEligible && observedMfePct != null && realizedReturnPct != null
    ? round(observedMfePct - realizedReturnPct) : null;
  const realizedCaptureRatio = nativeExitEligible && observedMfePct != null && observedMfePct > 0 && realizedReturnPct != null
    ? round(realizedReturnPct / observedMfePct) : null;
  const targetTouches = thresholds.targetReturnsPct.map((targetPct) => {
    const hit = position.entryPrice != null
      ? path.find((quote) => pct(position.entryPrice as number, quote.bid) + 1e-9 >= targetPct) ?? null
      : null;
    return {
      targetPct,
      firstAtMs: hit?.atMs ?? null,
      secondsFromOpen: hit ? round((hit.atMs - position.openedAtMs) / 1_000, 3) : null,
      bid: hit?.bid ?? null,
    };
  });

  const entryNbboFresh = executionNbboFresh(position.entryDecision, thresholds.maxExecutionQuoteAgeMs);
  const entryDecisionBid = entryNbboFresh ? position.entryDecision?.bid as number : null;
  const entryDecisionAsk = entryNbboFresh ? position.entryDecision?.ask as number : null;
  const entryFillPrice = finite(position.entryFill?.fillPrice) && (position.entryFill?.fillPrice as number) > 0
    ? position.entryFill?.fillPrice as number
    : finite(position.entryPrice) ? position.entryPrice : null;
  const exitNbboFresh = executionNbboFresh(position.exitDecision, thresholds.maxExecutionQuoteAgeMs);
  const exitDecisionBid = exitNbboFresh ? position.exitDecision?.bid as number : null;
  const exitDecisionAsk = exitNbboFresh ? position.exitDecision?.ask as number : null;
  const exitFillPrice = finite(position.exitFill?.fillPrice) && (position.exitFill?.fillPrice as number) >= 0
    ? position.exitFill?.fillPrice as number : exitPrice;

  return {
    positionId: position.id,
    channel: position.channel,
    familyId: position.familyId,
    underlying: position.underlying,
    occSymbol: position.occSymbol,
    outcomeClass: position.outcomeClass,
    quantity,
    openedAtMs: position.openedAtMs,
    closedAtMs: closed ? position.closedAtMs : null,
    realizedPnl: finite(position.realizedPnl) ? position.realizedPnl : null,
    closeReason: position.closeReason,
    runnerOf: position.runnerOf,
    multiContract: quantity != null && quantity >= 2,
    fourPlusContracts: quantity != null && quantity >= 4,
    entryPathEligible,
    nativeExitEligible,
    scalePathEligible,
    coverage: {
      sources: [...new Set(path.map((quote) => quote.source))].sort(),
      inputRows: eligibleWindowQuotes.length,
      validRows: path.length,
      invalidRows,
      firstAtMs: first?.atMs ?? null,
      lastAtMs: last?.atMs ?? null,
      startLagSec: startLagMs == null ? null : round(startLagMs / 1_000, 3),
      endLeadSec: endLeadMs == null ? null : round(endLeadMs / 1_000, 3),
      maxInternalGapSec: maxGapMs == null ? null : round(maxGapMs / 1_000, 3),
      complete,
      censorCodes: [...new Set(censorCodes)],
    },
    path: {
      entryPrice: finite(position.entryPrice) ? position.entryPrice : null,
      actualExitPrice: exitPrice,
      durationSec: closed ? round(((position.closedAtMs as number) - position.openedAtMs) / 1_000, 3) : null,
      observedMfePct,
      observedMaePct,
      peakBid: entryPathEligible && peak ? peak.bid : null,
      peakAtMs: entryPathEligible && peak ? peak.atMs : null,
      secondsToPeak: entryPathEligible && peak ? round((peak.atMs - position.openedAtMs) / 1_000, 3) : null,
      troughBid: entryPathEligible && trough ? trough.bid : null,
      troughAtMs: entryPathEligible && trough ? trough.atMs : null,
      secondsToTrough: entryPathEligible && trough ? round((trough.atMs - position.openedAtMs) / 1_000, 3) : null,
      realizedReturnPct,
      peakGivebackPctPoints,
      realizedCaptureRatio,
      targetTouches,
    },
    execution: {
      entryDecisionBid,
      entryDecisionAsk,
      entryDecisionSpreadPct: entryDecisionBid != null && entryDecisionAsk != null ? spreadPct(entryDecisionBid, entryDecisionAsk) : null,
      entryFillPrice,
      entryFillVsAsk: entryDecisionAsk != null && entryFillPrice != null ? round(entryFillPrice - entryDecisionAsk) : null,
      entryFillVsAskPct: entryDecisionAsk != null && entryFillPrice != null ? round(((entryFillPrice / entryDecisionAsk) - 1) * 100) : null,
      entryQuoteFresh: entryDecisionAsk != null,
      exitDecisionBid,
      exitDecisionAsk,
      exitDecisionSpreadPct: exitDecisionBid != null && exitDecisionAsk != null ? spreadPct(exitDecisionBid, exitDecisionAsk) : null,
      exitFillPrice,
      exitFillVsBid: exitDecisionBid != null && exitFillPrice != null ? round(exitFillPrice - exitDecisionBid) : null,
      exitFillVsBidPct: exitDecisionBid != null && exitFillPrice != null ? round(((exitFillPrice / exitDecisionBid) - 1) * 100) : null,
      exitQuoteFresh: exitDecisionBid != null,
    },
    intraminute: position.intraminute,
    promotionEligible: false,
  };
}

export function buildTradePathAudit(input: {
  positions: readonly TradePathPosition[];
  quotesByOcc: ReadonlyMap<string, readonly TradePathQuote[]>;
  thresholds?: TradePathThresholds;
}): TradePathAudit {
  const thresholds = input.thresholds ?? DEFAULT_TRADE_PATH_THRESHOLDS;
  const trades = input.positions.map((position) => analyzeTradePath(
    position,
    input.quotesByOcc.get(position.occSymbol) ?? [],
    thresholds,
  )).sort((a, b) => a.familyId.localeCompare(b.familyId) || a.channel.localeCompare(b.channel) || a.positionId.localeCompare(b.positionId));

  const summarize = (rows: readonly TradePathResult[]): Omit<TradePathFamilySummary, "familyId" | "channels"> => {
    const comparable = rows.filter((trade) => trade.nativeExitEligible);
    const nativeClosed = rows.filter((trade) => trade.outcomeClass === "native" && trade.closedAtMs != null && trade.realizedPnl != null);
    const censoredNative = nativeClosed.filter((trade) => !trade.nativeExitEligible);
    return {
      trades: rows.length,
      completePaths: rows.filter((trade) => trade.coverage.complete).length,
      nativeClosedWithPnl: nativeClosed.length,
      nativeExitComparable: comparable.length,
      nativeComparablePnl: sum(comparable.flatMap((trade) => trade.realizedPnl == null ? [] : [trade.realizedPnl])),
      nativeCensored: censoredNative.length,
      nativeCensoredPnl: sum(censoredNative.flatMap((trade) => trade.realizedPnl == null ? [] : [trade.realizedPnl])),
      multiContractComparable: rows.filter((trade) => trade.scalePathEligible).length,
      intraminuteReceiptCovered: rows.filter((trade) => (trade.intraminute?.receiptCount ?? 0) > 0).length,
      checksumVerifiedIntraminute: rows.filter((trade) => trade.intraminute?.checksumVerified === true).length,
      observedMfePctMedian: median(comparable.map((trade) => trade.path.observedMfePct)),
      observedMaePctMedian: median(comparable.map((trade) => trade.path.observedMaePct)),
      realizedCaptureRatioMedian: median(comparable.map((trade) => trade.path.realizedCaptureRatio)),
      secondsToPeakMedian: median(comparable.map((trade) => trade.path.secondsToPeak)),
      freshEntrySlippage: rows.filter((trade) => trade.execution.entryQuoteFresh && trade.execution.entryFillVsAskPct != null).length,
      entryFillVsAskPctMedian: median(rows.map((trade) => trade.execution.entryFillVsAskPct)),
      freshExitSlippage: comparable.filter((trade) => trade.execution.exitQuoteFresh && trade.execution.exitFillVsBidPct != null).length,
      exitFillVsBidPctMedian: median(comparable.map((trade) => trade.execution.exitFillVsBidPct)),
      actualExitAboveObservedPeak: comparable.filter((trade) => trade.path.realizedCaptureRatio != null && trade.path.realizedCaptureRatio > 1).length,
      targetReach: thresholds.targetReturnsPct.map((targetPct) => ({
        targetPct,
        reached: comparable.filter((trade) => trade.path.targetTouches.some((target) => target.targetPct === targetPct && target.firstAtMs != null)).length,
        eligible: comparable.length,
      })),
    };
  };

  const familyIds = [...new Set(trades.map((trade) => trade.familyId))].sort();
  const families = familyIds.map((familyId): TradePathFamilySummary => {
    const rows = trades.filter((trade) => trade.familyId === familyId);
    return {
      familyId,
      channels: new Set(rows.map((trade) => trade.channel)).size,
      ...summarize(rows),
    };
  });
  const channels: TradePathChannelSummary[] = [...new Set(trades.map((trade) => `${trade.familyId}\u0000${trade.channel}`))]
    .sort()
    .map((key) => {
      const [familyId, channel] = key.split("\u0000");
      return { familyId, channel, ...summarize(trades.filter((trade) => trade.familyId === familyId && trade.channel === channel)) };
    });

  return {
    schemaVersion: TRADE_PATH_AUDIT_SCHEMA_VERSION,
    thresholds,
    summary: {
      trades: trades.length,
      completePaths: trades.filter((trade) => trade.coverage.complete).length,
      nativeClosedWithPnl: trades.filter((trade) => trade.outcomeClass === "native" && trade.closedAtMs != null && trade.realizedPnl != null).length,
      nativeExitComparable: trades.filter((trade) => trade.nativeExitEligible).length,
      nativeComparablePnl: sum(trades.filter((trade) => trade.nativeExitEligible).flatMap((trade) => trade.realizedPnl == null ? [] : [trade.realizedPnl])),
      nativeCensored: trades.filter((trade) => trade.outcomeClass === "native" && trade.closedAtMs != null && trade.realizedPnl != null && !trade.nativeExitEligible).length,
      nativeCensoredPnl: sum(trades.filter((trade) => trade.outcomeClass === "native" && trade.closedAtMs != null && trade.realizedPnl != null && !trade.nativeExitEligible).flatMap((trade) => trade.realizedPnl == null ? [] : [trade.realizedPnl])),
      multiContractComparable: trades.filter((trade) => trade.scalePathEligible).length,
      annotatedExcluded: trades.filter((trade) => trade.outcomeClass === "annotated_exclusion").length,
      operatorManaged: trades.filter((trade) => trade.outcomeClass === "operator_managed").length,
      missingPaths: trades.filter((trade) => trade.coverage.censorCodes.includes("no_quotes")
        || trade.coverage.censorCodes.includes("no_window_quotes")
        || trade.coverage.censorCodes.includes("no_valid_quotes")).length,
      leftCensored: trades.filter((trade) => trade.coverage.censorCodes.includes("left_censored")).length,
      rightCensored: trades.filter((trade) => trade.coverage.censorCodes.includes("right_censored")).length,
      internalGapCensored: trades.filter((trade) => trade.coverage.censorCodes.includes("internal_gap")).length,
      intraminuteReceiptCovered: trades.filter((trade) => (trade.intraminute?.receiptCount ?? 0) > 0).length,
      checksumVerifiedIntraminute: trades.filter((trade) => trade.intraminute?.checksumVerified === true).length,
    },
    families,
    channels,
    trades,
    promotionEligible: false,
    caveats: [
      "Executable option MFE and MAE use observed bids only. An unobserved move is not imputed.",
      "Observed MFE is a lower bound. An actual fill above the highest captured bid can produce a capture ratio above one and is reported rather than clipped.",
      "Path completeness is an evidence label governed by injected thresholds; it is not an execution setting.",
      "Censored native P&L is reported beside comparable P&L because short-lived trades can close between snapshots; dropping them silently would create outcome-linked selection bias.",
      "Local option archives, Supabase compact receipts, R2 SIP objects, and Databento CBBO are distinct sources and are never silently pooled.",
      "R2 intraminute receipt coverage proves an underlying capture receipt overlaps the entry source minute; checksumVerified is true only when raw objects were independently downloaded and verified.",
      "Manual closes may teach entry-path behavior, but only native, fully covered outcomes teach native exit capture.",
      "Execution slippage is reported only when the decision mark has a fresh, positive, non-crossed NBBO. Wide spreads remain visible and must be considered before interpreting fill-versus-bid/ask percentages.",
      "A quantity of two or more is scale-capable; four-plus is reported separately and is never a fleet minimum.",
      "No family or channel becomes promotion-eligible from this audit.",
    ],
  };
}
