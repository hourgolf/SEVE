import type { useDailyReports } from "@/hooks/useDailyReports";
import { signedUsd } from "@/lib/format";
import { buildSessionReviewModel } from "@/lib/perform/sessionReview";

const sessionLabel = (value: string): string => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
  timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric",
});

export function ReviewSessionScorecard({ evidence }: { evidence: ReturnType<typeof useDailyReports> }) {
  if (evidence.loading) return <section className="rvw-session-scorecard loading">Loading the last completed session…</section>;
  if (evidence.error) return <section className="rvw-session-scorecard error">The sealed session report could not be read · {evidence.error}</section>;
  const report = evidence.reports[0];
  if (!report) return <section className="rvw-session-scorecard empty">No sealed close report is available yet.</section>;
  const model = buildSessionReviewModel(report);
  return <section className="rvw-session-scorecard" aria-label="Last completed trading session">
    <header>
      <span><small>LAST COMPLETED TRADING SESSION</small><b>{sessionLabel(model.reportDate)} · {model.reportDate}</b></span>
      <em>{model.scope.replaceAll("_", " ")}</em>
    </header>
    <div className="rvw-session-metrics">
      <span><small>ACTUAL RESULT</small><b className={model.resultUsd != null && model.resultUsd >= 0 ? "pos" : "neg"}>{model.resultUsd == null ? "—" : signedUsd(model.resultUsd)}</b><em>{model.observations} {model.evidenceLabel} · {model.channelsTraded} channels</em></span>
      <span><small>PROFITABLE OUTCOMES</small><b>{model.profitable} of {model.observations}</b><em>{model.observations ? `${Math.round((100 * model.profitable) / model.observations)}% finished positive` : "no closed outcomes"}</em></span>
      <span><small>OPPORTUNITY FOUND</small><b>{model.averageBestMovePct == null ? "—" : `+${model.averageBestMovePct}%`}</b><em>average best move while open</em></span>
      <span><small>EXIT CAPTURE</small><b className={model.retainedPct != null && model.retainedPct >= 50 ? "pos" : "neg"}>{model.retainedPct == null ? "—" : `${model.retainedPct}% kept`}</b><em>{model.retainedPct == null ? "no comparable peak evidence" : `${100 - model.retainedPct}% of the available move was given back`}</em></span>
    </div>
    <div className="rvw-next-action"><small>INVESTIGATE NEXT</small><b>{model.nextAction}</b></div>
    {model.limitation && <p>{model.limitation}</p>}
  </section>;
}
