import {
  DAY1_CONFIG_HASH,
  DAY1_MANAGER_ARMS,
  DAY1_RELEASE_ID,
} from "../channels/day1Release.js";
import { deriveRootContinuityReceipt, ROOT_PROSPECTIVE_COHORT_START_ET } from "./prospectLane.js";

export const WEEK1_EVIDENCE_BASELINE_VERSION = "week1-evidence-baseline-v1" as const;

export interface Week1EvidenceBaseline {
  schemaVersion: 1;
  baselineVersion: typeof WEEK1_EVIDENCE_BASELINE_VERSION;
  capturedAt: string;
  source: "supabase_select_only";
  range: { from: "2026-07-20"; through: "2026-07-23" };
  release: {
    releaseId: string;
    releaseConfigurationSha256: string;
    rootProspectiveCohortStartEt: string;
    rootEraReset: false;
    rootConfigurationChangeAuthorized: false;
    roots: Array<{
      slug: string;
      channelVersion: string;
      configurationEpochId: string;
      managerVersion: string;
      policyEpochId: string;
    }>;
  };
  cohort: {
    allTrades: number;
    allPnl: number;
    cleanAutoTrades: number;
    cleanAutoPnl: number;
    interventionTrades: number;
    interventionPnl: number;
  };
  daily: Array<{ sessionDate: string; trades: number; realizedPnl: number }>;
  managers: Array<{ managerId: string; paths: number; winners: number; terminalPnl: number }>;
  channelManagerHighlights: Array<{
    channelSlug: string;
    observedTrades: number;
    actualPnl: number;
    leadingObservedManager: string;
    leadingModeledPnl: number;
    leadingWins: number;
    hypothesisOnly: true;
  }>;
  managerState: { paths: number; terminal: number; censored: number; positions: number };
  darkVirtualDaily: Array<{ sessionDate: string; trades: number; channels: number; winners: number; pnlPerContractSum: number }>;
  interpretations: {
    livePnlIsBrokerSessionEvidence: true;
    darkVirtualPnlIsPortfolioPnl: false;
    historicalPoolingAuthorized: false;
    policyChangeAuthorized: false;
  };
}

export function validateWeek1EvidenceBaseline(input: Week1EvidenceBaseline): string[] {
  const issues: string[] = [];
  const continuity = deriveRootContinuityReceipt();
  if (input.schemaVersion !== 1 || input.baselineVersion !== WEEK1_EVIDENCE_BASELINE_VERSION) issues.push("schema");
  if (!Number.isFinite(Date.parse(input.capturedAt))) issues.push("capturedAt");
  if (input.release.releaseId !== DAY1_RELEASE_ID) issues.push("releaseId");
  if (input.release.releaseConfigurationSha256 !== DAY1_CONFIG_HASH) issues.push("releaseConfigurationSha256");
  if (input.release.rootProspectiveCohortStartEt !== ROOT_PROSPECTIVE_COHORT_START_ET) issues.push("rootProspectiveCohortStartEt");
  if (input.release.rootEraReset || input.release.rootConfigurationChangeAuthorized) issues.push("rootContinuityAuthorization");
  if (JSON.stringify([...input.release.roots].sort((a, b) => a.slug.localeCompare(b.slug)))
      !== JSON.stringify(continuity.roots)) issues.push("rootIdentities");
  if (input.daily.reduce((sum, row) => sum + row.trades, 0) !== input.cohort.allTrades) issues.push("dailyTradeTotal");
  if (Math.round(input.daily.reduce((sum, row) => sum + row.realizedPnl, 0) * 100) / 100 !== input.cohort.allPnl) issues.push("dailyPnlTotal");
  if (input.cohort.cleanAutoTrades + input.cohort.interventionTrades !== input.cohort.allTrades) issues.push("cohortTradePartition");
  if (Math.round((input.cohort.cleanAutoPnl + input.cohort.interventionPnl) * 100) / 100 !== input.cohort.allPnl) issues.push("cohortPnlPartition");
  if (input.managerState.positions !== input.cohort.allTrades) issues.push("managerPositionCoverage");
  if (input.managerState.paths !== input.cohort.allTrades * DAY1_MANAGER_ARMS.length) issues.push("managerPathCoverage");
  if (input.managerState.terminal !== input.managerState.paths || input.managerState.censored !== 0) issues.push("managerTerminalState");
  if (input.managers.length !== DAY1_MANAGER_ARMS.length
      || input.managers.some((row) => row.paths !== input.cohort.allTrades)) issues.push("managerArmCoverage");
  if (input.channelManagerHighlights.length !== continuity.roots.length
      || input.channelManagerHighlights.some((row) =>
        !continuity.roots.some((root) => root.slug === row.channelSlug)
        || row.observedTrades <= 0
        || !DAY1_MANAGER_ARMS.includes(row.leadingObservedManager as typeof DAY1_MANAGER_ARMS[number])
        || !row.hypothesisOnly)) issues.push("channelManagerHighlights");
  if (input.interpretations.darkVirtualPnlIsPortfolioPnl
      || input.interpretations.historicalPoolingAuthorized
      || input.interpretations.policyChangeAuthorized) issues.push("interpretationAuthorization");
  return issues;
}
