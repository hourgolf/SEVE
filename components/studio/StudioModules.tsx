"use client";

import { signedUsd, usd0 } from "@/lib/format";
import { channelDecisionConditions, channelDecisionState } from "@/lib/studio/channelDecision";
import type { StudioChannelRow } from "@/lib/studio/deriveStudioView";
import type { StudioChannelEvidence } from "@/lib/studio/deriveStudioEvidence";
import type { StudioEvidence } from "@/hooks/useStudioEvidence";
import type { Incident } from "@/lib/incident/deriveIncident";
import type { Position } from "@/lib/desk/types";

function Panel({ index, title, meta, children }: { index: string; title: string; meta: string; children: React.ReactNode }) {
  return (
    <section className="studio-module">
      <header><span>{index}</span><b>{title}</b><small>{meta}</small></header>
      <div className="studio-module-body">{children}</div>
    </section>
  );
}

const ratio = (value: number | null) => value == null ? "∞" : value.toFixed(1);

export function StudioModules({ selected, evidence, evidenceState, positions, recentTrades, incident }: {
  selected?: StudioChannelRow;
  evidence?: StudioChannelEvidence;
  evidenceState: StudioEvidence;
  positions: Position[];
  recentTrades: Position[];
  incident: Incident;
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
          <p className="module-mandate">{channel.mandate}</p>
          <div className="condition-bank">
            {conditions.length ? conditions.map((condition) => <span key={condition}>{condition}</span>) : <i>built-in policy detail not exported</i>}
          </div>
          <footer>effective context · current config + compiled thesis</footer>
        </> : <div className="module-empty">select a fleet row</div>}
      </Panel>

      <Panel index="04" title="LIVE EVIDENCE" meta={evidenceState.basis}>
        {evidenceState.loading ? <div className="module-empty">reading recent desk ledger…</div>
          : evidenceState.error ? <div className="module-empty warn">evidence read unavailable · no performance claim</div>
            : evidence ? <>
              <div className={`evidence-hero${evidence.grossPerTrade < 0 ? " neg" : evidence.grossPerTrade > 0 ? " pos" : ""}`}>
                <small>GROSS / TRADE</small><strong>{signedUsd(evidence.grossPerTrade)}</strong><span>{evidence.confidence} · {evidence.trades} trades / {evidence.sessions} sessions</span>
              </div>
              <div className="evidence-grid">
                <span><small>GROSS</small><b>{signedUsd(evidence.pnl)}</b></span>
                <span><small>$/CONTRACT</small><b>{signedUsd(evidence.grossPerContract)}</b></span>
                <span><small>PROFIT FACTOR</small><b>{ratio(evidence.profitFactor)}</b></span>
                <span><small>WORST SESSION</small><b>{signedUsd(evidence.worstSession)}</b></span>
                <span><small>MAX DRAWDOWN</small><b>{usd0(evidence.maxDrawdown)}</b></span>
                <span><small>WIN % · SECONDARY</small><b>{evidence.winPct.toFixed(0)}%</b></span>
              </div>
              <footer>latest {evidenceState.sessionDates.length} account sessions · gross attribution · fees and broker-net unavailable</footer>
            </> : <div className="module-empty">no closed rows in the recent account window</div>}
      </Panel>

      <Panel index="05" title="POSITION / EXIT" meta={incident.severity.toUpperCase()}>
        {channel ? <>
          <div className="ops-truth">
            <span><small>OPEN</small><b>{open.length}</b></span>
            <span><small>EXPOSURE</small><b>{usd0(selected?.pnl.exposure ?? 0)}</b></span>
            <span><small>DESK HEALTH</small><b className={incident.severity}>{incident.title}</b></span>
          </div>
          <div className="exit-shape">
            <span><small>PREMIUM STOP</small><b>−{channel.config.premium_stop_pct ?? 50}%</b></span>
            <span><small>TAKE</small><b>{channel.config.take_profit_pct ? `+${channel.config.take_profit_pct}%` : "RIDE"}</b></span>
            <span><small>STALL</small><b>{channel.config.stall_minutes ? `${channel.config.stall_minutes}m / +${channel.config.stall_max_favor_pct ?? 0}%` : "OFF"}</b></span>
            <span><small>LAST EXIT</small><b>{lastClosed?.close_reason?.replaceAll("_", " ") ?? "—"}</b></span>
          </div>
          <footer>desk positions ≠ broker reconciliation · policy epoch not stamped · peak data is era-dependent</footer>
        </> : <div className="module-empty">select a fleet row</div>}
      </Panel>
    </div>
  );
}
