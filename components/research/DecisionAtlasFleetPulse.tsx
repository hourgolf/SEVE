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
  if (purpose === "positions" && summary.reports === 0) return null;
  if (purpose === "operations") return <section className="atlas-fleet-pulse operations" aria-label="Decision Atlas publication status">
    <span><small>NIGHTLY CHANNEL EVIDENCE</small><b>{reports.state === "ready" ? `${summary.reports} REPORTS · ${freshnessLabel}` : reports.state.toUpperCase()}</b></span>
    <em>READ ONLY</em>
  </section>;
  return <section className="atlas-fleet-pulse" aria-label="Latest channel decisions">
    <button type="button" className="atlas-fleet-lead" disabled={!summary.lead || !onNavigate} onClick={() => summary.lead && onNavigate?.({ section: "research", channel: summary.lead.channel, axis: axisForDisposition(summary.lead.disposition), researchMode: "decisions" })}><small>{purpose === "review" ? "LATEST NIGHTLY DECISIONS" : purpose === "positions" ? "OPEN CHANNEL CONTEXT" : "WHAT NEEDS REVIEW"}</small><b>{summary.lead ? `${summary.lead.channel} · ${summary.lead.disposition}` : reports.state === "ready" ? "NO NEW ACTION" : "REPORTS UNAVAILABLE"}</b></button>
    <div><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ section: "research", researchMode: "decisions", researchFilter: "promising" })}><b>{summary.investigate}</b><small>TEST</small></button><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ section: "research", researchMode: "decisions", researchFilter: "review" })}><b>{summary.promoteOrRetire}</b><small>ROSTER</small></button><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ section: "research", researchMode: "decisions", researchFilter: "collecting" })}><b>{summary.collecting}</b><small>COLLECT</small></button></div>
    <em>{reports.state === "ready" ? freshnessLabel : reports.state.toUpperCase()}</em>
  </section>;
}
