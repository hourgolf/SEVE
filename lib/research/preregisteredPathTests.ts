// Pure Phase 1K-C development/holdout contract. The July 13–14 cohort generated
// these hypotheses; it may illustrate them but cannot validate them. Specs are
// frozen for the prospective holdout beginning July 15.

import { replayScaleBeforeNativeClose, type RunnerMode } from "../../worker/src/sessionExitReplayModel.js";
import type { TradePathQuote, TradePathResult } from "./tradePathAnalysis.js";

export const PREREGISTERED_PATH_TEST_VERSION = "phase1k-c-preregister-v1" as const;
export const DEVELOPMENT_THROUGH_ET = "2026-07-14" as const;
export const PROSPECTIVE_HOLDOUT_FROM_ET = "2026-07-15" as const;

export interface ScalePolicySpec {
  id: string;
  familyId: "MOMO" | "VB";
  channel: string | null;
  targetPct: 15 | 20;
  runnerMode: RunnerMode;
  changesPreBankStop: false;
}

export const PREREGISTERED_SCALE_POLICIES: readonly ScalePolicySpec[] = [
  { id: "MOMO-BANK15/RUN-NATIVE", familyId: "MOMO", channel: null, targetPct: 15, runnerMode: "native", changesPreBankStop: false },
  { id: "MOMO-BANK15/HALF-GIVEBACK", familyId: "MOMO", channel: null, targetPct: 15, runnerMode: "half_giveback", changesPreBankStop: false },
  { id: "MOMO-BANK20/HALF-GIVEBACK", familyId: "MOMO", channel: null, targetPct: 20, runnerMode: "half_giveback", changesPreBankStop: false },
  { id: "VB-RIBBON-BANK15/RUN-NATIVE", familyId: "VB", channel: "vb-ribbon-cross", targetPct: 15, runnerMode: "native", changesPreBankStop: false },
  { id: "VB-RIBBON-BANK15/HALF-GIVEBACK", familyId: "VB", channel: "vb-ribbon-cross", targetPct: 15, runnerMode: "half_giveback", changesPreBankStop: false },
] as const;

export const ADMISSION_DIAGNOSTIC_FAMILIES = ["BREAKOUT-SPY", "GRIND", "IWM", "ORB-SPY", "QQQ"] as const;

export interface ScalePolicyResult {
  spec: ScalePolicySpec;
  cohort: "development" | "prospective_holdout";
  eligible: number;
  triggered: number;
  nativePnl: number;
  modeledPnl: number;
  deltaVsNative: number;
  positiveDelta: number;
  negativeDelta: number;
  unchanged: number;
  byChannel: ScalePolicyChannelResult[];
  policyChangeAuthorized: false;
}

export interface ScalePolicyChannelResult {
  channel: string;
  eligible: number;
  triggered: number;
  nativePnl: number;
  modeledPnl: number;
  deltaVsNative: number;
  positiveDelta: number;
  negativeDelta: number;
  unchanged: number;
}

export interface MatchedClockGroup {
  key: string;
  sourceBarAtMs: number;
  underlying: string;
  optionSide: "call" | "put";
  channels: string[];
  families: string[];
  positions: number;
  entryPremiumCapital: number;
}

export interface MatchedChannelPair {
  channelA: string;
  channelB: string;
  matchedClocks: number;
  channelAMfeWins: number;
  channelBMfeWins: number;
  tiedMfe: number;
  channelARealizedWins: number;
  channelBRealizedWins: number;
  tiedRealized: number;
  medianMfeDeltaBMinusA: number | null;
  medianRealizedPnlDeltaBMinusA: number | null;
}

export interface AdmissionDiagnostic {
  familyId: string;
  channel: string;
  eligible: number;
  observedMfeNonPositive: number;
  reached10Pct: number;
  reached15Pct: number;
  observedMaeAtOrBelowMinus30: number;
  realizedPnl: number;
  exitOptimizationAuthorized: false;
}

export interface PreregisteredPathReport {
  version: typeof PREREGISTERED_PATH_TEST_VERSION;
  developmentThroughEt: typeof DEVELOPMENT_THROUGH_ET;
  prospectiveHoldoutFromEt: typeof PROSPECTIVE_HOLDOUT_FROM_ET;
  cohort: "development" | "prospective_holdout";
  exactPathEligible: number;
  scalePolicies: ScalePolicyResult[];
  matchedClockGroups: MatchedClockGroup[];
  matchedChannelPairs: MatchedChannelPair[];
  admissionDiagnostics: AdmissionDiagnostic[];
  sharedDurableOpportunityIds: number;
  policyChangeAuthorized: false;
  caveats: string[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const money = (value: number): number => Math.round(value * 100) / 100;
const round = (value: number, digits = 4): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}

export function optionSideForTrade(trade: TradePathResult): "call" | "put" | null {
  const suffix = trade.occSymbol.slice(trade.underlying.length);
  const cp = suffix.slice(6, 7);
  return cp === "C" ? "call" : cp === "P" ? "put" : null;
}

export function isExactDatabentoPathEligible(trade: TradePathResult): boolean {
  return trade.nativeExitEligible
    && trade.coverage.sources.length === 1
    && trade.coverage.sources[0] === "databento_cbbo_1s"
    && trade.coverage.startLagSec != null && trade.coverage.startLagSec <= 1.1
    && trade.coverage.endLeadSec != null && trade.coverage.endLeadSec <= 1.1
    && trade.coverage.maxInternalGapSec != null && trade.coverage.maxInternalGapSec <= 5;
}

function cohortFor(trades: readonly TradePathResult[]): "development" | "prospective_holdout" {
  const dates = trades.map((trade) => ET_DATE.format(new Date(trade.openedAtMs)));
  const hasDevelopment = dates.some((date) => date <= DEVELOPMENT_THROUGH_ET);
  const hasHoldout = dates.some((date) => date >= PROSPECTIVE_HOLDOUT_FROM_ET);
  if (hasDevelopment && hasHoldout) throw new Error("development and prospective holdout trades cannot be pooled");
  return hasHoldout ? "prospective_holdout" : "development";
}

export function buildPreregisteredPathReport(input: {
  trades: readonly TradePathResult[];
  quotesByOcc: ReadonlyMap<string, readonly TradePathQuote[]>;
}): PreregisteredPathReport {
  const exact = input.trades.filter(isExactDatabentoPathEligible);
  const cohort = cohortFor(exact);
  const scalePolicies = PREREGISTERED_SCALE_POLICIES.map((spec): ScalePolicyResult => {
    const eligible = exact.filter((trade) => trade.familyId === spec.familyId
      && (spec.channel == null || trade.channel === spec.channel)
      && trade.scalePathEligible && trade.quantity != null && trade.quantity >= 2
      && trade.path.entryPrice != null && trade.path.actualExitPrice != null
      && trade.closedAtMs != null && trade.realizedPnl != null);
    const rows = eligible.map((trade) => ({
      channel: trade.channel,
      result: replayScaleBeforeNativeClose({
        id: trade.positionId,
        channel: trade.channel,
        quantity: trade.quantity as number,
        entryPrice: trade.path.entryPrice as number,
        openedAtMs: trade.openedAtMs,
        nativeClosedAtMs: trade.closedAtMs as number,
        nativeExitPrice: trade.path.actualExitPrice as number,
        nativePnl: trade.realizedPnl as number,
      }, (input.quotesByOcc.get(trade.occSymbol) ?? []).flatMap((quote) => finite(quote.bid) && quote.bid > 0
        ? [{ atMs: quote.atMs, bid: quote.bid }] : []), spec.targetPct, spec.runnerMode),
    }));
    const summarizeScale = (group: typeof rows): Omit<ScalePolicyChannelResult, "channel"> => {
      const nativePnl = money(group.reduce((sum, row) => sum + (row.result.modeledPnl - row.result.deltaVsNative), 0));
      const modeledPnl = money(group.reduce((sum, row) => sum + row.result.modeledPnl, 0));
      return {
        eligible: group.length,
        triggered: group.filter((row) => row.result.triggered).length,
        nativePnl,
        modeledPnl,
        deltaVsNative: money(modeledPnl - nativePnl),
        positiveDelta: group.filter((row) => row.result.deltaVsNative > 0).length,
        negativeDelta: group.filter((row) => row.result.deltaVsNative < 0).length,
        unchanged: group.filter((row) => row.result.deltaVsNative === 0).length,
      };
    };
    const aggregate = summarizeScale(rows);
    const byChannel = [...new Set(rows.map((row) => row.channel))].sort().map((channel) => ({
      channel,
      ...summarizeScale(rows.filter((row) => row.channel === channel)),
    }));
    return {
      spec,
      cohort,
      ...aggregate,
      byChannel,
      policyChangeAuthorized: false,
    };
  });

  const clockGroups = new Map<string, TradePathResult[]>();
  for (const trade of exact) {
    const side = optionSideForTrade(trade);
    if (trade.sourceBarAtMs == null || !side) continue;
    const key = `${trade.underlying}|${side}|${trade.sourceBarAtMs}`;
    clockGroups.set(key, [...(clockGroups.get(key) ?? []), trade]);
  }
  const matchedEntries = [...clockGroups.entries()].filter(([, rows]) => new Set(rows.map((row) => row.channel)).size >= 2);
  const matchedClockGroups: MatchedClockGroup[] = matchedEntries.map(([key, rows]) => ({
    key,
    sourceBarAtMs: rows[0].sourceBarAtMs as number,
    underlying: rows[0].underlying,
    optionSide: optionSideForTrade(rows[0]) as "call" | "put",
    channels: [...new Set(rows.map((row) => row.channel))].sort(),
    families: [...new Set(rows.map((row) => row.familyId))].sort(),
    positions: rows.length,
    entryPremiumCapital: money(rows.reduce((sum, row) => sum + (row.path.entryPrice ?? 0) * (row.quantity ?? 0) * 100, 0)),
  })).sort((a, b) => a.sourceBarAtMs - b.sourceBarAtMs || a.key.localeCompare(b.key));

  const pairs = new Map<string, Array<{ a: TradePathResult; b: TradePathResult }>>();
  for (const [, rows] of matchedEntries) {
    const onePerChannel = new Map<string, TradePathResult>();
    for (const row of rows) if (!onePerChannel.has(row.channel)) onePerChannel.set(row.channel, row);
    const channels = [...onePerChannel.keys()].sort();
    for (let left = 0; left < channels.length; left++) for (let right = left + 1; right < channels.length; right++) {
      const key = `${channels[left]}\u0000${channels[right]}`;
      pairs.set(key, [...(pairs.get(key) ?? []), { a: onePerChannel.get(channels[left]) as TradePathResult, b: onePerChannel.get(channels[right]) as TradePathResult }]);
    }
  }
  const matchedChannelPairs: MatchedChannelPair[] = [...pairs.entries()].map(([key, rows]) => {
    const [channelA, channelB] = key.split("\u0000");
    const mfeDeltas = rows.flatMap(({ a, b }) => a.path.observedMfePct != null && b.path.observedMfePct != null
      ? [b.path.observedMfePct - a.path.observedMfePct] : []);
    const pnlDeltas = rows.flatMap(({ a, b }) => a.realizedPnl != null && b.realizedPnl != null
      ? [b.realizedPnl - a.realizedPnl] : []);
    return {
      channelA,
      channelB,
      matchedClocks: rows.length,
      channelAMfeWins: mfeDeltas.filter((delta) => delta < 0).length,
      channelBMfeWins: mfeDeltas.filter((delta) => delta > 0).length,
      tiedMfe: mfeDeltas.filter((delta) => delta === 0).length,
      channelARealizedWins: pnlDeltas.filter((delta) => delta < 0).length,
      channelBRealizedWins: pnlDeltas.filter((delta) => delta > 0).length,
      tiedRealized: pnlDeltas.filter((delta) => delta === 0).length,
      medianMfeDeltaBMinusA: median(mfeDeltas),
      medianRealizedPnlDeltaBMinusA: median(pnlDeltas),
    };
  }).sort((a, b) => b.matchedClocks - a.matchedClocks || a.channelA.localeCompare(b.channelA) || a.channelB.localeCompare(b.channelB));

  const diagnosticRows = exact.filter((trade) => (ADMISSION_DIAGNOSTIC_FAMILIES as readonly string[]).includes(trade.familyId));
  const diagnosticKeys = [...new Set(diagnosticRows.map((trade) => `${trade.familyId}\u0000${trade.channel}`))].sort();
  const admissionDiagnostics: AdmissionDiagnostic[] = diagnosticKeys.map((key) => {
    const [familyId, channel] = key.split("\u0000");
    const rows = diagnosticRows.filter((trade) => trade.familyId === familyId && trade.channel === channel);
    return {
      familyId,
      channel,
      eligible: rows.length,
      observedMfeNonPositive: rows.filter((trade) => (trade.path.observedMfePct ?? -Infinity) <= 0).length,
      reached10Pct: rows.filter((trade) => trade.path.targetTouches.some((touch) => touch.targetPct === 10 && touch.firstAtMs != null)).length,
      reached15Pct: rows.filter((trade) => trade.path.targetTouches.some((touch) => touch.targetPct === 15 && touch.firstAtMs != null)).length,
      observedMaeAtOrBelowMinus30: rows.filter((trade) => (trade.path.observedMaePct ?? Infinity) <= -30).length,
      realizedPnl: money(rows.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0)),
      exitOptimizationAuthorized: false,
    };
  });

  const opportunityCounts = new Map<string, number>();
  for (const trade of exact) if (trade.opportunityId) opportunityCounts.set(trade.opportunityId, (opportunityCounts.get(trade.opportunityId) ?? 0) + 1);
  return {
    version: PREREGISTERED_PATH_TEST_VERSION,
    developmentThroughEt: DEVELOPMENT_THROUGH_ET,
    prospectiveHoldoutFromEt: PROSPECTIVE_HOLDOUT_FROM_ET,
    cohort,
    exactPathEligible: exact.length,
    scalePolicies,
    matchedClockGroups,
    matchedChannelPairs,
    admissionDiagnostics,
    sharedDurableOpportunityIds: [...opportunityCounts.values()].filter((count) => count > 1).length,
    policyChangeAuthorized: false,
    caveats: [
      "July 13–14 generated these hypotheses and is development evidence only; it cannot validate the frozen policy set.",
      "Prospective scoring begins July 15 and must not silently tune targets, runner rules, or eligibility after reading holdout outcomes.",
      "Durable opportunity IDs are position-specific in this cohort. Sibling matching uses the same underlying, option side, and completed source-bar clock and is labeled accordingly.",
      "CBBO-1s is interval-sampled consolidated NBBO, not every book update. Observed touches remain lower bounds.",
      "Scale replays do not alter the channel's pre-bank stop. Stops remain per-channel, never per-account.",
      "Matched siblings share market clocks and are correlated observations, not independent trials.",
      "No result authorizes a strategy, roster, sizing, or production change.",
    ],
  };
}
