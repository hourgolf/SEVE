"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { MobilePositions } from "@/components/mobile2/MobilePositions";
import { computeNetExposure } from "@/lib/desk/netExposure";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay, usd0 } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { deriveRecentExits } from "@/lib/perform/derivePositionsWorkspace";
import { SentinelReceiptStrip } from "@/components/perform/SentinelWorkspace";
import { findSealedReleaseReceipt } from "@/lib/ops/releaseReceipt";
import { BrokerReconciliationStrip, OpsReadinessPanel, PositionEvidenceChains } from "@/components/ops/OpsReadinessPanel";
import { TapeReadStrip } from "@/components/perform/EventTapeWorkspace";
import { ShadowResearchWorkspace } from "@/components/perform/ShadowResearchWorkspace";
import { deriveTapeRows } from "@/lib/perform/eventTape";
import {
  DEFAULT_MOBILE_REVIEW_MODE,
  MOBILE_REVIEW_MODES,
  mobileReviewHas,
  type MobileReviewMode,
} from "@/lib/mobile/reviewWorkspace";
import { DecisionAtlasFleetPulse } from "@/components/research/DecisionAtlasFleetPulse";

type DeskTab = "book" | "review" | "ops" | "build";

const TABS: { id: DeskTab; label: string; sub: string }[] = [
  { id: "book", label: "BOOK", sub: "live" },
  { id: "review", label: "REVIEW", sub: "tape" },
  { id: "ops", label: "OPS", sub: "tend" },
  { id: "build", label: "BUILD", sub: "write" },
];

const age = (sec: number | null) => sec == null ? "—" : sec < 90 ? `${sec}s` : sec < 5400 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`;
const moneyK = (value: number) => Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(1)}k` : usd0(value);

function Section({ title, meta, children, collapsible = false }: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  if (collapsible) return <details className="m2-desk-section m2-desk-disclosure">
    <summary><b>{title}</b>{meta && <span>{meta}</span>}<i aria-hidden="true">⌄</i></summary>
    <div className="m2-desk-body">{children}</div>
  </details>;
  return <section className="m2-desk-section"><header><b>{title}</b>{meta && <span>{meta}</span>}</header><div className="m2-desk-body">{children}</div></section>;
}

export function MobileBookView({ props, onViewMarket }: { props: SurfaceProps; onViewMarket?: (view: "chart" | "chain") => void }) {
  const { feed, liveMarks } = props;
  const exposure = useMemo(() => computeNetExposure(feed.positions, liveMarks), [feed.positions, liveMarks]);
  const recentExits = useMemo(() => deriveRecentExits(feed.recentTrades), [feed.recentTrades]);
  const reconciliation = props.opsReadiness.evidence.find((item) => item.id === "reconciliation");
  const attributionBlocked = feed.positionAttribution.state === "blocked";
  const hasOpenPositions = feed.positions.length > 0;
  const hasRecentExits = recentExits.rows.length > 0;
  const isQuietBook = !attributionBlocked && !hasOpenPositions && !hasRecentExits;

  return <>
    <div className="m2-book-nav"><span><b>BOOK</b><small>POSITIONS · EXPOSURE · EXITS</small></span>{onViewMarket && <div><button type="button" onClick={() => onViewMarket("chart")}>CHART</button><button type="button" onClick={() => onViewMarket("chain")}>CHAIN</button></div>}</div>
    <DecisionAtlasFleetPulse reports={props.decisionAtlas} purpose="positions" channelSlugs={feed.positions.map((position) => position.strategist_slug)} />
    {reconciliation?.tone !== "green" && <BrokerReconciliationStrip model={props.opsReadiness} compact />}
    {isQuietBook ? <div className="m2-book-empty" role="status"><b>NO OPEN POSITIONS</b><span>No session exits</span></div> : <>
    {(hasOpenPositions || attributionBlocked) && <MobilePositions props={props} strategists={props.view.desk.strategists} compact />}
    {hasOpenPositions && <div className="m2-desk-hero">
      <span><small>OPEN</small><b>{feed.positions.length}</b></span>
      <span><small>CONTRACTS</small><b>{exposure.totalContracts}</b></span>
      <span><small>STACKED</small><b className={exposure.stackedOccCount ? "warn" : ""}>{exposure.stackedOccCount}/{exposure.occCount}</b></span>
      <span><small>NOTIONAL</small><b>{moneyK(exposure.totalNotional)}</b></span>
    </div>}

    {hasOpenPositions && <Section title="NET EXPOSURE" meta="correlated lot · no caps">
      <>
        <div className="m2-desk-directions">
          {exposure.byUnderlying.map((row) => <span key={row.underlying}><b>{row.underlying}</b><i className="pos">{row.callContracts}C</i><i className="neg">{row.putContracts}P</i><em>{moneyK(row.notional)}</em></span>)}
        </div>
        <div className="m2-desk-rows">
          {exposure.byOcc.slice(0, 8).map((row) => <div key={row.occ} className={row.channels.length >= 4 ? "hot" : ""}>
            <b>{row.underlying} {row.strike.toFixed(0)}{row.optType === "call" ? "C" : "P"}</b>
            <span>×{Math.abs(row.contracts)}</span><span>{row.channels.length} ch</span><em>{moneyK(row.notional)}</em>
          </div>)}
        </div>
      </>
    </Section>}

    {hasRecentExits && <Section title="RECENT EXITS" meta={`${recentExits.rows.length} today · ${signedUsd(recentExits.realized)}`}>
      <div className="m2-recent-exits">
        {recentExits.rows.slice(0, 10).map((row) => {
          const trade = row.position;
          const realized = trade.realized_pnl ?? 0;
          const root = trade.occ_symbol.match(/^([A-Z]+)\d/)?.[1] ?? "?";
          const closeReason = trade.close_reason ? trade.close_reason.replace(/^manual:?/, "operator · ").replaceAll("_", " ") : "unclassified";
          return <div key={trade.id} style={{ ["--pm" as string]: pmVar(props.view.desk.strategists.find((channel) => channel.slug === trade.strategist_slug)?.color ?? "green") }}>
            <i /><span><b>{trade.strategist_slug}</b><small>{root} {trade.strike.toFixed(0)}{trade.opt_type === "call" ? "C" : "P"} ×{Math.abs(trade.qty)} · {closeReason}</small></span>
            <em className={realized < 0 ? "neg" : "pos"}>{signedUsd(realized)}</em>
            <p>in {trade.avg_entry_price.toFixed(2)} → out {trade.current_mark.toFixed(2)} · {row.returnPct == null ? "return —" : `return ${row.returnPct >= 0 ? "+" : ""}${Math.round(row.returnPct)}%`} · {row.peakPct == null ? "best move —" : `best +${Math.round(row.peakPct)}%`}{row.peakExceeded ? " · exit exceeded recorded best" : row.capturePct == null ? "" : row.capturePct < 0 ? " · gave back the gain and finished below entry" : ` · kept ${Math.round(row.capturePct)}% of the best move`}</p>
          </div>;
        })}
      </div>
    </Section>}
    </>}
  </>;
}

export function MobileReviewView({ props, channels, livePnl }: { props: SurfaceProps; channels: StrategistState[]; livePnl: Record<string, ChannelPnl> }) {
  const [mode, setMode] = useState<MobileReviewMode>(DEFAULT_MOBILE_REVIEW_MODE);
  const { feed, liveFund, sentinel } = props;
  const rows = channels.map((channel) => ({ channel, pnl: livePnl[channel.slug] })).sort((a, b) => Math.abs(b.pnl?.dayPnl ?? 0) - Math.abs(a.pnl?.dayPnl ?? 0));
  const equity = feed.equityCurve.map((point) => point.equity);
  const brief = sentinel.brief;
  const judge = sentinel.judge;
  const tape = useMemo(() => deriveTapeRows(props.data.events).slice(0, 12), [props.data.events]);
  const selectedAccount = props.accounts.find((account) => account.id === props.acctId);
  const accountScope = selectedAccount ? `${selectedAccount.name} ACCOUNT` : "ACCOUNT UNSELECTED";
  const attributionChecking = feed.positionAttribution.state === "checking";
  const attributionBlocked = feed.positionAttribution.state === "blocked";
  const attributedValue = (value: string): string =>
    attributionChecking ? "…" : attributionBlocked ? "BLOCKED" : value;

  return <>
    <nav className="m2-review-modes" aria-label="Review workspace">
      {MOBILE_REVIEW_MODES.map((item) => <button type="button" key={item.id} className={mode === item.id ? "on" : ""} onClick={() => setMode(item.id)} aria-pressed={mode === item.id}><b>{item.label}</b><small>{item.sub}</small></button>)}
    </nav>
    <DecisionAtlasFleetPulse reports={props.decisionAtlas} purpose="review" />

    {mobileReviewHas(mode, "sentinel-receipt") && <SentinelReceiptStrip sentinel={sentinel} compact />}
    {mobileReviewHas(mode, "session-summary") && <div className="m2-desk-hero">
      <span><small>{accountScope} · SESSION NAV Δ</small><b className={liveFund.dayPnl < 0 ? "neg" : "pos"}>{attributedValue(signedUsd(liveFund.dayPnl))}</b></span>
      <span><small>NAV</small><b>{usd0(liveFund.nav)}</b></span>
      <span><small>CLOSED LOGICAL</small><b>{attributedValue(String(feed.sessionTrades.closed))}</b></span>
      <span><small>OPEN LOGICAL</small><b>{attributedValue(String(feed.sessionTrades.open))}</b></span>
    </div>}

    {mobileReviewHas(mode, "equity") && <Section title="EQUITY" meta={`${accountScope} · account NAV · today`}>
      {equity.length >= 2 ? <LineChart values={equity} height={92} id="m2-desk-equity" baseline={equity[0]} format={usd0} formatDelta={signedUsd} labels={feed.equityCurve.map((point) => timeOfDay(point.ts))} />
        : <div className="m2-desk-empty">awaiting equity history</div>}
    </Section>}

    {mobileReviewHas(mode, "attribution") && <Section title="CHANNEL ATTRIBUTION" meta={`${accountScope} · immutable execution routes`}>
      {attributionBlocked ? <div className="review-evidence-blocked" role="alert"><b>CURRENT ATTRIBUTION BLOCKED</b>{feed.positionAttribution.issues.map((issue) => <span key={issue}>{issue}</span>)}<small>No strategist-account fallback was used.</small></div>
        : attributionChecking ? <div className="m2-desk-empty">checking immutable execution-account routes…</div>
          : <div className="m2-review-rows">
        {rows.map(({ channel, pnl }) => {
          const trades = pnl?.trades ?? 0;
          const peak = pnl?.pkN ? Math.round(pnl.pkSum / pnl.pkN) : null;
          const win = trades ? Math.round((100 * pnl.wins) / trades) : null;
          return <div key={channel.slug} style={{ ["--pm" as string]: pmVar(channel.color) }}><i /><b>{channel.slug}</b>
            <span className={(pnl?.dayPnl ?? 0) < 0 ? "neg" : (pnl?.dayPnl ?? 0) > 0 ? "pos" : ""}>{signedUsd(pnl?.dayPnl ?? 0)}</span>
            <small>{trades} trades · best move {peak ?? "—"}% · win {win ?? "—"}%</small></div>;
        })}
      </div>}
    </Section>}

    {mobileReviewHas(mode, "shadow-research") && <ShadowResearchWorkspace surface={props} compact />}

    {mobileReviewHas(mode, "event-tape") && <Section title="EVENT TAPE" meta="retained operational view · newest 14">
      <TapeReadStrip health={props.data.readHealth.events} events={props.data.events} compact />
      <div className="m2-review-tape">
        {tape.length === 0 ? <div className="m2-desk-empty">no retained events</div> : tape.map((event) => <div key={event.id} data-kind={event.category}>
          <time>{timeOfDay(event.created_at)}</time><b>{event.level}</b><span>{event.message}</span>{event.count > 1 && <em>×{event.count}</em>}
        </div>)}
      </div>
    </Section>}

    {mobileReviewHas(mode, "trade-evidence") && <Section title="TRADE EVIDENCE" meta="candidate → close">
      <PositionEvidenceChains model={props.opsReadiness} compact />
    </Section>}

    {mobileReviewHas(mode, "nightly-read") && <Section title="NIGHTLY READ" meta={`ALL PAPER ACCOUNTS · ${sentinel.date ? `scan ${sentinel.date.slice(5)}` : sentinel.state}`}>
      {sentinel.state !== "ok" ? <div className="m2-desk-empty">nightly review {sentinel.state}</div> : <div className="m2-nightly">
        {judge && <><div className="verdict"><b>{judge.verdict}</b><span>{judge.soWhat}</span></div>
          {judge.opportunities.length > 0 && <div><small>OPPORTUNITIES</small>{judge.opportunities.map((item, index) => <p key={index}>{item}</p>)}</div>}
          {judge.drift.length > 0 && <div><small>DRIFT</small>{judge.drift.map((item, index) => <p key={index}>{item}</p>)}</div>}</>}
        {brief && <>
          <div><small>NEXT OPEN</small>{brief.carry.watch.map((item, index) => <p key={index}>{item}</p>)}</div>
          {brief.events.length > 0 && <div><small>EVENTS</small>{brief.events.map((item, index) => <p key={index}>{item}</p>)}</div>}
        </>}
      </div>}
    </Section>}
    {mobileReviewHas(mode, "deterministic-scan") && <Section title="DETERMINISTIC SCAN" meta="descriptive · not an arm gate">
      {!sentinel.scan ? <div className="m2-desk-empty">scan evidence unavailable</div> : <div className="m2-review-scan">
        {[...sentinel.scan.promote.map((row) => ({ ...row, kind: "PROMOTE" })), ...sentinel.scan.fixable.map((row) => ({ ...row, kind: "FIX" })), ...sentinel.scan.leaks.map((row) => ({ ...row, kind: "LEAK" }))].slice(0, 12).map((row) => <div key={`${row.kind}-${row.slug}`}><b>{row.kind}</b><span>{row.slug}</span><small>best move {Math.round(row.peak)}% · win {Math.round(row.win)}% · giveback {row.give == null ? "—" : `${Math.round(row.give)}%`} · {row.n} trades</small></div>)}
      </div>}
    </Section>}
  </>;
}

export function MobileOpsView({ props, channels, onOpenSettings }: { props: SurfaceProps; channels: StrategistState[]; onOpenSettings: () => void }) {
  const { data, ops, workerRuns, incident, liveFund, feed, livePnl } = props;
  const active = channels.filter((channel) => channel.status === "armed" && !channel.config.muted);
  const risk = active.reduce((sum, channel) => sum + (channel.config.capital_pct || 0), 0);
  const rows = channels.map((channel) => ({ channel, pnl: livePnl[channel.slug]?.dayPnl ?? 0 })).filter((row) => row.pnl !== 0).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const ingestAge = data.lastIngestTs ? Math.max(0, Math.round((Date.now() - Date.parse(data.lastIngestTs)) / 1000)) : null;
  const release = findSealedReleaseReceipt(data.releaseEvents);

  return <>
    <section className={`m2-incident-card ${incident.severity}`}><header><i /><b>{incident.title}</b><span>{incident.severity.toUpperCase()}</span></header>
      <p>desk shows {feed.positions.length} open positions</p>{incident.facts.slice(0, 3).map((fact, index) => <p key={index}>{fact}</p>)}</section>
    <DecisionAtlasFleetPulse reports={props.decisionAtlas} purpose="operations" />
    <Section title="PREFLIGHT" meta={incident.session.replaceAll("_", " ")}>
      <div className="m2-preflight">
        <span><b>PROCESS</b><em>{workerRuns.query.state === "ok" ? "OBSERVED" : workerRuns.query.state.toUpperCase()}</em><small>{workerRuns.rowsIn16h} runs / 16h</small></span>
        <span><b>STREAM</b><em>{ops.heartbeat.state.toUpperCase()}</em><small>{age(ops.hbAgeSec)} · {ops.streamArmed} DB armed</small></span>
        <span><b>CRON</b><em>{ops.cron.state.toUpperCase()}</em><small>{age(ops.cronAgeSec)} · {ops.cronArmed} DB armed</small></span>
        <span><b>TAPE</b><em>{data.lastIngestTs ? "OBSERVED" : "MISSING"}</em><small>{age(ingestAge)} · {data.snapshot.length} contracts</small></span>
      </div>
    </Section>
    <Section title="OPERATIONAL READINESS" meta="configured ≠ observed · tap to inspect" collapsible>
      <OpsReadinessPanel model={props.opsReadiness} compact />
    </Section>
    <div className="m2-desk-hero">
      <span><small>NAV</small><b>{usd0(liveFund.nav)}</b></span><span><small>SESSION NAV Δ</small><b>{signedUsd(liveFund.dayPnl)}</b></span>
      <span><small>DB ACTIVE</small><b>{active.length}</b></span><span><small>DB RISK</small><b>{moneyK(risk)}</b></span>
    </div>
    <Section title="SESSION BOOKS" meta={`${feed.sessionTrades.closed} logical closed · ${feed.sessionTrades.open} open · ${feed.sessionTrades.positionRows} rows`} collapsible>
      {rows.length === 0 ? <div className="m2-desk-empty">no channel attribution this session</div> : <div className="m2-daybooks">{rows.map(({ channel, pnl }) => <span key={channel.slug}><i style={{ background: pmVar(channel.color) }} /><b>{channel.slug}</b><em className={pnl < 0 ? "neg" : "pos"}>{signedUsd(pnl)}</em></span>)}</div>}
    </Section>
    <Section title="ACTIVE RELEASE" meta="startup receipt · not liveness" collapsible>
      {release ? <div className="m2-release-receipt"><b>{release.releaseId}</b><small>{release.configHash}</small></div> : <div className="m2-desk-empty">dedicated release receipt unavailable</div>}
    </Section>
    <button type="button" className="m2-open-settings" onClick={onOpenSettings}>OPEN SETTINGS · AUTH · PUSH · LOG</button>
  </>;
}

function BuildView({ props, channels, onAddChannel }: { props: SurfaceProps; channels: StrategistState[]; onAddChannel: () => void }) {
  const bench = channels.filter((channel) => channel.status !== "armed");
  return <>
    <Section title="ADD CHANNEL" meta="thesis → spec → gate → arm">
      <p className="m2-build-copy">Import a strategy thesis, compile it into executable rules, run the modeled gate, then arm it or save it to the bench.</p>
      <button type="button" className="m2-build-add" disabled={!props.write.canDirectConfigure} title={props.write.canDirectConfigure ? "Add a channel" : props.write.configurationWriteFact} onClick={onAddChannel}>{props.write.canWrite ? "+ ADD VIA PROPOSAL" : "SIGN IN TO REVIEW"}</button>
    </Section>
    <Section title="BENCH" meta="draft · disabled · wind-down">
      {bench.length === 0 ? <div className="m2-desk-empty">bench empty</div> : <div className="m2-bench-list">{bench.map((channel) => <div key={channel.slug} style={{ ["--pm" as string]: pmVar(channel.color) }}><i /><span><b>{channel.slug}</b><small>{channel.regime} · {channel.underlying}</small></span><em>{channel.status.toUpperCase()}</em></div>)}</div>}
    </Section>
    <Section title="MOBILE PARITY" meta="deliberate scope">
      <div className="m2-parity-note">Live book, broker reconciliation, retained event tape, linked trade evidence, nightly read, preflight, day books, settings, and channel creation are available here. Deep historical autopsy and shadow-book forensics remain desktop review tools until their data is lifted to the shared seam.</div>
    </Section>
  </>;
}

export function MobileDeskSheet({ open, onClose, props, channels, livePnl, onOpenSettings, onAddChannel }: {
  open: boolean; onClose: () => void; props: SurfaceProps; channels: StrategistState[]; livePnl: Record<string, ChannelPnl>;
  onOpenSettings: () => void; onAddChannel: () => void;
}) {
  const [tab, setTab] = useState<DeskTab>("book");
  if (!open) return null;
  return <div className="m2-desk-ov" role="presentation">
    <section className="m2-desk-sheet" role="dialog" aria-modal="true" aria-label="desk rooms">
      <header className="m2-desk-top"><span className="stripes"><i /><i /><i /></span><b>DESK · ROOMS</b><small>legacy information · mobile-native</small><button type="button" onClick={onClose}>✕</button></header>
      <nav className="m2-desk-tabs" aria-label="desk room">
        {TABS.map((item) => <button type="button" key={item.id} className={tab === item.id ? "on" : ""} onClick={() => setTab(item.id)} aria-pressed={tab === item.id}><b>{item.label}</b><small>{item.sub}</small></button>)}
      </nav>
      <div className="m2-desk-scroll">
        {tab === "book" && <MobileBookView props={props} />}
        {tab === "review" && <MobileReviewView props={props} channels={channels} livePnl={livePnl} />}
        {tab === "ops" && <MobileOpsView props={props} channels={channels} onOpenSettings={onOpenSettings} />}
        {tab === "build" && <BuildView props={props} channels={channels} onAddChannel={onAddChannel} />}
      </div>
    </section>
  </div>;
}

export function MobileDeskRoom({ room, props, channels, livePnl, onViewMarket, onOpenSettings }: {
  room: "book" | "review" | "ops";
  props: SurfaceProps;
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  onViewMarket: (view: "chart" | "chain") => void;
  onOpenSettings: () => void;
}) {
  return <div className="m2-scroll m2-room-scroll"><div className="m2-desk-scroll">
    {room === "book" && <MobileBookView props={props} onViewMarket={onViewMarket} />}
    {room === "review" && <MobileReviewView props={props} channels={channels} livePnl={livePnl} />}
    {room === "ops" && <MobileOpsView props={props} channels={channels} onOpenSettings={onOpenSettings} />}
  </div></div>;
}
