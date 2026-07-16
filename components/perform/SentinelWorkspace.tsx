"use client";

import "@/app/sentinel.css";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { deriveSentinelWorkspace } from "@/lib/sentinel/deriveSentinelWorkspace";

const age = (seconds: number | null) => seconds == null ? "—" : seconds < 90 ? `${seconds}s` : seconds < 5400 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
const pct = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value)}%`;
const price = (value: number | null | undefined) => value == null ? "—" : value.toFixed(2);

function EvidenceList({ title, items, empty = "none observed" }: { title: string; items: string[]; empty?: string }) {
  return <section className="sent-list"><header><b>{title}</b><span>{items.length}</span></header>
    {items.length === 0 ? <p className="sent-empty">{empty}</p> : items.map((item, index) => <p key={index}><i />{item}</p>)}
  </section>;
}

export function SentinelWorkspace({ surface }: { surface: SurfaceProps }) {
  const { sentinel, ops, workerRuns, incident, feed } = surface;
  const brief = sentinel.brief;
  const scan = sentinel.scan;
  const judge = sentinel.judge;
  const nowMs = Date.now();
  const view = deriveSentinelWorkspace({
    nowMs,
    state: sentinel.state,
    createdAt: sentinel.createdAt,
    fetchedAtMs: sentinel.fetchedAtMs,
    forDate: sentinel.forDate,
    date: sentinel.date,
    hasBrief: Boolean(brief),
    hasScan: Boolean(scan),
    hasJudge: Boolean(judge),
    benchDays: scan?.benchDays ?? null,
  });
  const processAge = workerRuns.currentHeartbeatAtMs == null ? null : Math.max(0, Math.round((nowMs - workerRuns.currentHeartbeatAtMs) / 1000));
  const terrain = brief?.sentLevels?.[surface.symbol];
  const levels = terrain ? [...terrain.above, ...terrain.below] : brief ? [...brief.carry.above, ...brief.carry.below] : [];

  return <section className="sent-workspace" id="perform-sentinel" data-freshness={view.freshness} data-nav-target="true" tabIndex={-1}>
    <header className="sent-command">
      <div><span className="sent-index">04</span><p><small>SENTINEL · EVIDENCE CONTROL</small><b>{view.freshnessLabel}</b></p></div>
      <div className="sent-command-facts">{view.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
      <div className="sent-command-age"><small>RECEIPT AGE</small><b>{age(view.ageSec)}</b><em>read {age(view.readAgeSec)} ago</em></div>
    </header>

    <div className="sent-grid">
      <main className="sent-deterministic">
        <section className="sent-panel sent-terrain">
          <header><div><span>01</span><b>SESSION TERRAIN</b></div><em>DETERMINISTIC · FOR {sentinel.forDate || "UNSTAMPED"}</em></header>
          {!brief ? <div className="sent-blank">No structured terrain receipt is available. No market inference is being made.</div> : <>
            <div className="sent-metrics">
              <span><small>SPY GAP</small><b>{brief.gap.spy >= 0 ? "+" : ""}{brief.gap.spy.toFixed(2)}</b><em>{brief.gap.cleared ? "cleared" : "open"}</em></span>
              <span><small>RTH CLOSE</small><b>{price(brief.rth?.c)}</b><em>as of {brief.asOf || sentinel.date}</em></span>
              <span><small>DAY BOOK</small><b className={brief.compile.dayPnl < 0 ? "neg" : "pos"}>{brief.compile.dayPnl >= 0 ? "+" : ""}${Math.round(brief.compile.dayPnl)}</b><em>{brief.compile.nTrades} trades · gross</em></span>
              <span><small>GAP REGIME</small><b>{brief.update.gapRegime.cleared}/{brief.update.gapRegime.total}</b><em>historical receipt</em></span>
            </div>
            <div className="sent-terrain-body">
              <div className="sent-levels"><header><b>{surface.symbol} LEVEL LADDER</b><span>{levels.length} levels</span></header>
                {levels.length === 0 ? <p className="sent-empty">no levels published</p> : levels.slice(0, 12).map((level, index) => <p key={`${level.label}-${index}`}><span>{level.label}</span><b>{price(level.px)}</b></p>)}
              </div>
              <div className="sent-carry"><EvidenceList title="NEXT OPEN WATCH" items={brief.carry.watch} /><EvidenceList title="CALENDAR / EVENTS" items={brief.events} /></div>
            </div>
          </>}
        </section>

        <section className="sent-panel sent-scan">
          <header><div><span>02</span><b>OPPORTUNITY / DRIFT SENSOR</b></div><em>DESCRIPTIVE RESEARCH · NEVER AUTO-PROMOTES</em></header>
          {!scan ? <div className="sent-blank">No structured deterministic scan is available.</div> : <div className="sent-scan-grid">
            <section><header><b>PROMOTE CANDIDATES</b><span>research queue</span></header>{scan.promote.length === 0 ? <p className="sent-empty">none over current screen</p> : scan.promote.map((row) => <p key={row.slug}><b>{row.slug}</b><span>{row.n}t</span><span>pk {pct(row.peak)}</span><span>win {pct(row.win)}</span><em>give {pct(row.give)}</em></p>)}</section>
            <section><header><b>EXIT-FIXABLE</b><span>capture study</span></header>{scan.fixable.length === 0 ? <p className="sent-empty">none observed</p> : scan.fixable.map((row) => <p key={row.slug}><b>{row.slug}</b><span>{row.n}t</span><span>pk {pct(row.peak)}</span><span>win {pct(row.win)}</span><em>give {pct(row.give)}</em></p>)}</section>
            <section><header><b>LEAKS</b><span>review, do not infer</span></header>{scan.leaks.length === 0 ? <p className="sent-empty">none observed</p> : scan.leaks.map((row) => <p key={row.slug}><b>{row.slug}</b><span>{row.n}t</span><span>pk {pct(row.peak)}</span><span>win {pct(row.win)}</span><em>give {pct(row.give)}</em></p>)}</section>
            <EvidenceList title="PATTERN FLAGS" items={scan.patterns ?? []} empty="no descriptive split survived" />
          </div>}
        </section>
      </main>

      <aside className="sent-side">
        <section className="sent-panel sent-live">
          <header><div><span>03</span><b>LIVE SYSTEM EVIDENCE</b></div><em>{incident.session.replaceAll("_", " ")}</em></header>
          <div className="sent-live-grid">
            <span><small>INCIDENT</small><b className={incident.severity}>{incident.severity.toUpperCase()}</b><em>{incident.primaryCode}</em></span>
            <span><small>PROCESS</small><b>{workerRuns.query.state === "ok" ? "OBSERVED" : workerRuns.query.state.toUpperCase()}</b><em>{age(processAge)} · {workerRuns.abrupt16h} abrupt / 16h</em></span>
            <span><small>STREAM</small><b>{ops.heartbeat.state.toUpperCase()}</b><em>{age(ops.hbAgeSec)} · {ops.streamArmed} armed</em></span>
            <span><small>CRON</small><b>{ops.cron.state.toUpperCase()}</b><em>{age(ops.cronAgeSec)} · {ops.cronArmed} armed</em></span>
            <span><small>ASSIGNMENT</small><b>{ops.assignment.state.toUpperCase()}</b><em>failure never becomes zero</em></span>
            <span><small>OPEN BOOK</small><b>{feed.positions.length}</b><em>desk record · broker unreconciled</em></span>
          </div>
        </section>

        <section className="sent-panel sent-interpretive">
          <header><div><span>AI</span><b>INTERPRETIVE READ</b></div><em>ADVISORY · MODEL UNSTAMPED</em></header>
          {!judge ? <div className="sent-blank">No interpretive read is attached. Deterministic evidence remains valid.</div> : <>
            <div className="sent-verdict"><b>{judge.verdict}</b><p>{judge.soWhat}</p></div>
            <EvidenceList title="OPPORTUNITIES" items={judge.opportunities} />
            <EvidenceList title="DRIFT" items={judge.drift} />
          </>}
          <footer>Cannot alter health, channel state, policy, orders, or promotion. Use as a question generator only.</footer>
        </section>

        <section className="sent-panel sent-provenance">
          <header><div><span>P</span><b>PROVENANCE LEDGER</b></div><em>{view.coverageKnown ? "CALENDAR COVERED" : "CALENDAR COVERAGE UNKNOWN"}</em></header>
          {view.provenance.map((row) => <p key={row.label}><span className={row.kind}>{row.kind.toUpperCase()}</span><b>{row.label}</b><em>{row.basis}</em></p>)}
        </section>
      </aside>
    </div>
  </section>;
}
