export type WeekendManagerVerdict =
  | "prepare_switch_review"
  | "continue_dark_challenger"
  | "hold_current_manager"
  | "insufficient_paired_evidence";

export interface WeekendManagerMetric {
  managerId: string;
  pairedOpportunities: number;
  sessions: number;
  typicalBenefitPct: number | null;
  improvementFrequency: number | null;
  downsideDeteriorationPct: number | null;
  benefitInterval95: { lower: number | null; upper: number | null };
  leaveSessionOutStable: boolean | null;
  chronologicalStable: boolean | null;
}
export interface WeekendAtlasFrontier {
  evidenceLayer: string;
  configurationEra: string;
  managers: WeekendManagerMetric[];
}

export interface WeekendAtlasChannel {
  channel: string;
  decisionCohort: { configurationEra: string };
  frontiers: WeekendAtlasFrontier[];
}

export interface WeekendManagerReview {
  channel: string;
  manager: string;
  evidenceLayer: string | null;
  configurationEra: string | null;
  pairedOpportunities: number;
  sessions: number;
  typicalBenefitPct: number | null;
  improvementFrequency: number | null;
  downsideDeteriorationPct: number | null;
  interval95: { lower: number | null; upper: number | null } | null;
  verdict: WeekendManagerVerdict;
  plainReason: string;
  nextReviewAt: string;
  productionChangeAuthorized: false;
}

function metricRank(frontier: WeekendAtlasFrontier, currentEra: string): number {
  const current = frontier.configurationEra === currentEra ? 10 : 0;
  const layer = frontier.evidenceLayer === "exact_current_configuration" ? 4
    : frontier.evidenceLayer === "actual_portfolio" ? 3
    : frontier.evidenceLayer === "prospective_virtual" ? 2 : 1;
  return current + layer;
}

export function prepareManagerReview(input: {
  atlasChannel: WeekendAtlasChannel | null;
  channel: string;
  manager: string;
}): WeekendManagerReview {
  const currentEra = input.atlasChannel?.decisionCohort.configurationEra ?? "";
  const matches = (input.atlasChannel?.frontiers ?? []).flatMap((frontier) =>
    frontier.managers
      .filter((metric) => metric.managerId === input.manager)
      .map((metric) => ({ frontier, metric })))
    .sort((left, right) =>
      metricRank(right.frontier, currentEra) - metricRank(left.frontier, currentEra)
      || right.metric.sessions - left.metric.sessions
      || right.metric.pairedOpportunities - left.metric.pairedOpportunities);
  const best = matches[0] ?? null;
  const metric = best?.metric ?? null;
  let verdict: WeekendManagerVerdict = "insufficient_paired_evidence";
  let plainReason = "No comparable current-era manager outcomes are available.";
  let nextReviewAt = "Collect at least 5 independent paired sessions and 10 paired outcomes.";

  if (metric && metric.sessions >= 5 && metric.pairedOpportunities >= 5) {
    const positive = (metric.typicalBenefitPct ?? Number.NEGATIVE_INFINITY) > 0
      && (metric.improvementFrequency ?? 0) >= 0.6
      && (metric.downsideDeteriorationPct ?? Number.NEGATIVE_INFINITY) >= -2;
    const intervalPositive = (metric.benefitInterval95.lower ?? Number.NEGATIVE_INFINITY) > 0;
    if (positive && intervalPositive && metric.leaveSessionOutStable === true
        && metric.chronologicalStable === true && metric.sessions >= 10) {
      verdict = "prepare_switch_review";
      plainReason = "The challenger improves the typical paired outcome, wins most paired sessions, and remains stable across time and leave-one-session-out checks.";
      nextReviewAt = "Ready for a separately approved, one-channel manager proposal.";
    } else if (positive) {
      verdict = "continue_dark_challenger";
      plainReason = "The early paired evidence is favorable without meaningfully worsening weak outcomes, but the current-era sample is still short of 10 independent sessions.";
      nextReviewAt = `${Math.max(0, 10 - metric.sessions)} more independent paired session${10 - metric.sessions === 1 ? "" : "s"}, then re-run the same comparison.`;
    } else {
      verdict = "hold_current_manager";
      plainReason = "The challenger does not improve the typical paired outcome often enough, or it worsens weak outcomes.";
      nextReviewAt = "No switch planned; keep observing only if the comparison remains operationally free.";
    }
  } else if (metric) {
    plainReason = `Only ${metric.sessions} independent paired session${metric.sessions === 1 ? "" : "s"} and ${metric.pairedOpportunities} paired outcome${metric.pairedOpportunities === 1 ? "" : "s"} are available.`;
  }

  return {
    channel: input.channel,
    manager: input.manager,
    evidenceLayer: best?.frontier.evidenceLayer ?? null,
    configurationEra: best?.frontier.configurationEra ?? null,
    pairedOpportunities: metric?.pairedOpportunities ?? 0,
    sessions: metric?.sessions ?? 0,
    typicalBenefitPct: metric?.typicalBenefitPct ?? null,
    improvementFrequency: metric?.improvementFrequency ?? null,
    downsideDeteriorationPct: metric?.downsideDeteriorationPct ?? null,
    interval95: metric?.benefitInterval95 ?? null,
    verdict,
    plainReason,
    nextReviewAt,
    productionChangeAuthorized: false,
  };
}

export interface WeekendExecutedRow {
  channel: string;
  throughTimestamp: string;
  [key: string]: unknown;
}

export function latestExecutedEraByChannel<T extends WeekendExecutedRow>(
  rows: readonly T[],
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prior = latest.get(row.channel);
    if (!prior || row.throughTimestamp > prior.throughTimestamp) {
      latest.set(row.channel, row);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.channel.localeCompare(right.channel));
}
