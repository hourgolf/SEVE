import type { DailyReport } from "@/hooks/useDailyReports";

export interface SessionReviewModel {
  reportDate: string;
  scope: string;
  evidenceLabel: string;
  resultLabel: "GROSS LOGICAL-TRADE ATTRIBUTION" | "GROSS POSITION-ROW ATTRIBUTION";
  resultUsd: number | null;
  observations: number;
  profitable: number;
  channelsTraded: number;
  averageBestMovePct: number | null;
  retainedPct: number | null;
  nextAction: string;
  limitation: string | null;
}

const weightedExitRead = (report: DailyReport): { averageBestMovePct: number | null; retainedPct: number | null } => {
  const total = (report.digest.channels ?? []).reduce((acc, channel) => {
    const weight = channel.metrics.nPeaked ?? 0;
    const peak = channel.metrics.avgPeakPct;
    const retained = channel.metrics.peakCapturePct;
    if (weight > 0 && peak != null && retained != null) {
      acc.weight += weight;
      acc.peak += peak * weight;
      acc.retained += retained * weight;
    }
    return acc;
  }, { weight: 0, peak: 0, retained: 0 });
  return total.weight > 0
    ? { averageBestMovePct: Math.round(total.peak / total.weight), retainedPct: Math.round(total.retained / total.weight) }
    : { averageBestMovePct: null, retainedPct: null };
};

const plainNextAction = (value: string): string => {
  if (/blocked_reason|COST_GATE_RATIO/i.test(value)) {
    return "Count why signals were blocked. If one reason dominates, test that entry rule or fix the source problem.";
  }
  return value
    .replaceAll("blocked_reason", "signal blocks")
    .replaceAll("upstream cause", "source problem");
};

export function buildSessionReviewModel(report: DailyReport): SessionReviewModel {
  const fund = report.digest.fund;
  const logical = report.digest.evidence?.unit === "logical_trade";
  const observations = fund?.trades ?? 0;
  const exit = weightedExitRead(report);
  return {
    reportDate: report.report_date,
    scope: report.digest.evidence?.scope ?? "all paper accounts",
    evidenceLabel: logical ? "logical trades" : "legacy position rows",
    resultLabel: logical ? "GROSS LOGICAL-TRADE ATTRIBUTION" : "GROSS POSITION-ROW ATTRIBUTION",
    resultUsd: fund?.dayRealized ?? null,
    observations,
    profitable: fund ? Math.round(fund.winRate * observations) : 0,
    channelsTraded: fund?.channelsTraded ?? 0,
    averageBestMovePct: exit.averageBestMovePct,
    retainedPct: exit.retainedPct,
    nextAction: plainNextAction(report.narrative?.topActions?.[0]
      ?? report.narrative?.systemFindings?.[0]?.suggestedExperiment
      ?? "Open Trade Review to inspect channel-level evidence."),
    limitation: logical
      ? null
      : "This stored report predates logical-trade evidence. Counts are legacy position rows and should not be compared directly with current reports.",
  };
}

export function easternDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function shouldAnchorHistoricalResults(reportDate: string | null, now = new Date()): boolean {
  return !!reportDate && reportDate < easternDate(now);
}
