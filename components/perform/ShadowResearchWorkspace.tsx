"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { buildDecisionAtlasPreview } from "@/lib/research/decisionAtlasPreview";
import { ChannelDryPowderCurve } from "@/components/research/ChannelDryPowderCurve";
import { ChannelManagerEvidencePanel } from "@/components/research/ChannelManagerEvidencePanel";
import { DecisionAtlasPreviewCard } from "@/components/research/DecisionAtlasPreviewCard";
import { CurrentEvidenceCard } from "@/components/research/CurrentEvidenceCard";
import { ManagerFleetHeatmap } from "@/components/research/ManagerFleetHeatmap";
import { exactShadowReceipt } from "@/lib/research/exactShadowArchive";
import type {
  ShadowChannelSummary,
  ShadowChannelSortDirection,
  ShadowChannelSortKey,
  ShadowSessionSummary,
} from "@/lib/research/shadowResearch";
import { shadowSessionDate, sortShadowChannelSummaries } from "@/lib/research/shadowResearch";
import { signedUsd } from "@/lib/format";

const percent = (wins: number, scored: number): string =>
  scored ? `${Math.round((1000 * wins) / scored) / 10}%` : "—";
const money = (value: number | null): string => value == null ? "—" : signedUsd(value);
const shortSession = (session: string): string => session.slice(5).replace("-", "/");
const RECENT_SESSION_LIMIT = 4;
type ResearchLane = "vb" | "all";
type EvidenceLabel = "HISTORICAL VIRTUAL" | "SESSION VIRTUAL";
const laneTotals = (rows: ShadowChannelSummary[]) => {
  const scored = rows.reduce((sum, row) => sum + row.scored, 0);
  const pnl = rows.reduce((sum, row) => sum + row.pnlPerContract, 0);
  return {
    paths: rows.reduce((sum, row) => sum + row.paths, 0),
    scored,
    winners: rows.reduce((sum, row) => sum + row.winners, 0),
    targets: rows.reduce((sum, row) => sum + row.targets, 0),
    stops: rows.reduce((sum, row) => sum + row.stops, 0),
    pnl,
    average: scored ? pnl / scored : null,
  };
};

function ExactStatus({ surface, session }: { surface: SurfaceProps; session: string }) {
  const archived = exactShadowReceipt(session);
  const current = surface.sentinel.operatorPacket?.session === session
    ? surface.sentinel.operatorPacket.darkBook
    : null;
  if (archived) return <section className={`srw-exact ${archived.state}`}>
    <header><span><b>EXACT MANAGER REPLAY</b><small>{archived.basis}</small></span><em>{archived.state.toUpperCase()}</em></header>
    <div className="srw-kpis">
      <span><small>RAW CLOCKS</small><b>{archived.rawCandidates}</b></span>
      <span><small>EXACT ELIGIBLE</small><b>{archived.exactEligible}</b></span>
      <span><small>CENSORED</small><b>{archived.exactCensored}</b></span>
      <span><small>MANAGER ARMS</small><b>{archived.completedManagerArms}/{archived.expectedManagerArms}</b></span>
      <span><small>INDEPENDENT PATHS</small><b>{archived.independentManagerPaths}</b></span>
      <span><small>VB PATHS</small><b>{archived.vbManagerPaths}</b></span>
    </div>
    <div className="srw-manager-list">
      {archived.managers.map((manager) => <div key={manager.managerId}>
        <b>{manager.managerId}</b><span>{manager.paths} paths</span><span>{percent(manager.winners, manager.paths)} win</span>
        <strong className={manager.averagePerPath >= 0 ? "pos" : "neg"}>{money(manager.averagePerPath)}/path</strong>
      </div>)}
    </div>
    <div className="srw-interactions">
      <b>CHANNEL × MANAGER SIGNALS</b>
      {archived.interactions.map((row) => <span key={`${row.slug}-${row.managerId}`}>
        <strong>{row.slug}</strong><em>{row.managerId} · {row.paths} paths</em>
        <small>{money(row.managerPnlPerContract)} vs bell {money(row.bellPnlPerContract)} · {row.note}</small>
      </span>)}
    </div>
    <footer>EXACT GAPS CENSORED · READ ONLY</footer>
  </section>;
  if (current) return <section className={`srw-exact ${current.state}`}>
    <header><span><b>EXACT MANAGER REPLAY</b><small title={current.source}>CURRENT SESSION</small></span><em>{current.state.replaceAll("_", " ").toUpperCase()}</em></header>
    <div className="srw-kpis">
      <span><small>RAW CLOCKS</small><b>{current.rawDecisions}</b></span>
      <span><small>CONTRACTS</small><b>{current.exactContracts}</b></span>
      <span><small>SOURCE CENSORS</small><b>{current.sourceCensors}</b></span>
      <span><small>EXACT ELIGIBLE</small><b>{current.exactEligible ?? "—"}</b></span>
      <span><small>EXACT CENSORS</small><b>{current.exactCensored ?? "—"}</b></span>
      <span><small>INDEPENDENT PATHS</small><b>{current.independentManagerPaths ?? "—"}</b></span>
    </div>
    <p title={current.detail}>T+1 exact replay pending; same-day outcomes remain provisional.</p>
  </section>;
  return <section className="srw-exact missing"><header><span><b>EXACT MANAGER REPLAY</b><small>no session-matched receipt</small></span><em>MISSING</em></header>
    <p>The native ledger is visible, but no exact manager receipt is attached to this session.</p></section>;
}

export function NativeTable({
  rows,
  selectable = false,
  excluded = [],
  onToggle,
  onToggleAll,
  selectedSlug,
  onInspect,
  renderDetail,
  evidenceLabel,
}: {
  rows: ShadowChannelSummary[];
  selectable?: boolean;
  excluded?: string[];
  onToggle?: (slug: string) => void;
  onToggleAll?: () => void;
  selectedSlug?: string;
  onInspect?: (slug: string) => void;
  renderDetail?: (slug: string) => ReactNode;
  evidenceLabel: EvidenceLabel;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ShadowChannelSortKey>("average");
  const [sortDirection, setSortDirection] = useState<ShadowChannelSortDirection>("desc");
  const selectedCount = rows.filter((row) => !excluded.includes(row.slug)).length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matched = normalized
      ? rows.filter((row) => row.slug.toLowerCase().includes(normalized))
      : rows;
    return sortShadowChannelSummaries(matched, sortKey, sortDirection);
  }, [query, rows, sortDirection, sortKey]);
  const chooseSort = (key: ShadowChannelSortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "channel" ? "asc" : "desc");
  };
  const sortLabel = (key: ShadowChannelSortKey, label: string) => <button
    type="button"
    className={`srw-sort${sortKey === key ? " on" : ""}`}
    aria-label={`Sort by ${label}${sortKey === key ? `, currently ${sortDirection}ending` : ""}`}
    onClick={() => chooseSort(key)}
  >{label}{sortKey === key ? <i aria-hidden="true">{sortDirection === "asc" ? "▲" : "▼"}</i> : null}</button>;
  return <div className="srw-table">
    <div className="srw-table-controls">
      <label><span>FILTER</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="channel name" aria-label="Filter research channels" /></label>
      <label><span>SORT</span><select value={sortKey} onChange={(event) => chooseSort(event.target.value as ShadowChannelSortKey)} aria-label="Sort research channels"><option value="channel">CHANNEL</option><option value="paths">PATHS</option><option value="win">WIN</option><option value="average">TYPICAL/CT</option><option value="total">TOTAL/CT</option><option value="mfe">BEST MOVE</option><option value="exits">EXITS</option></select></label>
      <button type="button" className="srw-sort-direction" onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")} aria-label={`Change sort direction, currently ${sortDirection}ending`}>{sortDirection === "asc" ? "ASC ▲" : "DESC ▼"}</button>
      {query ? <em>{visibleRows.length}/{rows.length} MATCH</em> : null}
    </div>
    <div className="srw-table-head"><span className="srw-channel-cell">{selectable ? <button type="button" className="srw-check" aria-pressed={allSelected} aria-label={allSelected ? "Exclude all strategies from summary" : "Include all strategies in summary"} onClick={onToggleAll}><i /></button> : null}{sortLabel("channel", "CHANNEL")}</span><span>{sortLabel("paths", "PATHS")}</span><span>{sortLabel("win", "WIN")}</span><span>{sortLabel("average", "TYPICAL/CT")}</span><span>{sortLabel("total", "TOTAL/CT")}</span><span>{sortLabel("mfe", "BEST MOVE")}</span><span>{sortLabel("exits", "EXITS")}</span></div>
    {rows.length === 0 ? <div className="srw-empty">no same-session paths in this lane</div> : visibleRows.length === 0 ? <div className="srw-empty">no channels match “{query.trim()}”</div> : visibleRows.map((row) => <Fragment key={row.slug}>
      <div className={`srw-row${selectedSlug === row.slug ? " selected" : ""}`}>
        <b className={`srw-channel-cell${selectable && excluded.includes(row.slug) ? " excluded" : ""}`}>{selectable ? <button type="button" className="srw-check" aria-pressed={!excluded.includes(row.slug)} aria-label={`${excluded.includes(row.slug) ? "Include" : "Exclude"} ${row.slug} in cumulative summary`} onClick={() => onToggle?.(row.slug)}><i /></button> : null}<span className="srw-channel-identity">{onInspect ? <button type="button" className="srw-channel-open" aria-pressed={selectedSlug === row.slug} onClick={() => onInspect(row.slug)}>{row.slug}</button> : <span>{row.slug}</span>}<small>{evidenceLabel} · THRU {shortSession(shadowSessionDate(row.lastAt))}</small></span></b><span className="srw-cell-paths">{row.scored}/{row.paths}</span><span className="srw-cell-win">{percent(row.winners, row.scored)}</span>
        <strong className={`srw-cell-avg ${(row.typicalPerPath ?? 0) >= 0 ? "pos" : "neg"}`}>{money(row.typicalPerPath)}</strong>
        <span className="srw-cell-total">{money(row.pnlPerContract)}</span><span className="srw-cell-mfe">{row.averageMfePct == null ? "—" : `${row.averageMfePct}%`}</span>
        <span className="srw-cell-exits">{row.targets}T · {row.stops}S · {row.flattens}B</span>
      </div>
      {selectedSlug === row.slug && renderDetail ? <div className="srw-inline-detail" aria-label={`${row.slug} channel evidence`}>{renderDetail(row.slug)}</div> : null}
    </Fragment>)}
  </div>;
}

export function ShadowResearchWorkspace({ surface, compact = false }: { surface: SurfaceProps; compact?: boolean }) {
  const { shadowResearch } = surface;
  const [session, setSession] = useState("");
  const [lane, setLane] = useState<ResearchLane>("vb");
  const [windowMode, setWindowMode] = useState<"day" | "cumulative">("day");
  const [excluded, setExcluded] = useState<Record<ResearchLane, string[]>>({ vb: [], all: [] });
  const [focusSlug, setFocusSlug] = useState("");
  useEffect(() => {
    if (!session && shadowResearch.sessions.length) setSession(shadowResearch.sessions[0].session);
  }, [session, shadowResearch.sessions]);
  const selected = useMemo<ShadowSessionSummary | null>(
    () => shadowResearch.sessions.find((item) => item.session === session) ?? shadowResearch.sessions[0] ?? null,
    [session, shadowResearch.sessions],
  );
  const recentSessions = shadowResearch.sessions.slice(0, RECENT_SESSION_LIMIT);
  const historicalSessions = shadowResearch.sessions.slice(RECENT_SESSION_LIMIT);
  const historicalSession = historicalSessions.some((item) => item.session === selected?.session)
    ? selected?.session ?? ""
    : "";
  const native = windowMode === "cumulative" ? shadowResearch.cumulative : selected;
  const rows = native ? (lane === "vb" ? native.vb : native.dark) : [];
  const filteredRows = windowMode === "cumulative"
    ? rows.filter((row) => !excluded[lane].includes(row.slug))
    : rows;
  const totals = laneTotals(filteredRows);
  const atlasReads = rows.map((row) => ({
    slug: row.slug,
    read: buildDecisionAtlasPreview({
      summary: row,
      dryPowder: windowMode === "cumulative"
        ? shadowResearch.dryPowderBySlug[row.slug]
        : selected ? shadowResearch.dryPowderBySession[selected.session]?.[row.slug] : undefined,
      managerEvidence: surface.managerEvidence.book?.channels[row.slug],
    }),
  }));
  const atlasWorking = atlasReads.filter((item) => item.read.label === "TEST CAPACITY" || item.read.label === "REVIEW MANAGER");
  const atlasReview = atlasReads.filter((item) => item.read.label === "REVIEW ENTRY" || item.read.label === "REVIEW EXIT");
  const atlasNext = [...atlasWorking, ...atlasReview][0] ?? null;
  const focusedCurve = windowMode === "cumulative"
    ? shadowResearch.dryPowderBySlug[focusSlug]
    : selected ? shadowResearch.dryPowderBySession[selected.session]?.[focusSlug] : undefined;
  const focusedPassport = surface.channelWorkspace.bySlug[focusSlug];
  const focusedSummary = rows.find((row) => row.slug === focusSlug);
  const focusedManagerEvidence = surface.managerEvidence.book?.channels[focusSlug];
  const focusedExecuted = shadowResearch.currentExecutedBySlug[focusSlug];
  const focusedComparison = shadowResearch.pairedCurrent.find((item) =>
    item.executedSlug === focusSlug || item.virtualSlug === focusSlug);
  const focusedLead = focusedCurve?.points[0]?.marginalAveragePerPath ?? null;
  const focusedBestManager = focusedManagerEvidence?.managers
    .filter((manager) => manager.medianDeltaPct != null)
    .sort((left, right) => (right.medianDeltaPct ?? -Infinity) - (left.medianDeltaPct ?? -Infinity))[0];
  useEffect(() => {
    if (!rows.length) { setFocusSlug(""); return; }
    if (!rows.some((row) => row.slug === focusSlug)) setFocusSlug(rows[0].slug);
  }, [focusSlug, rows]);
  const runningRows = shadowResearch.cumulative
    ? (lane === "vb" ? shadowResearch.cumulative.vb : shadowResearch.cumulative.dark)
    : [];
  const filteredRunningRows = windowMode === "cumulative"
    ? runningRows.filter((row) => !excluded[lane].includes(row.slug))
    : runningRows;
  const running = laneTotals(filteredRunningRows);
  const nativeTitle = windowMode === "cumulative" && shadowResearch.cumulative
    ? `HISTORICAL VIRTUAL PATHS · ${shadowResearch.cumulative.fromSession} → ${shadowResearch.cumulative.throughSession}`
    : `SESSION VIRTUAL PATHS · ${selected?.session ?? "—"}`;
  const toggleStrategy = (slug: string) => setExcluded((previous) => ({
    ...previous,
    [lane]: previous[lane].includes(slug)
      ? previous[lane].filter((item) => item !== slug)
      : [...previous[lane], slug],
  }));
  const toggleAllStrategies = () => setExcluded((previous) => ({
    ...previous,
    [lane]: rows.length > 0 && filteredRows.length === rows.length ? rows.map((row) => row.slug) : [],
  }));

  return <section className={`srw${compact ? " compact" : ""}`} id="perform-research" tabIndex={-1} aria-label="Shadow research workspace">
    <header className="srw-head"><span><b>SHADOW LEDGER</b><small>ALL PAPER · NATIVE NOW · EXACT T+1</small></span>
      <em>READ ONLY</em></header>
    <div className="srw-controls">
      <nav className="srw-sessions" aria-label="research session">
        {recentSessions.map((item) => <button type="button" key={item.session} className={windowMode === "day" && selected?.session === item.session ? "on" : ""} onClick={() => { setSession(item.session); setWindowMode("day"); }}>{shortSession(item.session)}</button>)}
        {historicalSessions.length ? <label className={`srw-history${windowMode === "day" && historicalSession ? " on" : ""}`}>
          <select aria-label="Older research session" value={historicalSession} onChange={(event) => {
            if (!event.target.value) return;
            setSession(event.target.value);
            setWindowMode("day");
          }}>
            <option value="">HISTORY · {historicalSessions.length}</option>
            {historicalSessions.map((item) => <option key={item.session} value={item.session}>{shortSession(item.session)}</option>)}
          </select>
        </label> : null}
      </nav>
      <nav className="srw-window" aria-label="research window"><button type="button" className={windowMode === "day" ? "on" : ""} onClick={() => setWindowMode("day")}>DAY</button><button type="button" className={windowMode === "cumulative" ? "on" : ""} onClick={() => setWindowMode("cumulative")}>CUMULATIVE</button></nav>
      <nav className="srw-lanes" aria-label="research lane"><button type="button" className={lane === "vb" ? "on" : ""} onClick={() => setLane("vb")}>VB SWARM</button><button type="button" className={lane === "all" ? "on" : ""} onClick={() => setLane("all")}>ALL OBSERVE</button></nav>
      <span className={`srw-read ${shadowResearch.state}${shadowResearch.truncated ? " partial" : ""}`}>{shadowResearch.truncated ? "PARTIAL" : shadowResearch.state.toUpperCase()}</span>
    </div>
    {shadowResearch.cumulative ? <div className={`srw-running${shadowResearch.truncated ? " partial" : ""}`}>
      <span><small>RUNNING VIRTUAL · {lane === "vb" ? "VB SWARM" : "ALL OBSERVE"} · SINCE {shadowResearch.cohortStart}</small>
        <b className={running.pnl >= 0 ? "pos" : "neg"}>{money(running.pnl)} TOTAL/CT</b></span>
      <em>{windowMode === "cumulative" ? `${filteredRunningRows.length}/${runningRows.length} strategies · ` : ""}{running.scored} scored · {shadowResearch.cumulative.sessionCount} sessions · {percent(running.winners, running.scored)} win</em>
    </div> : null}
    {shadowResearch.state === "loading" || shadowResearch.state === "idle" ? <div className="srw-empty">loading bounded research ledger…</div>
      : shadowResearch.state === "error" ? <div className="srw-empty error">research read failed · {shadowResearch.error}</div>
      : !selected ? <div className="srw-empty">no reconstructed virtual paths since the Day 1 cohort</div>
      : <>
        <section className="srw-atlas-brief" aria-label="Decision Atlas research summary">
          <span><small>DECISION ATLAS</small><b>WHAT DESERVES REVIEW?</b></span>
          <span><small>WORKING</small><b>{atlasWorking.length}</b></span>
          <span><small>NEEDS REVIEW</small><b>{atlasReview.length}</b></span>
          <span><small>COLLECTING</small><b>{atlasReads.length - atlasWorking.length - atlasReview.length}</b></span>
          <span><small>INVESTIGATE NEXT</small><b>{atlasNext ? `${atlasNext.slug} · ${atlasNext.read.label}` : "NO CLEAR LEAD"}</b></span>
        </section>
        <section className="srw-native">
          <header><span><b>{nativeTitle}</b><small>every table row is virtual · hypothetical entries · not portfolio P&amp;L</small></span>
            <em>{totals.scored} {lane === "vb" ? "VB" : "ALL"} PATHS</em></header>
          <div className="srw-kpis">
            <span><small>SCORED</small><b>{totals.scored}</b></span>
            <span><small>WIN RATE</small><b>{percent(totals.winners, totals.scored)}</b></span>
            <span><small>TARGET / STOP</small><b>{totals.targets} / {totals.stops}</b></span>
            <span><small>AVG / PATH</small><b>{money(totals.average)}</b></span>
          </div>
          <NativeTable
            rows={rows}
            selectable={windowMode === "cumulative"}
            excluded={excluded[lane]}
            onToggle={toggleStrategy}
            onToggleAll={toggleAllStrategies}
            selectedSlug={focusSlug}
            onInspect={setFocusSlug}
            evidenceLabel={windowMode === "cumulative" ? "HISTORICAL VIRTUAL" : "SESSION VIRTUAL"}
            renderDetail={() => <><CurrentEvidenceCard
              selectedSlug={focusSlug}
              executed={focusedComparison ? shadowResearch.currentExecutedBySlug[focusedComparison.executedSlug] : focusedExecuted}
              comparison={focusedComparison}
              state={shadowResearch.currentExecutedState}
              error={shadowResearch.currentExecutedError}
              truncated={shadowResearch.currentExecutedTruncated}
            /><DecisionAtlasPreviewCard summary={focusedSummary} dryPowder={focusedCurve} managerEvidence={focusedManagerEvidence} />
              <details className="srw-channel-analysis"><summary><span><small>SELECTED CHANNEL</small><b>ENTRY + MANAGER ANALYSIS</b></span><em>{focusedLead == null ? "first signal collecting" : `${signedUsd(focusedLead)}/ct first signal`}{focusedBestManager?.medianDeltaPct == null ? " · manager collecting" : ` · ${focusedBestManager.managerId} ${focusedBestManager.medianDeltaPct >= 0 ? "+" : ""}${focusedBestManager.medianDeltaPct}% typical uplift`}</em><i>▾</i></summary><div>
              <ChannelDryPowderCurve curve={focusedCurve} />
              <ChannelManagerEvidencePanel
                evidence={focusedManagerEvidence}
                currentManagerLabel={focusedPassport?.rootPolicy?.managerLabel}
                currentConfigurationEpochId={surface.channelControlPlane.view?.configurationEpochId}
              />
            </div></details></>}
          />
          <footer>{windowMode === "cumulative" ? "CHECKED ROWS DRIVE THIS SUMMARY · " : ""}CORRELATED SIMULATION · NOT PORTFOLIO P&amp;L{shadowResearch.truncated ? ` · PARTIAL ${(10_000).toLocaleString()}-ROW CAP` : ""}</footer>
        </section>
        <details className="srw-deep-dive"><summary><span><small>DEEP RESEARCH</small><b>EXACT REPLAY + MANAGER MAP</b></span><em>OPEN COMPARISON</em><i>▾</i></summary><div>
          <ExactStatus surface={surface} session={selected.session} />
          <ManagerFleetHeatmap book={surface.managerEvidence.book} channelSlugs={surface.view.desk.strategists.map((channel) => channel.slug)} selectedSlug={focusSlug} onSelect={setFocusSlug} />
        </div></details>
      </>}
  </section>;
}
