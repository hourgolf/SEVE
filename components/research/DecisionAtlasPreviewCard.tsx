import "@/app/decision-atlas.css";
import { buildDecisionAtlasPreview } from "@/lib/research/decisionAtlasPreview";
import type { ChannelManagerEvidence } from "@/lib/research/channelManagerEvidence";
import type { ChannelDryPowderCurve, ShadowChannelSummary } from "@/lib/research/shadowResearch";

export function DecisionAtlasPreviewCard({ summary, dryPowder, managerEvidence, compact = false }: {
  summary?: ShadowChannelSummary | null;
  dryPowder?: ChannelDryPowderCurve | null;
  managerEvidence?: ChannelManagerEvidence | null;
  compact?: boolean;
}) {
  const model = buildDecisionAtlasPreview({ summary, dryPowder, managerEvidence });
  return <section className={`atlas-preview ${model.tone}${compact ? " compact" : ""}`} aria-label="Decision Atlas channel summary">
    <header><span><small>{model.experiment ? "DECISION ATLAS · PROSPECTIVE TEST" : "DECISION ATLAS · HISTORICAL VIRTUAL"}</small><b>{model.label}</b></span><em>{model.experiment ? "CONTROL UNCHANGED" : "NOT EXECUTED"}</em></header>
    <p>{model.summary}</p>
    <div className="atlas-preview-metrics">{model.metrics.map((metric) => <span key={metric.label} title={metric.fact}><small>{metric.label}</small><b>{metric.value}</b></span>)}</div>
    <details><summary>{model.experiment ? "Experiment + evidence" : "Why this read?"}</summary><p>{model.evidenceFact}</p></details>
  </section>;
}
