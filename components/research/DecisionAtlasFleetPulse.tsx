import "@/app/decision-atlas.css";
import { buildFleetDecisionSummary } from "@/lib/research/channelDecisionSummary";
import type { DecisionAtlasReportsRead } from "@/hooks/useDecisionAtlasReports";
import { axisForDisposition, type WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { decisionAtlasFreshnessLabel } from "@/lib/research/decisionAtlasFreshness";

export function DecisionAtlasFleetPulse({ reports, purpose = "decision", channelSlugs, onNavigate }: {
  reports: DecisionAtlasReportsRead;
  purpose?: "decision" | "review" | "positions" | "operations";
  channelSlugs?: readonly string[];
  onNavigate?: (destination: WorkspaceDestination) => void;
}) {
  const scoped = channelSlugs
    ? Object.fromEntries(channelSlugs.flatMap((slug) => reports.bySlug[slug] ? [[slug, reports.bySlug[slug]]] : []))
    : reports.bySlug;
  const summary = buildFleetDecisionSummary(scoped, reports.throughSession);
  const freshnessLabel = decisionAtlasFreshnessLabel({ freshness: reports.freshness, reportThroughSession: reports.throughSession, evidenceThroughSession: reports.evidenceThroughSession });
  const throughLabel = reports.throughSession ? `THROUGH ${reports.throughSession}` : freshnessLabel;
  if (purpose === "positions" && summary.reports === 0) return null;
  if (purpose === "operations") return <section className="atlas-fleet-pulse operations" aria-label="Decision Atlas publication status">
    <span><small>NIGHTLY RESEARCH · READ ONLY</small><b>{reports.state === "ready" ? `${summary.reports} CHANNEL BRIEFS · ${throughLabel}` : reports.state.toUpperCase()}</b></span>
    <em>READ ONLY</em>
  </section>;
  return <section className="atlas-fleet-pulse" aria-label="Latest channel decisions">
    <button type="button" className="atlas-fleet-lead" disabled={!summary.lead || !onNavigate} onClick={() => summary.lead && onNavigate?.({ section: "research", channel: summary.lead.channel, axis: axisForDisposition(summary.lead.disposition), researchMode: "decisions" })}><small>{purpose === "positions" ? "OPEN POSITION · NIGHTLY CONTEXT" : "NEXT CHANNEL DECISION · NIGHTLY RESEARCH"}</small><b>{summary.lead ? `${summary.lead.channel} · ${summary.lead.disposition}` : reports.state === "ready" ? "NO CHANNEL DECISION DUE" : "NIGHTLY RESEARCH UNAVAILABLE"}</b></button>
    <div><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ section: "research", researchMode: "decisions", researchFilter: "promising" })}><b>{summary.investigate}</b><small>TESTS TO REVIEW</small></button><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ section: "research", researchMode: "decisions", researchFilter: "review" })}><b>{summary.promoteOrRetire}</b><small>ROSTER CALLS</small></button><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ section: "research", researchMode: "decisions", researchFilter: "collecting" })}><b>{summary.collecting}</b><small>STILL COLLECTING</small></button></div>
    <em>{reports.state === "ready" ? `${throughLabel} · READ ONLY` : reports.state.toUpperCase()}</em>
  </section>;
}
