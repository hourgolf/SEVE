"use client";

import { useEffect, useState } from "react";
import "@/app/decision-atlas.css";
import { buildDecisionAtlasPreview } from "@/lib/research/decisionAtlasPreview";
import { buildChannelDecisionSummary, type ChannelDecisionSummary } from "@/lib/research/channelDecisionSummary";
import type { ChannelManagerEvidence } from "@/lib/research/channelManagerEvidence";
import type { ChannelDryPowderCurve, ShadowChannelSummary } from "@/lib/research/shadowResearch";
import type { BoundedRetuneEvidence } from "@/lib/research/boundedRetuneExperiments";
import type { ChannelDecisionBrief } from "@/lib/research/channelDecisionBrief";
import type { EvidenceAxis } from "@/lib/shell/workspaceDestination";

type EvidenceView = "entry" | "exit" | "manager" | "size" | "sources";

const signed = (value: number | null, suffix = "") => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value * 10) / 10)}${suffix}`;
const money = (value: number | null) => value == null ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const pct = (value: number | null) => value == null ? "—" : `${Math.round(value * 100)}%`;

function EntrySequence({ model }: { model: ChannelDecisionSummary }) {
  const points = model.entry.points.slice(0, 6);
  const magnitude = Math.max(1, ...points.map((point) => Math.abs(point.typicalUsd ?? 0)));
  return <section className="atlas-view" aria-label="Entry sequence evidence">
    <header><b>DO LATER ENTRIES STILL HELP?</b><span>typical result per contract</span></header>
    <p>{model.entry.conclusion}</p>
    {points.length ? <div className="atlas-entry-sequence">{points.map((point) => {
      const value = point.typicalUsd ?? 0;
      return <span key={point.number} className={value > 0 ? "positive" : value < 0 ? "negative" : "neutral"}>
        <small>#{point.number}</small>
        <i style={{ height: `${Math.max(3, Math.round(Math.abs(value) / magnitude * 34))}px` }} />
        <b>{money(point.typicalUsd)}</b>
        <em>{point.sessions}s</em>
      </span>;
    })}</div> : <div className="atlas-empty">No comparable entry-order evidence yet.</div>}
  </section>;
}

function ExitCapture({ model }: { model: ChannelDecisionSummary }) {
  const best = Math.max(0, model.exit.bestMovePct ?? 0);
  const retained = Math.max(0, Math.min(best, model.exit.retainedPct ?? 0));
  const kept = best > 0 ? retained / best : 0;
  return <section className="atlas-view" aria-label="Native exit capture">
    <header><b>HOW MUCH OF THE MOVE DID THE EXIT KEEP?</b><span>typical opportunity</span></header>
    <p>{model.exit.conclusion}</p>
    <div className="atlas-capture-labels"><span>best move <b>{signed(model.exit.bestMovePct, "%")}</b></span><span>kept <b>{pct(Math.max(0, model.exit.capture ?? 0))}</b></span><span>gave back <b>{signed(model.exit.gaveBackPoints, " pts")}</b></span></div>
    <div className="atlas-capture-track" aria-label={`${pct(model.exit.capture)} of the typical best move retained`}>
      <i className="kept" style={{ width: `${Math.round(kept * 100)}%` }} />
      <i className="given" style={{ width: `${Math.round((1 - kept) * 100)}%` }} />
    </div>
    <div className="atlas-capture-legend"><span><i className="kept" /> retained</span><span><i className="given" /> gave back</span></div>
  </section>;
}

function ManagerComparison({ model, trail }: { model: ChannelDecisionSummary; trail?: ChannelDecisionBrief["trail"] }) {
  const challenger = model.manager.challenger;
  const leadingTrail = trail?.leading ?? null;
  return <section className="atlas-view" aria-label="Native manager versus leading challenger">
    <header><b>DOES A DIFFERENT EXIT WIN TYPICALLY?</b><span>same opportunities</span></header>
    <p>{model.manager.conclusion}</p>
    <div className="atlas-manager-duel">
      <span><small>CONTROL</small><b>NATIVE EXIT</b><strong>0 pts</strong><em>the bar to beat</em></span>
      <i>VS</i>
      <span><small>LEADING CHALLENGER</small><b>{challenger?.id ?? "NONE YET"}</b><strong>{signed(challenger?.typicalBenefitPct ?? null, " pts")}</strong><em>{challenger ? `${pct(challenger.improvementFrequency)} improved · ${challenger.sessions}s` : "no paired cohort"}</em></span>
    </div>
    {challenger && <div className={`atlas-manager-verdict ${challenger.robust ? "ready" : "hold"}`}>{challenger.robust ? "READY FOR A CONTROLLED PAPER TEST" : "NATIVE HOLDS · CHALLENGER IS NOT ROBUST YET"}</div>}
    {trail && <div className={`atlas-trail-callout ${trail.state}`}>
      <span><small>{trail.evidenceLayer === "virtual" ? "VIRTUAL TRAIL READ" : "EXECUTED TRAIL READ"}</small><b>{leadingTrail?.label ?? "NO COMPLETE TRAIL PATH"}</b></span>
      <span><small>TYPICAL LIFT</small><b>{signed(leadingTrail?.typicalBenefitPct ?? null, " pts")}</b></span>
      <span><small>CONSISTENCY</small><b>{leadingTrail ? `${pct(leadingTrail.improvementFrequency)} · ${leadingTrail.pairedOpportunities} paths / ${leadingTrail.sessions}s` : "—"}</b></span>
      <p>{trail.conclusion}</p>
      {trail.compared.length > 1 && <details><summary>Compare six bounded trail shapes</summary><div className="atlas-expert-table">
        {trail.compared.map((row) => <span key={row.candidateId}><b>{row.label}</b><em>{row.sessions}s · {row.pairedOpportunities} pairs</em><strong>{signed(row.typicalBenefitPct, " pts")}</strong><small>{row.verdict.toUpperCase()}</small></span>)}
      </div></details>}
    </div>}
    {model.manager.all.length > 1 && <div className="atlas-expert-table" role="table" aria-label="Complete manager comparison">
      {model.manager.all.map((row) => <span role="row" key={`${row.managerId}-${row.managerVersion}`}><b role="cell">{row.managerId}</b><em role="cell">{row.sessions}s · {row.pairedOpportunities} pairs</em><strong role="cell">{signed(row.typicalBenefitPct, " pts")}</strong><small role="cell">{pct(row.improvementFrequency)} improved</small></span>)}
    </div>}
  </section>;
}

function SizingSteps({ model }: { model: ChannelDecisionSummary }) {
  return <section className="atlas-view" aria-label="Marginal sizing evidence">
    <header><b>WHAT DOES EACH EXTRA CONTRACT ADD?</b><span>marginal value vs marginal risk</span></header>
    <p>{model.sizing.conclusion}</p>
    <div className="atlas-size-steps">{model.sizing.steps.map((step) => <span key={step.contracts} className={model.sizing.bestSupportedContracts === step.contracts ? "supported" : ""}>
      <small>{step.contracts} CT</small>
      <b>{step.contracts === 1 ? "BASELINE" : `${money(step.marginalResultUsd)} added`}</b>
      <em>{step.contracts === 1 ? `${pct(step.deploymentFrequency)} deployed` : `${money(step.marginalDrawdownUsd)} drawdown · ${step.displacedPeers} peer blocks`}</em>
    </span>)}</div>
  </section>;
}

function EvidenceSources({ model }: { model: ChannelDecisionSummary }) {
  const { sources } = model;
  return <section className="atlas-view" aria-label="Evidence sources and boundaries">
    <header><b>WHAT EVIDENCE SUPPORTS THIS?</b><span>sources remain separate</span></header>
    <div className="atlas-source-ladder">
      <span><small>CURRENT EXECUTED</small><b>{sources.executed.state === "available" ? `${sources.executed.sessions}s · ${sources.executed.logicalTrades} trades` : "NO CURRENT SAMPLE"}</b><em>{sources.executed.configurationEra ?? "no configuration era"}</em></span>
      <span><small>HISTORICAL VIRTUAL</small><b>{sources.historicalVirtual.state === "available" ? `${sources.historicalVirtual.sessions}s · ${sources.historicalVirtual.scored} paths` : "NO VIRTUAL SAMPLE"}</b><em>{sources.historicalVirtual.configurationEra ?? "no configuration era"}</em></span>
      <span><small>DECISION COHORT</small><b>{sources.decisionSessions}s · {sources.decisionOpportunities} opportunities</b><em>{sources.exactCurrentAvailable ? "exact current configuration" : sources.configurationEra}</em></span>
    </div>
    <p>{model.evidenceStateFact} Executed, virtual, and manager results are never pooled.</p>
    {sources.limitations.length > 0 && <ul>{sources.limitations.map((item) => <li key={item}>{item}</li>)}</ul>}
  </section>;
}

function AuthoritativeDecision({ brief, compact, focusAxis, onAxisChange }: { brief: ChannelDecisionBrief; compact: boolean; focusAxis?: EvidenceAxis; onAxisChange?: (axis: EvidenceAxis) => void }) {
  const [view, setView] = useState<EvidenceView>(focusAxis ?? "entry");
  const [expanded, setExpanded] = useState(Boolean(focusAxis));
  useEffect(() => {
    if (!focusAxis) return;
    setView(focusAxis);
    setExpanded(true);
  }, [focusAxis]);
  const model = buildChannelDecisionSummary(brief);
  return <section className={`atlas-preview authoritative decision-first${compact ? " compact" : ""}`} aria-label="Decision Atlas paired channel report">
    <header>
      <span><small>{model.sourceLabel} · THROUGH {model.throughSession.slice(5).replace("-", "/")}</small><b>{model.disposition}</b></span>
      <em>{model.evidenceState}</em>
    </header>
    <p className="atlas-diagnosis"><small>WHY</small>{model.diagnosis}</p>
    <div className="atlas-preview-metrics">{model.metrics.map((metric) => <span key={metric.label} title={metric.fact}><small>{metric.label}</small><b>{metric.value}</b></span>)}</div>
    <div className="atlas-plan">
      <span><small>NEXT CONTROLLED TEST</small><b>{model.nextTest}</b></span>
      <span><small>KEEP FIXED</small><b>{model.keepFixed.join(" · ")}</b></span>
    </div>
    {brief.learning && <div className="atlas-learning-state" title={brief.learning.fact}>
      <small>{brief.learning.label}</small>
      <span className={brief.learning.evidence === "ready" ? "ready" : "review"}>DATA {brief.learning.evidence === "ready" ? "READY" : "CHECK"}</span>
      <span className={brief.learning.experiment === "ready_to_score" ? "ready" : "neutral"}>TEST {brief.learning.experiment.replaceAll("_", " ").toUpperCase()}</span>
      <span className={brief.learning.capacity === "paper_step_ready" ? "ready" : "neutral"}>SIZE {brief.learning.capacity === "paper_step_ready" ? `${brief.learning.currentContracts ?? "?"}→${brief.learning.proposedContracts ?? "?"}` : "HOLD"}</span>
    </div>}
    <details className="atlas-evidence-drawer" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>See supporting evidence</summary><div className="atlas-brief-body">
      <nav aria-label="Decision evidence views">{(["entry", "exit", "manager", "size", "sources"] as EvidenceView[]).map((item) => <button key={item} type="button" className={view === item ? "on" : ""} aria-pressed={view === item} onClick={() => { setView(item); onAxisChange?.(item); }}>{item === "sources" ? "SOURCES" : item.toUpperCase()}</button>)}</nav>
      {view === "entry" && <EntrySequence model={model} />}
      {view === "exit" && <ExitCapture model={model} />}
      {view === "manager" && <ManagerComparison model={model} trail={brief.trail} />}
      {view === "size" && <SizingSteps model={model} />}
      {view === "sources" && <EvidenceSources model={model} />}
    </div></details>
  </section>;
}

export function DecisionAtlasPreviewCard({ brief, summary, dryPowder, managerEvidence, retuneEvidence, focusAxis, onAxisChange, compact = false }: {
  brief?: ChannelDecisionBrief | null;
  summary?: ShadowChannelSummary | null;
  dryPowder?: ChannelDryPowderCurve | null;
  managerEvidence?: ChannelManagerEvidence | null;
  retuneEvidence?: BoundedRetuneEvidence | null;
  focusAxis?: EvidenceAxis;
  onAxisChange?: (axis: EvidenceAxis) => void;
  compact?: boolean;
}) {
  const model = buildDecisionAtlasPreview({ summary, dryPowder, managerEvidence, retuneEvidence });
  if (brief) return <AuthoritativeDecision brief={brief} compact={compact} focusAxis={focusAxis} onAxisChange={onAxisChange} />;
  return <section className={`atlas-preview ${model.tone}${compact ? " compact" : ""}`} aria-label="Decision Atlas channel summary">
    <header><span><small>{model.experiment ? "PROSPECTIVE TEST" : "HISTORICAL VIRTUAL"}</small><b>{model.label}</b></span><em>{model.experiment ? retuneEvidence?.status.replaceAll("_", " ").toUpperCase() ?? "CONTROL UNCHANGED" : "NOT EXECUTED"}</em></header>
    <p>{model.summary}</p>
    <div className="atlas-preview-metrics">{model.metrics.slice(0, 3).map((metric) => <span key={metric.label} title={metric.fact}><small>{metric.label}</small><b>{metric.value}</b></span>)}</div>
    <details><summary>{model.experiment ? "See experiment evidence" : "See supporting evidence"}</summary><p>{model.evidenceFact}</p></details>
  </section>;
}
