import "@/app/decision-atlas.css";
import { buildFleetDecisionSummary } from "@/lib/research/channelDecisionSummary";
import type { DecisionAtlasReportsRead } from "@/hooks/useDecisionAtlasReports";

export function DecisionAtlasFleetPulse({ reports, purpose = "decision", channelSlugs }: {
  reports: DecisionAtlasReportsRead;
  purpose?: "decision" | "review" | "positions" | "operations";
  channelSlugs?: readonly string[];
}) {
  const scoped = channelSlugs
    ? Object.fromEntries(channelSlugs.flatMap((slug) => reports.bySlug[slug] ? [[slug, reports.bySlug[slug]]] : []))
    : reports.bySlug;
  const summary = buildFleetDecisionSummary(scoped, reports.throughSession);
  if (purpose === "positions" && summary.reports === 0) return null;
  if (purpose === "operations") return <section className="atlas-fleet-pulse operations" aria-label="Decision Atlas publication status">
    <span><small>NIGHTLY CHANNEL EVIDENCE</small><b>{reports.state === "ready" ? `${summary.reports} REPORTS · THROUGH ${summary.throughSession?.slice(5).replace("-", "/")}` : reports.state.toUpperCase()}</b></span>
    <em>READ ONLY</em>
  </section>;
  return <section className="atlas-fleet-pulse" aria-label="Latest channel decisions">
    <span><small>{purpose === "review" ? "LATEST NIGHTLY DECISIONS" : purpose === "positions" ? "OPEN CHANNEL CONTEXT" : "WHAT NEEDS REVIEW"}</small><b>{summary.lead ? `${summary.lead.channel} · ${summary.lead.disposition}` : reports.state === "ready" ? "NO NEW ACTION" : "REPORTS UNAVAILABLE"}</b></span>
    <div><span><b>{summary.investigate}</b><small>TEST</small></span><span><b>{summary.promoteOrRetire}</b><small>ROSTER</small></span><span><b>{summary.collecting}</b><small>COLLECT</small></span></div>
    <em>{summary.throughSession ? `THROUGH ${summary.throughSession.slice(5).replace("-", "/")}` : reports.state.toUpperCase()}</em>
  </section>;
}
