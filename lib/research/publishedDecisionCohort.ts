import type { ChannelDecisionBrief } from "./channelDecisionBrief";
import type { ShadowChannelSummary } from "./shadowResearch";

/**
 * Project the immutable nightly decision cohort into the small shape used by
 * the Atlas fleet presentation. This is deliberately sparse: fields that are
 * not present in the publication remain null/zero instead of being inferred
 * from a different cohort or reconstructed from unrelated medians.
 */
export function publishedDecisionCohortSummary(
  brief: ChannelDecisionBrief,
): ShadowChannelSummary {
  const distribution = brief.decisionDistribution;
  const opportunities = distribution?.opportunities ?? brief.evidence.decisionOpportunities;
  const sessions = distribution?.sessions ?? brief.evidence.decisionSessions;
  const fromSession = distribution?.fromSession ?? "";
  const throughSession = distribution?.throughSession ?? brief.throughSession;
  return {
    evidenceBasis: "published_decision_cohort",
    slug: brief.channel,
    paths: opportunities,
    // The publication exposes decision opportunities, not a separate raw-row
    // scored count. Keep the shared shape internally usable while the basis
    // marker prevents this value from being labeled as ledger reconciliation.
    scored: opportunities,
    winners: 0,
    targets: 0,
    stops: 0,
    flattens: 0,
    pnlPerContract: 0,
    averagePerPath: null,
    typicalPerPath: distribution?.typicalOpportunityUsd ?? null,
    largestWinnerShare: distribution?.largestWinnerShare ?? null,
    averageMfePct: null,
    averageGivebackPct: null,
    typicalMfePct: distribution?.typicalBestMovePct ?? null,
    typicalGivebackPct: null,
    typicalReturnPct: distribution?.typicalFinalReturnPct ?? null,
    typicalCapture: distribution?.coherentCapture ?? null,
    sessions,
    positiveSessions: distribution?.positiveSessions ?? 0,
    positiveSessionRate: distribution?.positiveSessionRate ?? null,
    typicalSessionPerContract: distribution?.typicalSessionUsd ?? null,
    weakSessionPerContract: distribution?.weakSessionUsd ?? null,
    strongSessionPerContract: distribution?.strongSessionUsd ?? null,
    typicalLossPerContract: null,
    fromSession,
    throughSession,
    channelSpecVersionIds: [],
    configurationEpochIds: [],
    lastAt: throughSession ? `${throughSession}T20:00:00.000Z` : brief.generatedAt,
  };
}
