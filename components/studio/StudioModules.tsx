"use client";

import { signedUsd, usd0 } from "@/lib/format";
import { channelDecisionConditions, channelDecisionState } from "@/lib/studio/channelDecision";
import type { StudioChannelRow } from "@/lib/studio/deriveStudioView";
import type { StudioChannelEvidence } from "@/lib/studio/deriveStudioEvidence";
import type { StudioEvidence } from "@/hooks/useStudioEvidence";
import type { Incident } from "@/lib/incident/deriveIncident";
import type { Position } from "@/lib/desk/types";
import type { ChannelPassport } from "@/lib/channels/channelPassport";

function Panel({ index, title, meta, children }: { index: string; title: string; meta: string; children: React.ReactNode }) {
  return (
    <section className="studio-module">
      <header><span>{index}</span><b>{title}</b><small>{meta}</small></header>
      <div className="studio-module-body">{children}</div>
    </section>
  );
}

const ratio = (value: number | null) => value == null ? "∞" : value.toFixed(1);
const etTime = (iso: string) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date(iso));

export function StudioModules({ selected, evidence, evidenceState, positions, recentTrades, incident, passport }: {
  selected?: StudioChannelRow;
  evidence?: StudioChannelEvidence;
  evidenceState: StudioEvidence;
  positions: Position[];
  recentTrades: Position[];
  incident: Incident;
  passport?: ChannelPassport;
}) {
  const channel = selected?.channel;
  const decision = channelDecisionState(selected?.lastSignal ?? null);
  const conditions = channel ? channelDecisionConditions(channel) : [];
  const open = channel ? positions.filter((position) => position.strategist_slug === channel.slug) : [];
  const lastClosed = channel
    ? recentTrades.filter((position) => position.strategist_slug === channel.slug)
      .sort((a, b) => Date.parse(b.closed_at ?? "") - Date.parse(a.closed_at ?? ""))[0]
    : undefined;

  return (
    <div className="studio-modules" aria-label="Selected channel consoles">
      <Panel index="03" title="DECISION ENGINE" meta={channel?.regime ?? "select channel"}>
        {channel ? <>
          <div className={`decision-state ${decision.tone}`}><b>{decision.label}</b><span>{decision.fact}</span></div>
          <div className="decision-ledger" aria-label="Recent channel decision receipts">
            {(passport?.evidence.recentDecisions ?? []).map((signal) => {
              const state = channelDecisionState(signal);
              return <span key={signal.id} className={state.tone}>
                <time>{etTime(signal.created_at)} ET</time><b>{state.label}</b><em>{signal.signal_type}</em><small>{state.fact}</small>
              </span>;
            })}
            {!passport?.evidence.recentDecisions.length && <i>no channel decision receipt in the bounded account feed</i>}
          </div>
          <p className="module-mandate">{channel.mandate}</p>
          <div className="condition-bank">
            {conditions.length ? conditions.map((condition) => <span key={condition}>{condition}</span>) : <i>built-in policy detail not exported</i>}
          </div>
          <footer>latest bounded account feed · decision/censor receipts, not a historical score</footer>
        </> : <div className="module-empty">select a fleet row</div>}
      </Panel>

      <Panel index="04" title="HISTORICAL DESK EVIDENCE" meta="pre-RC5 · mixed epochs">
        {evidenceState.loading ? <div className="module-empty">reading recent desk ledger…</div>
          : evidenceState.error ? <div className="module-empty warn">evidence read unavailable · no performance claim</div>
            : evidence ? <>
              <div className={`evidence-hero${evidence.grossPerTrade < 0 ? " neg" : evidence.grossPerTrade > 0 ? " pos" : ""}`}>
                <small>GROSS / LOGICAL TRADE</small><strong>{signedUsd(evidence.grossPerTrade)}</strong><span>{evidence.confidence} · {evidence.trades} logical trades / {evidence.sessions} sessions</span>
              </div>
              <div className="evidence-grid">
                <span><small>GROSS</small><b>{signedUsd(evidence.pnl)}</b></span>
                <span><small>$/CONTRACT</small><b>{signedUsd(evidence.grossPerContract)}</b></span>
                <span><small>PROFIT FACTOR</small><b>{ratio(evidence.profitFactor)}</b></span>
                <span><small>WORST SESSION</small><b>{signedUsd(evidence.worstSession)}</b></span>
                <span><small>MAX DRAWDOWN</small><b>{usd0(evidence.maxDrawdown)}</b></span>
                <span><small>WIN % · SECONDARY</small><b>{evidence.winPct.toFixed(0)}%</b></span>
              </div>
              <footer>historical executed · latest {evidenceState.sessionDates.length} account sessions · runner rows collapsed · mixed configurations · context only · fees and broker-net unavailable</footer>
            </> : <div className="module-empty">no executed logical trades in the recent account window</div>}
      </Panel>

      <Panel index="05" title="EVIDENCE PASSPORT" meta={passport?.lifecycleLabel ?? incident.severity.toUpperCase()}>
        {channel ? <>
          <div className="ops-truth">
            <span><small>OPEN</small><b>{open.length}</b></span>
            <span><small>DECISIONS</small><b>{passport?.evidence.recentSignals ?? 0}</b></span>
            <span><small>RUNTIME / DB</small><b className={passport?.database.differsFromRuntime ? "warning" : ""}>{passport?.lifecycleLabel ?? "UNVERIFIED"} / {passport?.database.state ?? "—"}</b></span>
          </div>
          <div className="passport-grid">
            <span><small>ACTED / CENSORED</small><b>{passport?.evidence.actedSignals ?? 0} / {passport?.evidence.censoredSignals ?? 0}</b></span>
            <span><small>RECENT FILLS</small><b>{passport?.evidence.recentClosed ?? 0} closed · {open.length} open</b></span>
            <span><small>OBSERVER</small><b>{passport?.observer.configuredArms ?? 0} arms · {passport?.observer.state ?? "unverified"}</b></span>
            <span><small>LAST EXIT</small><b>{lastClosed?.close_reason?.replaceAll("_", " ") ?? "—"}</b></span>
            <span><small>CHANNEL VERSION</small><code>{passport?.rootPolicy?.channelVersion.slice(0, 12) ?? "not sealed"}</code></span>
            <span><small>CONFIG EPOCH</small><code>{passport?.rootPolicy?.configurationEpochId.slice(0, 12) ?? "not sealed"}</code></span>
          </div>
          <p className="passport-fact">{passport?.observer.fact ?? "Observer evidence unavailable."}</p>
          <footer>prospective floor: 10 independent clocks / 5 sessions · gross desk attribution · no automatic promotion</footer>
        </> : <div className="module-empty">select a fleet row</div>}
      </Panel>
    </div>
  );
}
