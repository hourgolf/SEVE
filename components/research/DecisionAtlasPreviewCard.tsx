import "@/app/decision-atlas.css";
import { buildDecisionAtlasPreview } from "@/lib/research/decisionAtlasPreview";
import type { ChannelManagerEvidence } from "@/lib/research/channelManagerEvidence";
import type { ChannelDryPowderCurve, ShadowChannelSummary } from "@/lib/research/shadowResearch";
import type { BoundedRetuneEvidence } from "@/lib/research/boundedRetuneExperiments";
import type { ChannelDecisionBrief } from "@/lib/research/channelDecisionBrief";

const signed = (value: number | null, suffix = "") => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 10) / 10)}${suffix}`;
const money = (value: number | null) => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;

export function DecisionAtlasPreviewCard({ brief, summary, dryPowder, managerEvidence, retuneEvidence, compact = false }: {
  brief?: ChannelDecisionBrief | null;
  summary?: ShadowChannelSummary | null;
  dryPowder?: ChannelDryPowderCurve | null;
  managerEvidence?: ChannelManagerEvidence | null;
  retuneEvidence?: BoundedRetuneEvidence | null;
  compact?: boolean;
}) {
  const model = buildDecisionAtlasPreview({ summary, dryPowder, managerEvidence, retuneEvidence });
  if (brief) return <section className={`atlas-preview authoritative${compact ? " compact" : ""}`} aria-label="Decision Atlas paired channel report">
    <header><span><small>DECISION ATLAS · NIGHTLY PAIRED · THROUGH {brief.throughSession.slice(5).replace("-", "/")}</small><b>{brief.recommendation.label}</b></span><em>READ ONLY</em></header>
    <p>{brief.recommendation.summary}</p>
    <div className="atlas-preview-metrics">{brief.metrics.map((metric) => <span key={metric.label} title={metric.fact}><small>{metric.label}</small><b>{metric.value}</b></span>)}</div>
    <details><summary>Full paired review</summary><div className="atlas-brief-body">
      <div className="atlas-brief-layers">
        <span><small>{brief.executed.label}</small><b>{brief.executed.state === "available" ? `${brief.executed.sessions}s · ${brief.executed.logicalTrades} trades · ${money(brief.executed.typicalResultUsd)} typical` : "NO EXECUTED ROW"}</b></span>
        <span><small>{brief.historicalVirtual.label}</small><b>{brief.historicalVirtual.state === "available" ? `${brief.historicalVirtual.sessions}s · ${brief.historicalVirtual.scored} scored · ${money(brief.historicalVirtual.typicalResultPerContractUsd)}/ct typical` : "NO VIRTUAL ROW"}</b></span>
      </div>
      <section><h4>Entry frequency</h4><p>{brief.entryFrequency.conclusion}</p><div className="atlas-entry-strip">{brief.entryFrequency.rows.slice(0, 6).map((row) => <span key={row.entryNumber}><small>ENTRY {row.entryNumber}</small><b>{money(row.typicalResultPerContractUsd)}/ct</b><em>{row.sessions}s · {row.positive}/{row.scored} positive</em></span>)}</div>{brief.entryFrequency.rows.length > 6 && <small>First six entries shown here; all {brief.entryFrequency.rows.length} remain in the nightly dossier.</small>}{brief.entryFrequency.leadingBlock && <small>Leading block: {brief.entryFrequency.leadingBlock.reason} · {brief.entryFrequency.leadingBlock.opportunities} opportunities · {brief.entryFrequency.leadingBlock.scored} counterfactuals scored.</small>}</section>
      <section><h4>Native exit</h4><p>{brief.nativeExit.conclusion}</p><div className="atlas-inline-facts"><span>best move <b>{signed(brief.nativeExit.typicalBestMovePct, "%")}</b></span><span>return <b>{signed(brief.nativeExit.typicalReturnPct, "%")}</b></span><span>gave back <b>{signed(brief.nativeExit.typicalGivebackPoints, " pts")}</b></span><span>outlier share <b>{brief.nativeExit.outlierShare == null ? "—" : `${Math.round(brief.nativeExit.outlierShare * 100)}%`}</b></span></div></section>
      <section><h4>Manager alternatives</h4><p>{brief.managers.conclusion}</p>{brief.managers.compared.length > 0 && <div className="atlas-manager-table">{brief.managers.compared.map((row) => <span key={`${row.managerId}-${row.managerVersion}`}><b>{row.managerId}</b><em>{row.sessions}s / {row.pairedOpportunities} pairs</em><strong>{signed(row.typicalBenefitPct, " pts")}</strong><small>{row.improvementFrequency == null ? "—" : `${Math.round(row.improvementFrequency * 100)}%`} improved</small></span>)}</div>}</section>
      <section><h4>Capacity + collisions</h4><p>{brief.capacity.conclusion} {brief.collision.conclusion}</p><div className="atlas-capacity-strip">{brief.capacity.points.map((row) => <span key={row.contracts}><small>{row.contracts} CT</small><b>{money(row.portfolioTotalResultUsd)}</b><em>{row.deployedOpportunities}/{row.eligibleOpportunities} deployed · {money(row.portfolioMaxDrawdownUsd)} drawdown</em></span>)}</div></section>
      <section className="atlas-next"><h4>Next controlled move</h4><p>{brief.recommendation.nextExperiment}</p></section>
      <details className="atlas-boundary"><summary>Evidence boundary + limitations</summary><p>{brief.evidence.exactCurrentAvailable ? "The decision cohort is exact-current configuration evidence." : "Exact-current evidence is not the decision cohort; the recommendation is constrained accordingly."} Executed and virtual results are never pooled.</p><ul>{brief.evidence.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
    </div></details>
  </section>;
  return <section className={`atlas-preview ${model.tone}${compact ? " compact" : ""}`} aria-label="Decision Atlas channel summary">
    <header><span><small>{model.experiment ? "DECISION ATLAS · PROSPECTIVE TEST" : "DECISION ATLAS · HISTORICAL VIRTUAL"}</small><b>{model.label}</b></span><em>{model.experiment ? retuneEvidence?.status.replaceAll("_", " ").toUpperCase() ?? "CONTROL UNCHANGED" : "NOT EXECUTED"}</em></header>
    <p>{model.summary}</p>
    <div className="atlas-preview-metrics">{model.metrics.map((metric) => <span key={metric.label} title={metric.fact}><small>{metric.label}</small><b>{metric.value}</b></span>)}</div>
    <details><summary>{model.experiment ? "Experiment + evidence" : "Why this read?"}</summary><p>{model.evidenceFact}</p></details>
  </section>;
}
