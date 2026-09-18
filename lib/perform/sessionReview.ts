import { reportingSession } from "@/lib/desk/reportingSession";
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
  const diagnostic = report.digest.peakDiagnostic;
  return diagnostic?.schema === "seve-reporting-v3"
    ? { averageBestMovePct: diagnostic.averagePeakPct, retainedPct: diagnostic.retainedPct }
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
    profitable: fund ? fund.wins ?? Math.round(fund.winRate * observations) : 0,
    channelsTraded: fund?.channelsTraded ?? 0,
    averageBestMovePct: exit.averageBestMovePct,
    retainedPct: exit.retainedPct,
    nextAction: plainNextAction(report.narrative?.topActions?.[0]
      ?? report.narrative?.systemFindings?.[0]?.suggestedExperiment
      ?? "Open Trade Review to inspect channel-level evidence."),
    limitation: report.digest.evidence?.historicalAttribution
      ? `Broker fills reconstruct ${report.digest.evidence.historicalAttribution.reconstructedTrades} of ${report.digest.evidence.historicalAttribution.recordedTrades} recorded trades; ${report.digest.evidence.historicalAttribution.unresolvedTrades} remain unresolved. Broker-only executions are separate. Historical manager and path eligibility are unverified.`
      : logical
      ? report.digest.peakDiagnostic ? `Held-mark diagnostic only; ${report.digest.peakDiagnostic.valid} valid / ${report.digest.peakDiagnostic.total} observed, ${report.digest.peakDiagnostic.excluded} excluded. Executable capture is unverified.` : "Peak coverage is unavailable in this stored report; executable capture is unverified."
      : "This stored report predates logical-trade evidence. Counts are legacy position rows and should not be compared directly with current reports.",
  };
}

export function easternDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function shouldAnchorHistoricalResults(reportDate: string | null, now = new Date()): boolean {
  if (!reportDate) return false;
  if (reportDate < easternDate(now)) return true;
  const session = reportingSession(now.getTime());
  return session.known && reportDate === session.date && now.getTime() >= session.closeMs;
}
