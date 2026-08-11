import type { AtlasOpportunity } from "./decisionAtlas";
import {
  PRIORITY_A_BOUNDED_RETUNES,
  type BoundedRetuneExperimentDefinition,
} from "./boundedRetuneRegistry";

export const BOUNDED_RETUNE_SCORER_VERSION = "bounded-retune-scorer-v2" as const;

export interface BoundedRetuneEvidence {
  experimentId: string;
  channel: string;
  status: "awaiting_first_session" | "collecting" | "review_ready";
  prospectiveSessions: number;
  eligibleLogicalOutcomes: number;
  scoredLogicalOutcomes: number;
  remainingSessions: number;
  remainingLogicalOutcomes: number;
  typicalControlSessionUsd: number | null;
  typicalAlternativeSessionUsd: number | null;
  typicalDeltaUsd: number | null;
  pairedSessionImprovement: number | null;
  downsideDeltaUsd: number | null;
  alternativeOutlierShare: number | null;
  provisionalRead: "insufficient_evidence" | "supports_alternative" | "keep_control" | "mixed";
  censored: {
    missingExperimentStamp: number;
    baselineMismatch: number;
    unscoredLogicalOpportunities: number;
    duplicateLogicalRows: number;
    incompleteSessions: number;
  };
  decisionChecks: {
    evidenceFloorMet: boolean;
    typicalSessionImproved: boolean | null;
    improvementFrequencyMet: boolean | null;
    downsideNotWorse: boolean | null;
    notDrivenByOneWinner: boolean | null;
  };
}

export interface BoundedRetuneBook {
  schemaVersion: 1;
  scorerVersion: typeof BOUNDED_RETUNE_SCORER_VERSION;
  generatedAt: string;
  throughSession: string;
  cohortStartSession: string;
  experiments: Array<{
    definition: BoundedRetuneExperimentDefinition;
    evidence: BoundedRetuneEvidence;
  }>;
  summary: {
    registered: number;
    awaiting: number;
    collecting: number;
    reviewReady: number;
    sourceSignalsCensored: number;
  };
  productionWrites: 0;
  executionAuthority: false;
  configurationAuthority: false;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}

function quantile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(lower === upper ? ordered[lower]
    : ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower));
}

function scoreExperiment(
  definition: BoundedRetuneExperimentDefinition,
  opportunities: readonly AtlasOpportunity[],
): BoundedRetuneEvidence {
  const prospective = opportunities.filter((row) => row.channel === definition.channel
    && row.evidenceLayer === "prospective_virtual"
    && row.session >= definition.cohortStartSession);
  const missingExperimentStamp = prospective.filter((row) => !row.boundedRetuneStamp).length;
  const stamped = prospective.filter((row) =>
    row.boundedRetuneStamp?.experimentId === definition.experimentId);
  const baselineMismatch = stamped.filter((row) => !row.boundedRetuneStamp?.baselineMatches).length;
  const eligible = stamped.filter((row) => row.boundedRetuneStamp?.baselineMatches);
  const byLogicalOpportunity = new Map<string, AtlasOpportunity[]>();
  for (const row of eligible) {
    byLogicalOpportunity.set(row.logicalOpportunityId,
      [...(byLogicalOpportunity.get(row.logicalOpportunityId) ?? []), row]);
  }
  const completeForDefinition = (row: AtlasOpportunity): boolean => finite(row.resultPerContractUsd)
    && (definition.variable !== "take_profit_pct"
      || (finite(row.entryPrice) && row.entryPrice > 0 && finite(row.returnPct) && finite(row.mfePct)));
  const scored: AtlasOpportunity[] = [];
  let unscoredLogicalOpportunities = 0;
  let duplicateLogicalRows = 0;
  for (const rows of byLogicalOpportunity.values()) {
    duplicateLogicalRows += Math.max(0, rows.length - 1);
    const complete = [...rows].filter(completeForDefinition)
      .sort((left, right) => left.signalAt.localeCompare(right.signalAt))[0];
    if (complete) scored.push(complete);
    else unscoredLogicalOpportunities += 1;
  }
  const bySession = new Map<string, AtlasOpportunity[]>();
  for (const row of scored) bySession.set(row.session, [...(bySession.get(row.session) ?? []), row]);

  const pairs: Array<{ session: string; control: number; alternative: number }> = [];
  let scoredLogicalOutcomes = 0;
  const eligibleSessions = new Set(eligible.map((row) => row.session));
  for (const [session, rows] of [...bySession].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = [...rows].sort((left, right) => left.signalAt.localeCompare(right.signalAt)
      || left.logicalOpportunityId.localeCompare(right.logicalOpportunityId));
    scoredLogicalOutcomes += ordered.length;
    const control = round(ordered.reduce((sum, row) => sum + row.resultPerContractUsd!, 0));
    let alternative = control;
    if (definition.variable === "max_entries_per_session") {
      alternative = round(ordered.slice(0, definition.alternativeValue)
        .reduce((sum, row) => sum + row.resultPerContractUsd!, 0));
    } else {
      alternative = round(ordered.reduce((sum, row) => sum
        + (row.mfePct! >= definition.alternativeValue
          ? row.entryPrice! * definition.alternativeValue
          : row.resultPerContractUsd!), 0));
    }
    pairs.push({ session, control, alternative });
  }

  const sessions = pairs.length;
  const minimum = definition.minimumEvidence;
  const evidenceFloorMet = sessions >= minimum.sessions
    && scoredLogicalOutcomes >= minimum.logicalOutcomes;
  const deltas = pairs.map((row) => round(row.alternative - row.control));
  const typicalControl = median(pairs.map((row) => row.control));
  const typicalAlternative = median(pairs.map((row) => row.alternative));
  const typicalDelta = median(deltas);
  const pairedSessionImprovement = pairs.length
    ? round(pairs.filter((row) => row.alternative > row.control).length / pairs.length) : null;
  const controlDownside = quantile(pairs.map((row) => row.control), 0.1);
  const alternativeDownside = quantile(pairs.map((row) => row.alternative), 0.1);
  const downsideDelta = controlDownside != null && alternativeDownside != null
    ? round(alternativeDownside - controlDownside) : null;
  const positiveAlternative = pairs.filter((row) => row.alternative > 0).map((row) => row.alternative);
  const alternativeOutlierShare = positiveAlternative.length
    ? round(Math.max(...positiveAlternative) / positiveAlternative.reduce((sum, value) => sum + value, 0)) : null;
  const checks = {
    evidenceFloorMet,
    typicalSessionImproved: typicalDelta == null ? null : typicalDelta > 0,
    improvementFrequencyMet: pairedSessionImprovement == null ? null
      : pairedSessionImprovement >= minimum.pairedSessionImprovement,
    downsideNotWorse: downsideDelta == null ? null : downsideDelta >= 0,
    notDrivenByOneWinner: alternativeOutlierShare == null ? null : alternativeOutlierShare <= 0.5,
  };
  const allSupport = checks.typicalSessionImproved && checks.improvementFrequencyMet
    && checks.downsideNotWorse && checks.notDrivenByOneWinner;
  const clearlyWorse = checks.typicalSessionImproved === false
    || checks.improvementFrequencyMet === false || checks.downsideNotWorse === false;
  return {
    experimentId: definition.experimentId,
    channel: definition.channel,
    status: sessions === 0 ? "awaiting_first_session"
      : evidenceFloorMet ? "review_ready" : "collecting",
    prospectiveSessions: sessions,
    eligibleLogicalOutcomes: byLogicalOpportunity.size,
    scoredLogicalOutcomes,
    remainingSessions: Math.max(0, minimum.sessions - sessions),
    remainingLogicalOutcomes: Math.max(0, minimum.logicalOutcomes - scoredLogicalOutcomes),
    typicalControlSessionUsd: typicalControl,
    typicalAlternativeSessionUsd: typicalAlternative,
    typicalDeltaUsd: typicalDelta,
    pairedSessionImprovement,
    downsideDeltaUsd: downsideDelta,
    alternativeOutlierShare,
    provisionalRead: !evidenceFloorMet ? "insufficient_evidence"
      : allSupport ? "supports_alternative" : clearlyWorse ? "keep_control" : "mixed",
    censored: {
      missingExperimentStamp,
      baselineMismatch,
      unscoredLogicalOpportunities,
      duplicateLogicalRows,
      incompleteSessions: [...eligibleSessions].filter((session) => !bySession.has(session)).length,
    },
    decisionChecks: checks,
  };
}

export function buildBoundedRetuneBook(input: {
  generatedAt: string;
  throughSession: string;
  opportunities: readonly AtlasOpportunity[];
  definitions?: readonly BoundedRetuneExperimentDefinition[];
}): BoundedRetuneBook {
  const definitions = input.definitions ?? PRIORITY_A_BOUNDED_RETUNES;
  const experiments = definitions.map((definition) => ({
    definition,
    evidence: scoreExperiment(definition, input.opportunities),
  }));
  return {
    schemaVersion: 1,
    scorerVersion: BOUNDED_RETUNE_SCORER_VERSION,
    generatedAt: input.generatedAt,
    throughSession: input.throughSession,
    cohortStartSession: [...definitions.map((row) => row.cohortStartSession)].sort()[0] ?? "",
    experiments,
    summary: {
      registered: experiments.length,
      awaiting: experiments.filter((row) => row.evidence.status === "awaiting_first_session").length,
      collecting: experiments.filter((row) => row.evidence.status === "collecting").length,
      reviewReady: experiments.filter((row) => row.evidence.status === "review_ready").length,
      sourceSignalsCensored: experiments.reduce((sum, row) => sum
        + row.evidence.censored.missingExperimentStamp
        + row.evidence.censored.baselineMismatch
        + row.evidence.censored.unscoredLogicalOpportunities
        + row.evidence.censored.duplicateLogicalRows, 0),
    },
    productionWrites: 0,
    executionAuthority: false,
    configurationAuthority: false,
  };
}

const valueLabel = (definition: BoundedRetuneExperimentDefinition): string =>
  definition.variable === "max_entries_per_session"
    ? `all signals → first ${definition.alternativeValue}/session`
    : `take +${definition.controlValue}% → +${definition.alternativeValue}%`;

export function renderBoundedRetuneBookMarkdown(book: BoundedRetuneBook): string {
  return [
    `# Priority-A bounded retunes — through ${book.throughSession}`,
    "",
    `Prospective cohorts begin on or after **${book.cohortStartSession}**. These are dark comparisons only: ${book.summary.registered} registered, ${book.summary.awaiting} awaiting, ${book.summary.collecting} collecting, and ${book.summary.reviewReady} ready for human review.`,
    "",
    "| Channel | One variable | Comparison | Progress | Read |",
    "|---|---|---|---:|---|",
    ...book.experiments.map(({ definition, evidence }) =>
      `| ${definition.channel} | ${definition.variable.replaceAll("_", " ")} | ${valueLabel(definition)} | ${evidence.prospectiveSessions}/5 sessions · ${evidence.scoredLogicalOutcomes}/10 outcomes | ${evidence.provisionalRead.replaceAll("_", " ")} |`),
    "",
    "## Decision rule",
    "",
    "Review starts only after both five independent sessions and ten scored logical outcomes. The alternative must improve the typical session, improve at least 60% of paired sessions, avoid worsening the weak-session tail, and not depend on one large winner. A review-ready result is still a proposal, never an automatic configuration change.",
    "",
    "## Boundaries",
    "",
    "The source signal carries the experiment identity and observed baseline. Missing stamps, changed baseline settings, duplicate rows, and logical opportunities without a scored outcome are counted explicitly rather than silently pooled. A scored opportunity can still contribute when another raw signal in the session was not selected for a complete virtual path. No order, execution, sizing, manager, roster, account, or configuration authority is present.",
    "",
  ].join("\n");
}
