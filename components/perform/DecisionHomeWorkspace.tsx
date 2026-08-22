"use client";

import type { SurfaceProps } from "@/components/surfaceTypes";
import { SeveEvidenceContext, SeveWorkspaceHeader } from "@/components/ui/Seve909";
import { buildFleetDecisionSummary } from "@/lib/research/channelDecisionSummary";
import { signedUsd } from "@/lib/format";
import { axisForDisposition, type WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { decisionAtlasFreshnessShortLabel } from "@/lib/research/decisionAtlasFreshness";
import { summarizeChannelRuntimeRoster } from "@/lib/studio/channelRuntimeAuthority";

const pt = (value: string | null | undefined): string => value ? new Date(value).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}) + " PT" : "checking";

export function DecisionHomeWorkspace({ surface, onNavigate }: {
  surface: SurfaceProps;
  onNavigate: (destination: WorkspaceDestination) => void;
}) {
  const account = surface.accounts.find((row) => row.id === surface.acctId);
  const fleet = buildFleetDecisionSummary(surface.decisionAtlas.bySlug, surface.decisionAtlas.throughSession);
  const readiness = surface.opsReadiness.summary;
  const deskFlat = surface.feed.positions.length === 0;
  const roster = summarizeChannelRuntimeRoster(surface.channelControlPlane.view, surface.channelWorkspace.release.rootSlugs);
  const latestEvent = surface.data.events[0];
  const atlasLabel = decisionAtlasFreshnessShortLabel({
    freshness: surface.decisionAtlas.freshness,
    reportThroughSession: surface.decisionAtlas.throughSession,
  });
  const atlasStale = surface.decisionAtlas.state === "ready" && surface.decisionAtlas.freshness === "stale";
  const healthy = surface.incident.severity === "normal"
    && readiness.tone === "green"
    && surface.data.status !== "err"
    && surface.decisionAtlas.state === "ready"
    && !atlasStale;
  const evidenceQuality = readiness.tone !== "green" || surface.decisionAtlas.state === "error" || atlasStale ? "partial"
    : surface.decisionAtlas.state === "ready" ? "complete" : "checking";
  const operationalAttention = [
    surface.incident.severity !== "normal" ? { label: surface.incident.title, destination: { section: "ops" as const, check: "reconciliation" } } : null,
    surface.data.status === "err" ? { label: "Live market data needs review", destination: { section: "ops" as const } } : null,
    atlasStale ? { label: "Nightly channel decisions need a fresh close", destination: { section: "research" as const, researchMode: "decisions" as const } } : null,
    surface.decisionAtlas.state === "error" ? { label: "Nightly channel decisions could not be read", destination: { section: "research" as const, researchMode: "decisions" as const } } : null,
    readiness.tone !== "green" ? { label: readiness.detail, destination: { section: "ops" as const } } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 3);

  return <section className="decision-home" id="perform-overview" tabIndex={-1} aria-label="Decision Home">
    <SeveWorkspaceHeader title="DECISION HOME" subtitle="ready · changed · next" boundary="PAPER DESK" />
    <SeveEvidenceContext
      kind="mixed"
      scope={`${account?.name ?? "selected account"} + all-paper research`}
      asOf={pt(surface.feed.updatedAt ?? surface.data.lastIngestTs)}
      era={surface.channelControlPlane.view?.configurationEpochId ? "current configuration" : "sealed runtime"}
      sample={`${fleet.reports} channel reports`}
      quality={evidenceQuality}
      detail="Actual selected-account positions are kept separate from all-paper nightly research."
    />
    <section className={`decision-home-status ${healthy ? "healthy" : "attention"}`}>
      <span><small>DESK STATUS</small><b>{healthy ? "READY FOR THE NEXT SESSION" : "CHECK BEFORE THE NEXT SESSION"}</b><p>{deskFlat ? `${account?.name ?? "The selected paper account"} is flat.` : `${surface.feed.positions.length} selected-account paper positions remain open.`}</p></span>
      <div><span><small>TRADING</small><b>{readiness.tone === "green" ? "READY" : "NEEDS REVIEW"}</b></span><span><small>DATA</small><b>{surface.data.status === "err" ? "NEEDS REVIEW" : "AVAILABLE"}</b></span><span><small>RESEARCH</small><b>{surface.decisionAtlas.state === "ready" ? atlasLabel : surface.decisionAtlas.state.toUpperCase()}</b></span></div>
      <button type="button" onClick={() => onNavigate({ section: "ops" })}>OPEN SYSTEM STATUS</button>
    </section>
    <div className="decision-home-grid">
      <section className="decision-home-card changed"><header><small>01</small><b>WHAT CHANGED?</b></header>
        <ul>
          <li><small>ACTUAL ACCOUNT</small><b>Latest result</b><span>{signedUsd(surface.liveFund.dayPnl)} selected-account session NAV change.</span></li>
          <li><small>NIGHTLY RESEARCH · READ ONLY</small><b>Channel evidence</b><span>{fleet.reports} reports through {fleet.throughSession ?? "the latest close"}{atlasStale && surface.decisionAtlas.evidenceThroughSession ? `; raw paths continue through ${surface.decisionAtlas.evidenceThroughSession}.` : "."}</span></li>
          <li><small>CURRENT PAPER PLAN</small><b>{roster.paper} channels may trade</b><span>{roster.accounts != null ? `${roster.accounts} paper accounts · ` : ""}{roster.observing} research-only channels{roster.shortHash ? ` · roster ${roster.shortHash}` : ""}.</span></li>
        </ul>
        <button type="button" onClick={() => onNavigate({ section: "tape", reviewSection: "tape", session: fleet.throughSession ?? undefined })}>REVIEW THE LAST CLOSE</button>
      </section>
      <section className="decision-home-card attention"><header><small>02</small><b>WHAT NEEDS ATTENTION?</b></header>
        {operationalAttention.length ? <ol>{operationalAttention.map((item) => <li key={item.label}><button type="button" onClick={() => onNavigate(item.destination)}>{item.label}<span aria-hidden="true">→</span></button></li>)}</ol> : <p className="decision-home-clear">No operational blocker. The paper desk and reporting can continue.</p>}
        <button type="button" onClick={() => onNavigate({ section: "ops" })}>OPEN SYSTEM CHECKS</button>
      </section>
      <section className="decision-home-card next"><header><small>03</small><b>WHAT SHOULD I DO NEXT?</b></header>
        <small>NIGHTLY RESEARCH · PROPOSAL ONLY</small><strong>{fleet.lead ? `Review ${fleet.lead.channel}` : "Keep the current paper configuration"}</strong>
        <p>{fleet.lead ? `${fleet.lead.disposition}. Review one controlled move; nothing changes trading until separately approved.` : "No channel decision currently clears the evidence floor for immediate review."}</p>
        <div><button type="button" onClick={() => onNavigate(fleet.lead ? { section: "research", channel: fleet.lead.channel, axis: axisForDisposition(fleet.lead.disposition), researchMode: "decisions" } : { section: "sentinel" })}>{fleet.lead ? "REVIEW DECISION" : "OPEN NEXT-SESSION PLAN"}</button><button type="button" onClick={() => onNavigate({ section: "studio", channel: fleet.lead?.channel })}>OPEN CHANNEL</button></div>
      </section>
    </div>
    <details className="decision-home-technical"><summary><span><small>TECHNICAL CONTEXT</small><b>Current receipt and feed details</b></span><em>OPEN ONLY FOR TROUBLESHOOTING</em><i>▾</i></summary><div>
      <span><small>READINESS</small><b>{readiness.state}</b><em>{readiness.detail}</em></span>
      <span><small>LAST MARKET READ</small><b>{pt(surface.data.lastIngestTs)}</b><em>{surface.data.snapshot.length} observed contracts</em></span>
      <span><small>LATEST EVENT</small><b>{latestEvent ? pt(latestEvent.created_at) : "—"}</b><em>{latestEvent?.message ?? "no event"}</em></span>
    </div></details>
  </section>;
}
