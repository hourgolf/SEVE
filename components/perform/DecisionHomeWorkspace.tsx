"use client";

import type { SurfaceProps } from "@/components/surfaceTypes";
import { SeveEvidenceContext, SeveWorkspaceHeader } from "@/components/ui/Seve909";
import { buildFleetDecisionSummary } from "@/lib/research/channelDecisionSummary";
import { signedUsd } from "@/lib/format";
import { axisForDisposition, type WorkspaceDestination } from "@/lib/shell/workspaceDestination";
import { decisionAtlasFreshnessShortLabel } from "@/lib/research/decisionAtlasFreshness";

const pt = (value: string | null | undefined): string => value ? new Date(value).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}) + " PT" : "checking";

const plainChange = (message: string): string => {
  if (/shadow-publish: day-report done/i.test(message)) return "The day report finished; Atlas and the next-session brief have separate checks.";
  if (/stream: boot/i.test(message)) return "The paper worker restarted and reported its active release.";
  if (/rc54-release ACTIVE/i.test(message)) return "The current paper release was observed running.";
  return "New operational evidence was recorded.";
};

export function DecisionHomeWorkspace({ surface, onNavigate }: {
  surface: SurfaceProps;
  onNavigate: (destination: WorkspaceDestination) => void;
}) {
  const account = surface.accounts.find((row) => row.id === surface.acctId);
  const fleet = buildFleetDecisionSummary(surface.decisionAtlas.bySlug, surface.decisionAtlas.throughSession);
  const readiness = surface.opsReadiness.summary;
  const deskFlat = surface.feed.positions.length === 0;
  const healthy = surface.incident.severity === "normal" && readiness.tone !== "red";
  const latestEvent = surface.data.events[0];
  const atlasLabel = decisionAtlasFreshnessShortLabel({
    freshness: surface.decisionAtlas.freshness,
    reportThroughSession: surface.decisionAtlas.throughSession,
  });
  const atlasStale = surface.decisionAtlas.state === "ready" && surface.decisionAtlas.freshness === "stale";
  const researchVerified = surface.decisionAtlas.state === "ready"
    && surface.decisionAtlas.publication?.state === "verified" && surface.decisionAtlas.freshness === "current";
  const researchLabel = surface.decisionAtlas.state === "ready"
    ? atlasStale ? atlasLabel : researchVerified ? `VERIFIED · ${surface.decisionAtlas.throughSession?.slice(5).replace("-", "/")}` : "BUNDLE UNVERIFIED"
    : surface.decisionAtlas.state.toUpperCase();
  const evidenceQuality = readiness.tone === "red" || surface.decisionAtlas.state === "error" || atlasStale || !researchVerified ? "partial"
    : "complete";
  const attention = [
    surface.incident.severity !== "normal" ? { label: surface.incident.title, destination: { section: "ops" as const, check: "reconciliation" } } : null,
    atlasStale ? { label: "Nightly channel decisions need a fresh close", destination: { section: "research" as const, researchMode: "decisions" as const } } : null,
    !atlasStale && !researchVerified ? { label: "Channel publication needs verification", destination: { section: "ops" as const } } : null,
    researchVerified && fleet.lead ? { label: `${fleet.lead.channel}: ${fleet.lead.disposition.toLowerCase()}`, destination: { section: "research" as const, channel: fleet.lead.channel, axis: axisForDisposition(fleet.lead.disposition), researchMode: "decisions" as const } } : null,
    readiness.tone === "red" ? { label: readiness.detail, destination: { section: "ops" as const } } : null,
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
    <section className={`decision-home-status ${healthy && researchVerified ? "healthy" : "attention"}`}>
      <span><small>DESK STATUS</small><b>{healthy ? researchVerified ? "PAPER DESK READY" : "PAPER DESK READY · RESEARCH NEEDS REVIEW" : "CHECK BEFORE THE NEXT SESSION"}</b><p>{deskFlat ? `${account?.name ?? "The selected paper account"} is flat.` : `${surface.feed.positions.length} selected-account paper positions remain open.`}</p></span>
      <div><span data-review={readiness.tone === "red"}><small>TRADING</small><b>{readiness.tone === "red" ? "NEEDS REVIEW" : "READY"}</b></span><span data-review={surface.data.status === "err"}><small>DATA</small><b>{surface.data.status === "err" ? "NEEDS REVIEW" : "AVAILABLE"}</b></span><span data-review={!researchVerified}><small>RESEARCH</small><b>{researchLabel}</b></span></div>
      <button type="button" onClick={() => onNavigate({ section: "ops" })}>OPEN SYSTEM STATUS</button>
    </section>
    <div className="decision-home-grid">
      <section className="decision-home-card changed"><header><small>01</small><b>WHAT CHANGED?</b></header>
        <ul>
          <li><b>Latest result</b><span>{signedUsd(surface.liveFund.dayPnl)} selected-account session NAV change.</span></li>
          <li><b>Channel evidence</b><span>{fleet.reports} reports through {fleet.throughSession ?? "the latest close"}{atlasStale && surface.decisionAtlas.evidenceThroughSession ? `; raw paths continue through ${surface.decisionAtlas.evidenceThroughSession}.` : "."}</span></li>
          <li><b>Platform</b><span>{latestEvent ? plainChange(latestEvent.message) : "No new operational event is available."}</span></li>
        </ul>
        <button type="button" onClick={() => onNavigate({ section: "tape", reviewSection: "tape", session: fleet.throughSession ?? undefined })}>REVIEW THE LAST CLOSE</button>
      </section>
      <section className="decision-home-card attention"><header><small>02</small><b>WHAT NEEDS ATTENTION?</b></header>
        {attention.length ? <ol>{attention.map((item) => <li key={item.label}><button type="button" onClick={() => onNavigate(item.destination)}>{item.label}<span aria-hidden="true">→</span></button></li>)}</ol> : <p className="decision-home-clear">No urgent operator action. Continue collecting channel evidence.</p>}
        <button type="button" onClick={() => onNavigate(fleet.lead ? { section: "research", channel: fleet.lead.channel, axis: axisForDisposition(fleet.lead.disposition), researchMode: "decisions" } : { section: "sentinel" })}>{fleet.lead ? "OPEN CHANNEL DECISIONS" : "OPEN NEXT-SESSION BRIEF"}</button>
      </section>
      <section className="decision-home-card next"><header><small>03</small><b>WHAT SHOULD I DO NEXT?</b></header>
        <strong>{!researchVerified ? "Verify the latest close" : fleet.lead ? `Review ${fleet.lead.channel}` : "Keep the current paper configuration"}</strong>
        <p>{!researchVerified ? "Refresh and verify the nightly bundle before making a channel decision." : fleet.lead ? `${fleet.lead.disposition}. Compare the supporting evidence before preparing a controlled proposal.` : "No channel decision currently clears the evidence floor for immediate review."}</p>
        <div><button type="button" onClick={() => onNavigate(researchVerified ? { section: "studio", channel: fleet.lead?.channel } : { section: "ops" })}>{researchVerified ? "OPEN CHANNEL" : "CHECK RESEARCH"}</button><button type="button" onClick={() => onNavigate({ section: "market" })}>OPEN MARKETS</button></div>
      </section>
    </div>
    <details className="decision-home-technical"><summary><span><small>TECHNICAL CONTEXT</small><b>Current receipt and feed details</b></span><em>OPEN ONLY FOR TROUBLESHOOTING</em><i>▾</i></summary><div>
      <span><small>READINESS</small><b>{readiness.state}</b><em>{readiness.detail}</em></span>
      <span><small>LAST MARKET READ</small><b>{pt(surface.data.lastIngestTs)}</b><em>{surface.data.snapshot.length} observed contracts</em></span>
      <span><small>LATEST EVENT</small><b>{latestEvent ? pt(latestEvent.created_at) : "—"}</b><em>{latestEvent?.message ?? "no event"}</em></span>
    </div></details>
  </section>;
}
