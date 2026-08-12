"use client";

import { useMemo, useState } from "react";
import type { DecisionAtlasReportsRead } from "@/hooks/useDecisionAtlasReports";
import {
  buildResearchCouncil,
  RESEARCH_AGENTS,
  selectResearchCouncilBrief,
  type ResearchAgentId,
  type ResearchDispatch,
} from "@/lib/research/researchCouncil";
import { axisForDisposition, type WorkspaceDestination } from "@/lib/shell/workspaceDestination";

const MAX_BRIEF_DISPATCHES = 5;
type RoomFilter = "brief" | "conflicts" | "all";

function AgentAvatar({ id }: { id: ResearchAgentId }) {
  const portraits: Record<ResearchAgentId, string[]> = {
    scout: ["..PPPP..", ".PPAAPP.", "PPAFFAPP", "PAFEEAFP", "PAAFFAAP", ".PFFFFP.", ".PP..PP.", "..P..P.."],
    harvester: ["P......P", "PP.PP.PP", ".PPAAPP.", ".PAFFAP.", "PPAEEAPP", "PAAFFAAP", ".PFFFFP.", "..PPPP.."],
    mechanic: ["PP....PP", ".PP..PP.", "..PAAP..", ".PAFFAP.", "PPAEEAPP", ".PAFFAP.", ".PPFFPP.", "PP....PP"],
    allocator: [".PP..PP.", "PPPPPPPP", "PPA..APP", "PAFFFFAP", "PAFEEFAP", "PAFFFFAP", "PPA..APP", ".PPPPPP."],
    skeptic: ["...PP...", "..PPPP..", ".PAAAAP.", "PAAFFAAP", "PAFEEAFP", "PAAFFAAP", ".PFFFFP.", "..P..P.."],
    designer: ["...P....", "..PPP...", ".PPAPP..", "PPAFAPP.", "PAFEEAFP", "PAFFFFAP", ".PAAAAAP", "..PPPP.."],
    arbiter: ["P.P..P.P", "PPPPPPPP", ".PAAAAP.", "PAFFFFAP", "PAFEEFAP", "PAFFFFAP", ".PA..AP.", "..PPPP.."],
  };
  return <span className={`rc-avatar agent-${id}`} aria-hidden="true">
    <svg viewBox="0 0 16 16" focusable="false">
      {portraits[id].flatMap((row, y) => [...row].map((cell, x) => cell === "." ? null
        : <rect key={`${x}-${y}`} className={`pixel-${cell.toLowerCase()}`} x={x * 2} y={y * 2} width="2" height="2" />))}
    </svg>
  </span>;
}

function DispatchCard({ dispatch, onOpen }: { dispatch: ResearchDispatch; onOpen?: (destination: WorkspaceDestination) => void }) {
  const agent = RESEARCH_AGENTS.find((row) => row.id === dispatch.agentId)!;
  return <article className={`rc-dispatch kind-${dispatch.kind}${dispatch.replyTo ? " reply" : ""}`}>
    <AgentAvatar id={dispatch.agentId} />
    <div className="rc-message">
      <header><span><b>{agent.callsign}</b><small>{agent.role}</small></span><em>{dispatch.confidence}</em></header>
      <strong>{dispatch.headline}</strong>
      <p>{dispatch.message}</p>
      <footer>
        <span>{dispatch.evidence.slice(0, 2).map((item) => <i key={`${item.label}-${item.value}`}><small>{item.label}</small><b>{item.value}</b></i>)}</span>
        {dispatch.channel ? <button type="button" onClick={() => onOpen?.({ section: "research", channel: dispatch.channel!, axis: axisForDisposition(dispatch.axis), researchMode: "decisions" })}>OPEN {dispatch.channel}<i aria-hidden="true">›</i></button> : null}
      </footer>
    </div>
  </article>;
}

export function ResearchCouncilRoom({ reports, onNavigate }: {
  reports: DecisionAtlasReportsRead;
  onNavigate?: (destination: WorkspaceDestination) => void;
}) {
  const [filter, setFilter] = useState<RoomFilter>("brief");
  const [expanded, setExpanded] = useState(false);
  const packet = useMemo(() => reports.throughSession && Object.keys(reports.bySlug).length
    ? buildResearchCouncil({
      throughSession: reports.throughSession,
      generatedAt: Object.values(reports.bySlug)[0]?.generatedAt ?? `${reports.throughSession}T22:00:00.000Z`,
      briefs: reports.bySlug,
    }) : null, [reports.bySlug, reports.throughSession]);
  if (!packet) return null;
  const brief = selectResearchCouncilBrief(packet, MAX_BRIEF_DISPATCHES);
  const filtered = filter === "conflicts"
    ? packet.dispatches.filter((row) => row.kind === "challenge")
    : filter === "brief"
      ? brief
      : packet.dispatches;
  const collapsedLimit = filter === "brief" ? MAX_BRIEF_DISPATCHES : 10;
  const displayed = expanded ? filtered : filtered.slice(0, collapsedLimit);
  return <section className="research-council" aria-label="Nightly research agent room">
    <header className="rc-head">
      <span><small>NIGHTLY RESEARCH ROOM · THROUGH {packet.throughSession.slice(5).replace("-", "/")}</small><b>{packet.summary.headline}</b></span>
      <div className="rc-roster" aria-label={`${packet.agents.length} research agents`}>{packet.agents.map((agent) => <span key={agent.id} title={`${agent.name} · ${agent.role}`}><AgentAvatar id={agent.id} /></span>)}</div>
      <em>READ ONLY</em>
    </header>
    <div className="rc-pulse">
      <span><b>{packet.summary.channelsReviewed}</b><small>CHANNELS CHECKED</small></span>
      <span className={packet.summary.conflicts ? "warn" : ""}><b>{packet.summary.conflicts}</b><small>CONFLICTS</small></span>
      <span><b>{brief.length}</b><small>IN THIS BRIEF</small></span>
      <nav aria-label="Research room filter">
        <button type="button" className={filter === "brief" ? "on" : ""} onClick={() => { setFilter("brief"); setExpanded(false); }}>BRIEF</button>
        <button type="button" className={filter === "conflicts" ? "on" : ""} onClick={() => setFilter("conflicts")}>CONFLICTS</button>
        <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>ALL</button>
      </nav>
    </div>
    <div className="rc-feed">
      {displayed.map((dispatch) => <DispatchCard key={dispatch.id} dispatch={dispatch} onOpen={onNavigate} />)}
      {!displayed.length ? <p className="rc-quiet">No conflicts in the current nightly packet.</p> : null}
    </div>
    {filtered.length > collapsedLimit ? <button type="button" className="rc-more" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? `SHOW SHORT ${filter.toUpperCase()}` : `SHOW ${filtered.length - collapsedLimit} MORE`}</button> : null}
    <details className="rc-method"><summary>HOW THIS ROOM WORKS <i>▾</i></summary><p>Specialists read the same frozen channel briefs from different angles. GHOST challenges contradictions. CHIEF ranks the unresolved evidence. Messages are generated from linked metrics and cannot change trading behavior.</p></details>
  </section>;
}
