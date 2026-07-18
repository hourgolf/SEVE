"use client";

import { useMemo, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetailView } from "@/components/ContractDetail";
import { MobilePositions } from "@/components/mobile2/MobilePositions";
import { computeNetExposure } from "@/lib/desk/netExposure";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay, usd0 } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { deriveRecentExits } from "@/lib/perform/derivePositionsWorkspace";
import { SentinelReceiptStrip } from "@/components/perform/SentinelWorkspace";

type DeskTab = "book" | "review" | "ops" | "build";

const TABS: { id: DeskTab; label: string; sub: string }[] = [
  { id: "book", label: "BOOK", sub: "live" },
  { id: "review", label: "REVIEW", sub: "tape" },
  { id: "ops", label: "OPS", sub: "tend" },
  { id: "build", label: "BUILD", sub: "write" },
];

const age = (sec: number | null) => sec == null ? "—" : sec < 90 ? `${sec}s` : sec < 5400 ? `${Math.round(sec / 60)}m` : `${Math.round(sec / 3600)}h`;
const moneyK = (value: number) => Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(1)}k` : usd0(value);

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return <section className="m2-desk-section"><header><b>{title}</b>{meta && <span>{meta}</span>}</header><div className="m2-desk-body">{children}</div></section>;
}

function BookView({ props, onViewChart }: { props: SurfaceProps; onViewChart?: () => void }) {
  const { data, feed, liveMarks, selected, setSelected, contractHistory, symbol } = props;
  const exposure = useMemo(() => computeNetExposure(feed.positions, liveMarks), [feed.positions, liveMarks]);
  const recentExits = useMemo(() => deriveRecentExits(feed.recentTrades), [feed.recentTrades]);
  const selectedQuote = selected ? data.snapshot.find((quote) => quote.occ_symbol === selected) : undefined;
  const signals = feed.signals.slice(0, 18);

  return <>
    <div className="m2-book-nav"><span><b>LIVE BOOK</b><small>positions first · exposure second</small></span>{onViewChart && <button type="button" onClick={onViewChart}>VIEW CHART</button>}</div>
    <MobilePositions props={props} strategists={props.view.desk.strategists} compact />
    <div className="m2-desk-hero">
      <span><small>OPEN</small><b>{feed.positions.length}</b></span>
      <span><small>CONTRACTS</small><b>{exposure.totalContracts}</b></span>
      <span><small>STACKED</small><b className={exposure.stackedOccCount ? "warn" : ""}>{exposure.stackedOccCount}/{exposure.occCount}</b></span>
      <span><small>NOTIONAL</small><b>{moneyK(exposure.totalNotional)}</b></span>
    </div>

    <Section title="NET EXPOSURE" meta="correlated lot · no caps">
      {exposure.occCount === 0 ? <div className="m2-desk-empty">flat — no aggregate exposure</div> : <>
        <div className="m2-desk-directions">
          {exposure.byUnderlying.map((row) => <span key={row.underlying}><b>{row.underlying}</b><i className="pos">{row.callContracts}C</i><i className="neg">{row.putContracts}P</i><em>{moneyK(row.notional)}</em></span>)}
        </div>
        <div className="m2-desk-rows">
          {exposure.byOcc.slice(0, 8).map((row) => <div key={row.occ} className={row.channels.length >= 4 ? "hot" : ""}>
            <b>{row.underlying} {row.strike.toFixed(0)}{row.optType === "call" ? "C" : "P"}</b>
            <span>×{Math.abs(row.contracts)}</span><span>{row.channels.length} ch</span><em>{moneyK(row.notional)}</em>
          </div>)}
        </div>
      </>}
    </Section>

    <Section title="RECENT EXITS" meta={`${recentExits.rows.length} today · ${signedUsd(recentExits.realized)}`}>
      <div className="m2-recent-exits">
        {recentExits.rows.length === 0 ? <div className="m2-desk-empty">no completed exits in the current feed</div> : recentExits.rows.slice(0, 10).map((row) => {
          const trade = row.position;
          const realized = trade.realized_pnl ?? 0;
          const root = trade.occ_symbol.match(/^([A-Z]+)\d/)?.[1] ?? "?";
          const closeReason = trade.close_reason ? trade.close_reason.replace(/^manual:?/, "operator · ").replaceAll("_", " ") : "unclassified";
          return <div key={trade.id} style={{ ["--pm" as string]: pmVar(props.view.desk.strategists.find((channel) => channel.slug === trade.strategist_slug)?.color ?? "green") }}>
            <i /><span><b>{trade.strategist_slug}</b><small>{root} {trade.strike.toFixed(0)}{trade.opt_type === "call" ? "C" : "P"} ×{Math.abs(trade.qty)} · {closeReason}</small></span>
            <em className={realized < 0 ? "neg" : "pos"}>{signedUsd(realized)}</em>
            <p>in {trade.avg_entry_price.toFixed(2)} → out {trade.current_mark.toFixed(2)} · {row.returnPct == null ? "ret —" : `ret ${row.returnPct >= 0 ? "+" : ""}${Math.round(row.returnPct)}%`} · {row.peakPct == null ? "pk —" : `pk +${Math.round(row.peakPct)}%`}{row.peakExceeded ? " · exit > recorded pk" : row.capturePct == null ? "" : ` · kept ${Math.round(row.capturePct)}%`}</p>
          </div>;
        })}
      </div>
    </Section>

    <Section title="SIGNALS" meta="latest · repeats retained">
      <div className="m2-desk-signals">
        {signals.length === 0 ? <div className="m2-desk-empty">listening for signals</div> : signals.map((signal) => <div key={signal.id}>
          <time>{timeOfDay(signal.created_at)}</time><b className={signal.level.toLowerCase()}>{signal.level}</b>
          <span><strong>{signal.strategist_slug}</strong> · {signal.signal_type} · {signal.message}</span>
        </div>)}
      </div>
    </Section>

    <Section title={`${symbol} OPTION CHAIN`} meta="front expiry · tap a leg">
      <div className="m2-desk-chain">
        <OptionChain snapshot={data.snapshot} spot={data.spot} deltasModeled={data.deltasModeled} selected={selected}
          onSelect={(occ) => setSelected((current) => current === occ ? null : occ)} compact symbol={symbol} />
        {selectedQuote && <div className="m2-quote-detail">
          <b>{selectedQuote.occ_symbol}</b><button type="button" onClick={() => setSelected(null)}>CLEAR</button>
          <span><small>BID</small>{selectedQuote.bid?.toFixed(2) ?? "—"}</span>
          <span><small>ASK</small>{selectedQuote.ask?.toFixed(2) ?? "—"}</span>
          <span><small>MID</small>{selectedQuote.mid?.toFixed(2) ?? "—"}</span>
          <span><small>DELTA</small>{selectedQuote.delta?.toFixed(2) ?? "—"}</span>
          <span><small>IV</small>{selectedQuote.iv != null ? `${(selectedQuote.iv * 100).toFixed(1)}%` : "—"}</span>
          <span><small>SPOT</small>{selectedQuote.underlying_price?.toFixed(2) ?? "—"}</span>
        </div>}
        {selected && <ContractDetailView occSymbol={selected} onClose={() => setSelected(null)} history={contractHistory} />}
      </div>
    </Section>
  </>;
}

function ReviewView({ props, channels, livePnl }: { props: SurfaceProps; channels: StrategistState[]; livePnl: Record<string, ChannelPnl> }) {
  const { feed, liveFund, sentinel } = props;
  const rows = channels.map((channel) => ({ channel, pnl: livePnl[channel.slug] })).sort((a, b) => Math.abs(b.pnl?.dayPnl ?? 0) - Math.abs(a.pnl?.dayPnl ?? 0));
  const equity = feed.equityCurve.map((point) => point.equity);
  const brief = sentinel.brief;
  const judge = sentinel.judge;

  return <>
    <SentinelReceiptStrip sentinel={sentinel} compact />
    <div className="m2-desk-hero">
      <span><small>DAY P&amp;L</small><b className={liveFund.dayPnl < 0 ? "neg" : "pos"}>{signedUsd(liveFund.dayPnl)}</b></span>
      <span><small>NAV</small><b>{usd0(liveFund.nav)}</b></span>
      <span><small>CLOSED</small><b>{feed.recentTrades.length}</b></span>
      <span><small>OPEN</small><b>{feed.positions.length}</b></span>
    </div>

    <Section title="EQUITY" meta="desk feed · today">
      {equity.length >= 2 ? <LineChart values={equity} height={92} id="m2-desk-equity" baseline={equity[0]} format={usd0} formatDelta={signedUsd} labels={feed.equityCurve.map((point) => timeOfDay(point.ts))} />
        : <div className="m2-desk-empty">awaiting equity history</div>}
    </Section>

    <Section title="CHANNEL ATTRIBUTION" meta="gross desk marks">
      <div className="m2-review-rows">
        {rows.map(({ channel, pnl }) => {
          const trades = pnl?.trades ?? 0;
          const peak = pnl?.pkN ? Math.round(pnl.pkSum / pnl.pkN) : null;
          const win = trades ? Math.round((100 * pnl.wins) / trades) : null;
          return <div key={channel.slug} style={{ ["--pm" as string]: pmVar(channel.color) }}><i /><b>{channel.slug}</b>
            <span className={(pnl?.dayPnl ?? 0) < 0 ? "neg" : (pnl?.dayPnl ?? 0) > 0 ? "pos" : ""}>{signedUsd(pnl?.dayPnl ?? 0)}</span>
            <small>{trades}t · pk {peak ?? "—"}% · win {win ?? "—"}%</small></div>;
        })}
      </div>
    </Section>

    <Section title="NIGHTLY READ" meta={sentinel.date ? `scan ${sentinel.date.slice(5)}` : sentinel.state}>
      {sentinel.state !== "ok" ? <div className="m2-desk-empty">nightly review {sentinel.state}</div> : <div className="m2-nightly">
        {judge && <><div className="verdict"><b>{judge.verdict}</b><span>{judge.soWhat}</span></div>
          {judge.opportunities.length > 0 && <div><small>OPPORTUNITIES</small>{judge.opportunities.map((item, index) => <p key={index}>{item}</p>)}</div>}
          {judge.drift.length > 0 && <div><small>DRIFT</small>{judge.drift.map((item, index) => <p key={index}>{item}</p>)}</div>}</>}
        {brief && <>
          <div><small>NEXT OPEN</small>{brief.carry.watch.map((item, index) => <p key={index}>{item}</p>)}</div>
          {brief.events.length > 0 && <div><small>EVENTS</small>{brief.events.map((item, index) => <p key={index}>{item}</p>)}</div>}
        </>}
      </div>}
    </Section>
    <Section title="DETERMINISTIC SCAN" meta="descriptive · not an arm gate">
      {!sentinel.scan ? <div className="m2-desk-empty">scan evidence unavailable</div> : <div className="m2-review-scan">
        {[...sentinel.scan.promote.map((row) => ({ ...row, kind: "PROMOTE" })), ...sentinel.scan.fixable.map((row) => ({ ...row, kind: "FIX" })), ...sentinel.scan.leaks.map((row) => ({ ...row, kind: "LEAK" }))].slice(0, 12).map((row) => <div key={`${row.kind}-${row.slug}`}><b>{row.kind}</b><span>{row.slug}</span><small>pk {Math.round(row.peak)}% · win {Math.round(row.win)}% · give {row.give == null ? "—" : `${Math.round(row.give)}%`} · {row.n}t</small></div>)}
      </div>}
    </Section>
  </>;
}

function OpsView({ props, channels, onOpenSettings }: { props: SurfaceProps; channels: StrategistState[]; onOpenSettings: () => void }) {
  const { data, ops, workerRuns, incident, liveFund, feed, livePnl } = props;
  const active = channels.filter((channel) => channel.status === "armed" && !channel.config.muted);
  const risk = active.reduce((sum, channel) => sum + (channel.config.capital_pct || 0), 0);
  const rows = channels.map((channel) => ({ channel, pnl: livePnl[channel.slug]?.dayPnl ?? 0 })).filter((row) => row.pnl !== 0).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const ingestAge = data.lastIngestTs ? Math.max(0, Math.round((Date.now() - Date.parse(data.lastIngestTs)) / 1000)) : null;

  return <>
    <section className={`m2-incident-card ${incident.severity}`}><header><i /><b>{incident.title}</b><span>{incident.severity.toUpperCase()}</span></header>
      <p>desk shows {feed.positions.length} open positions</p>{incident.facts.slice(0, 3).map((fact, index) => <p key={index}>{fact}</p>)}</section>
    <Section title="PREFLIGHT" meta={incident.session.replaceAll("_", " ")}>
      <div className="m2-preflight">
        <span><b>PROCESS</b><em>{workerRuns.query.state === "ok" ? "OBSERVED" : workerRuns.query.state.toUpperCase()}</em><small>{workerRuns.rowsIn16h} runs / 16h</small></span>
        <span><b>STREAM</b><em>{ops.heartbeat.state.toUpperCase()}</em><small>{age(ops.hbAgeSec)} · {ops.streamArmed} armed</small></span>
        <span><b>CRON</b><em>{ops.cron.state.toUpperCase()}</em><small>{age(ops.cronAgeSec)} · {ops.cronArmed} armed</small></span>
        <span><b>TAPE</b><em>{data.lastIngestTs ? "OBSERVED" : "MISSING"}</em><small>{age(ingestAge)} · {data.snapshot.length} contracts</small></span>
      </div>
    </Section>
    <div className="m2-desk-hero">
      <span><small>NAV</small><b>{usd0(liveFund.nav)}</b></span><span><small>DAY</small><b>{signedUsd(liveFund.dayPnl)}</b></span>
      <span><small>ACTIVE</small><b>{active.length}</b></span><span><small>RISK ALLOC</small><b>{moneyK(risk)}</b></span>
    </div>
    <Section title="DAY BOOKS" meta={`${feed.recentTrades.length} closed · ${feed.positions.length} open`}>
      {rows.length === 0 ? <div className="m2-desk-empty">no attributed P&amp;L today</div> : <div className="m2-daybooks">{rows.map(({ channel, pnl }) => <span key={channel.slug}><i style={{ background: pmVar(channel.color) }} /><b>{channel.slug}</b><em className={pnl < 0 ? "neg" : "pos"}>{signedUsd(pnl)}</em></span>)}</div>}
    </Section>
    <button type="button" className="m2-open-settings" onClick={onOpenSettings}>OPEN SETTINGS · AUTH · PUSH · LOG</button>
  </>;
}

function BuildView({ props, channels, onAddChannel }: { props: SurfaceProps; channels: StrategistState[]; onAddChannel: () => void }) {
  const bench = channels.filter((channel) => channel.status !== "armed");
  return <>
    <Section title="ADD CHANNEL" meta="thesis → spec → gate → arm">
      <p className="m2-build-copy">Import a strategy thesis, compile it into executable rules, run the modeled gate, then arm it or save it to the bench.</p>
      <button type="button" className="m2-build-add" disabled={!props.write.canWrite} onClick={onAddChannel}>{props.write.canWrite ? "+ ADD CHANNEL" : "SIGN IN TO ADD CHANNEL"}</button>
    </Section>
    <Section title="BENCH" meta="draft · disabled · wind-down">
      {bench.length === 0 ? <div className="m2-desk-empty">bench empty</div> : <div className="m2-bench-list">{bench.map((channel) => <div key={channel.slug} style={{ ["--pm" as string]: pmVar(channel.color) }}><i /><span><b>{channel.slug}</b><small>{channel.regime} · {channel.underlying}</small></span><em>{channel.status.toUpperCase()}</em></div>)}</div>}
    </Section>
    <Section title="MOBILE PARITY" meta="deliberate scope">
      <div className="m2-parity-note">Live book, today review, nightly read, preflight, day books, settings, and channel creation are available here. Deep historical autopsy and shadow-book forensics remain desktop review tools until their data is lifted to the shared seam.</div>
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
        {tab === "book" && <BookView props={props} />}
        {tab === "review" && <ReviewView props={props} channels={channels} livePnl={livePnl} />}
        {tab === "ops" && <OpsView props={props} channels={channels} onOpenSettings={onOpenSettings} />}
        {tab === "build" && <BuildView props={props} channels={channels} onAddChannel={onAddChannel} />}
      </div>
    </section>
  </div>;
}

export function MobileDeskRoom({ room, props, channels, livePnl, onViewChart, onOpenSettings }: {
  room: "book" | "review" | "ops";
  props: SurfaceProps;
  channels: StrategistState[];
  livePnl: Record<string, ChannelPnl>;
  onViewChart: () => void;
  onOpenSettings: () => void;
}) {
  return <div className="m2-scroll m2-room-scroll"><div className="m2-desk-scroll">
    {room === "book" && <BookView props={props} onViewChart={onViewChart} />}
    {room === "review" && <ReviewView props={props} channels={channels} livePnl={livePnl} />}
    {room === "ops" && <OpsView props={props} channels={channels} onOpenSettings={onOpenSettings} />}
  </div></div>;
}
