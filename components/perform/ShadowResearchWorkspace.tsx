"use client";

import { useEffect, useMemo, useState } from "react";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { exactShadowReceipt } from "@/lib/research/exactShadowArchive";
import type {
  ShadowChannelSummary,
  ShadowSessionSummary,
} from "@/lib/research/shadowResearch";
import { signedUsd } from "@/lib/format";

const percent = (wins: number, scored: number): string =>
  scored ? `${Math.round((1000 * wins) / scored) / 10}%` : "—";
const money = (value: number | null): string => value == null ? "—" : signedUsd(value);
const shortSession = (session: string): string => session.slice(5).replace("-", "/");
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
    <footer>Partial means exact quote gaps were truthfully censored. This receipt cannot arm, mute, resize, or promote a channel.</footer>
  </section>;
  if (current) return <section className={`srw-exact ${current.state}`}>
    <header><span><b>EXACT MANAGER REPLAY</b><small>{current.source}</small></span><em>{current.state.replaceAll("_", " ").toUpperCase()}</em></header>
    <div className="srw-kpis">
      <span><small>RAW CLOCKS</small><b>{current.rawDecisions}</b></span>
      <span><small>CONTRACTS</small><b>{current.exactContracts}</b></span>
      <span><small>SOURCE CENSORS</small><b>{current.sourceCensors}</b></span>
      <span><small>EXACT ELIGIBLE</small><b>{current.exactEligible ?? "—"}</b></span>
      <span><small>EXACT CENSORS</small><b>{current.exactCensored ?? "—"}</b></span>
      <span><small>INDEPENDENT PATHS</small><b>{current.independentManagerPaths ?? "—"}</b></span>
    </div>
    <p>{current.detail}</p>
    <footer>Same-day virtual outcomes remain provisional until this checksum-bound T+1 layer completes.</footer>
  </section>;
  return <section className="srw-exact missing"><header><span><b>EXACT MANAGER REPLAY</b><small>no session-matched receipt</small></span><em>MISSING</em></header>
    <p>The native ledger is visible, but no exact manager receipt is attached to this session.</p></section>;
}
function NativeTable({ rows }: { rows: ShadowChannelSummary[] }) {
  return <div className="srw-table">
    <div className="srw-table-head"><span>CHANNEL</span><span>PATHS</span><span>WIN</span><span>AVG/CT</span><span>Σ/CT</span><span>MFE</span><span>EXIT MIX</span></div>
    {rows.length === 0 ? <div className="srw-empty">no same-session paths in this lane</div> : rows.map((row) => <div className="srw-row" key={row.slug}>
      <b>{row.slug}</b><span>{row.scored}/{row.paths}</span><span>{percent(row.winners, row.scored)}</span>
      <strong className={(row.averagePerPath ?? 0) >= 0 ? "pos" : "neg"}>{money(row.averagePerPath)}</strong>
      <span>{money(row.pnlPerContract)}</span><span>{row.averageMfePct == null ? "—" : `${row.averageMfePct}%`}</span>
      <span>{row.targets}T · {row.stops}S · {row.flattens}B</span>
    </div>)}
  </div>;
}

export function ShadowResearchWorkspace({ surface, compact = false }: { surface: SurfaceProps; compact?: boolean }) {
  const { shadowResearch } = surface;
  const [session, setSession] = useState("");
  const [lane, setLane] = useState<"vb" | "all">("vb");
  const [windowMode, setWindowMode] = useState<"day" | "cumulative">("day");
  useEffect(() => {
    if (!session && shadowResearch.sessions.length) setSession(shadowResearch.sessions[0].session);
  }, [session, shadowResearch.sessions]);
  const selected = useMemo<ShadowSessionSummary | null>(
    () => shadowResearch.sessions.find((item) => item.session === session) ?? shadowResearch.sessions[0] ?? null,
    [session, shadowResearch.sessions],
  );
  const native = windowMode === "cumulative" ? shadowResearch.cumulative : selected;
  const rows = native ? (lane === "vb" ? native.vb : native.dark) : [];
  const totals = laneTotals(rows);
  const runningRows = shadowResearch.cumulative
    ? (lane === "vb" ? shadowResearch.cumulative.vb : shadowResearch.cumulative.dark)
    : [];
  const running = laneTotals(runningRows);
  const nativeTitle = windowMode === "cumulative" && shadowResearch.cumulative
    ? `CUMULATIVE NATIVE PATHS · ${shadowResearch.cumulative.fromSession} → ${shadowResearch.cumulative.throughSession}`
    : `SAME-DAY NATIVE PATHS · ${selected?.session ?? "—"}`;

  return <section className={`srw${compact ? " compact" : ""}`} id="perform-research" tabIndex={-1} aria-label="Shadow research workspace">
    <header className="srw-head"><span><b>SHADOW RESEARCH</b><small>native paths now · exact manager truth at T+1</small></span>
      <em>RESEARCH ONLY · ZERO ORDER AUTHORITY</em></header>
    <div className="srw-controls">
      <nav className="srw-sessions" aria-label="research session">{shadowResearch.sessions.slice(0, 5).map((item) => <button type="button" key={item.session} className={windowMode === "day" && selected?.session === item.session ? "on" : ""} onClick={() => { setSession(item.session); setWindowMode("day"); }}>{shortSession(item.session)}</button>)}</nav>
      <nav className="srw-window" aria-label="research window"><button type="button" className={windowMode === "day" ? "on" : ""} onClick={() => setWindowMode("day")}>DAY</button><button type="button" className={windowMode === "cumulative" ? "on" : ""} onClick={() => setWindowMode("cumulative")}>CUMULATIVE</button></nav>
      <nav className="srw-lanes" aria-label="research lane"><button type="button" className={lane === "vb" ? "on" : ""} onClick={() => setLane("vb")}>VB SWARM</button><button type="button" className={lane === "all" ? "on" : ""} onClick={() => setLane("all")}>ALL DARK</button></nav>
      <span className={`srw-read ${shadowResearch.state}${shadowResearch.truncated ? " partial" : ""}`}>{shadowResearch.truncated ? "PARTIAL" : shadowResearch.state.toUpperCase()}</span>
    </div>
    {shadowResearch.cumulative ? <div className={`srw-running${shadowResearch.truncated ? " partial" : ""}`}>
      <span><small>RUNNING {lane === "vb" ? "VB SWARM" : "ALL DARK"} · SINCE {shadowResearch.cohortStart}</small>
        <b className={running.pnl >= 0 ? "pos" : "neg"}>{money(running.pnl)} Σ/CT</b></span>
      <em>{running.scored} scored · {shadowResearch.cumulative.sessionCount} sessions · {percent(running.winners, running.scored)} win</em>
    </div> : null}
    {shadowResearch.state === "loading" || shadowResearch.state === "idle" ? <div className="srw-empty">loading bounded research ledger…</div>
      : shadowResearch.state === "error" ? <div className="srw-empty error">research read failed · {shadowResearch.error}</div>
      : !selected ? <div className="srw-empty">no reconstructed virtual paths since the Day 1 cohort</div>
      : <>
        <section className="srw-native">
          <header><span><b>{nativeTitle}</b><small>capital-blind mid-basis triage · current native exits</small></span>
            <em>{totals.scored} {lane === "vb" ? "VB" : "ALL"} PATHS</em></header>
          <div className="srw-kpis">
            <span><small>SCORED</small><b>{totals.scored}</b></span>
            <span><small>WIN RATE</small><b>{percent(totals.winners, totals.scored)}</b></span>
            <span><small>TARGET / STOP</small><b>{totals.targets} / {totals.stops}</b></span>
            <span><small>AVG / PATH</small><b>{money(totals.average)}</b></span>
          </div>
          <NativeTable rows={rows} />
          <footer>Native figures are correlated would-haves, not portfolio P&amp;L. Rankings are descriptive and cannot change the desk.{shadowResearch.truncated ? ` Cumulative evidence is PARTIAL at the ${(10_000).toLocaleString()}-row safety cap.` : ""}</footer>
        </section>
        <ExactStatus surface={surface} session={selected.session} />
      </>}
  </section>;
}
