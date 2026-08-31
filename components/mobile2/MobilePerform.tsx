"use client";

import { Fragment, useState } from "react";
import { IntradayChart } from "@/components/IntradayChart";
import { MobileDock } from "@/components/mobile2/MobileDock";
import { MobilePositions } from "@/components/mobile2/MobilePositions";
import type { useSentinelDigest } from "@/hooks/useSentinelDigest";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd, timeOfDay } from "@/lib/format";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { TapeReadStrip } from "@/components/perform/EventTapeWorkspace";
import { deriveSentinelDigestReceipt } from "@/components/perform/SentinelWorkspace";
import { deriveTapeRows } from "@/lib/perform/eventTape";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetailView } from "@/components/ContractDetail";
import { MarketOpenRisk, MarketReadStrip } from "@/components/perform/PerformMarketsWorkspace";
import { SUPPORTED_UNDERLYINGS } from "@/lib/desk/strategySpec";
import { buildFleetDecisionSummary } from "@/lib/research/channelDecisionSummary";
import { decisionAtlasFreshnessShortLabel } from "@/lib/research/decisionAtlasFreshness";

// =============================================================================
// MOBILE · PERFORM (S5) — the watch surface as ONE vertical scroll (the gallery
// mock's perform frame): chart+SENT → positions → sentinel → tape, with the
// 2-row chicklet dock pinned above the tab bar. Every data source is REUSED from
// the seam (IntradayChart, feed.positions + usePositionPeaks, useSentinelDigest,
// data.events, the account-scoped roster). This is the phone twin of the desktop
// PerformSurface/PerformRail — parallel markup, identical semantics.
// =============================================================================

type Digest = ReturnType<typeof useSentinelDigest>;
export type MobileMarketView = "chart" | "chain";

function SentinelSection({ symbol, sent }: { symbol: string; sent: Digest }) {
  const { judge, scan, brief, date, state } = sent;
  const receipt = deriveSentinelDigestReceipt(sent);
  const receiptText = receipt.tone === "green" && date ? `scan ${date.slice(5)}` : receipt.label.toLowerCase();
  const terrain = brief?.sentLevels?.[symbol];
  const above = terrain?.above ?? brief?.carry.above ?? [];
  const below = terrain?.below ?? brief?.carry.below ?? [];
  const all = [...above, ...below];
  const gamma = all.find((l) => l.label.includes("γ"));
  const swing = all.find((l) => !l.label.includes("γ"));
  const armHi = terrain?.armHi ?? brief?.carry.bandHi ?? null;

  const cand = scan?.promote?.[0] ?? scan?.fixable?.[0] ?? null;
  const n = cand ? Math.min(cand.n, 15) : 0;
  const verdict = judge?.verdict ?? "HOLD";
  const vcls = verdict === "QUEUE" ? "queue" : verdict === "WATCH" ? "watch" : "hold";

  return (
    <section className="m2-screen m2-hardware">
      <div className="m2-phead">
        <span className="t">SENTINEL</span>
        <span className="grow" />
        <span className={`x m2-receipt-${receipt.tone}`}>{receiptText} {receipt.tone === "green" ? "✓" : "!"}</span>
      </div>
      <div className="m2-sent-body">
        {state !== "ok" || !judge ? (
          <div className="m2-ghost">no verdict yet — runs after each close</div>
        ) : (
          <>
            <div className="m2-sent-top">
              <span className={`m2-verdict ${vcls}`}>{verdict}</span>
              <span className="m2-sent-msg">{judge.soWhat}</span>
            </div>
            {cand && (
              <div className="m2-steps" title={`${cand.slug} — sample ${cand.n} toward the N=15 arm gate`}>
                {Array.from({ length: 15 }, (_, i) => <i key={i} className={i < n ? "lit" : ""} />)}
                <span className="m2-steps-n num">{n}/15</span>
              </div>
            )}
            {(gamma || swing || armHi != null) && (
              <div className="m2-ladder">
                {gamma && <span className="m2-lvl"><i style={{ background: "var(--m2-amber)" }} />γ-wall <b>{gamma.px}</b></span>}
                {swing && <span className="m2-lvl"><i style={{ background: "var(--m2-mut)" }} />{swing.label.slice(0, 10)} <b>{swing.px}</b></span>}
                {armHi != null && <span className="m2-lvl"><i style={{ background: "var(--m2-green)" }} />gap-arm <b>{armHi}</b></span>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const KIND: Record<string, string> = { EXEC: "exec", WARN: "warn", RISK: "warn", INFO: "info", OK: "info" };

function TapeMsg({ message, strategists }: { message: string; strategists: StrategistState[] }) {
  const hit = strategists.find((s) => message.includes(s.slug));
  if (!hit) return <span className="m2-t-msg">{message}</span>;
  const i = message.indexOf(hit.slug);
  return (
    <span className="m2-t-msg">
      {message.slice(0, i)}
      <span className="ch" style={{ color: pmVar(hit.color) }}>{hit.slug}</span>
      {message.slice(i + hit.slug.length)}
    </span>
  );
}

function TapeSection({ events, strategists, health }: { events: MarketEvent[]; strategists: StrategistState[]; health: SurfaceProps["data"]["readHealth"]["events"] }) {
  const rows = deriveTapeRows(events);
  return (
    <section className="m2-screen m2-glass">
      <div className="m2-phead">
        <span className="t">TAPE</span>
        <span className="grow" />
        <span className="x">NEWEST {events.length}/14</span>
      </div>
      <TapeReadStrip health={health} events={events} compact />
      <div>
        {rows.length === 0 ? (
          <div className="m2-ghost">no events yet</div>
        ) : rows.map((e) => (
          <Fragment key={e.id}>
            <div className="m2-trow">
              <span className="m2-t-time num">{timeOfDay(e.created_at)}</span>
              <span className={`m2-t-kind ${KIND[e.level] ?? "info"}`}>{e.level === "RISK" ? "RISK" : e.level === "OK" ? "OK" : e.level}</span>
              <TapeMsg message={e.message} strategists={strategists} />
              {e.count > 1 && <strong className="m2-t-count">×{e.count}</strong>}
            </div>
          </Fragment>
        ))}
      </div>
    </section>
  );
}

export function MobilePerform({
  props, channels, sent, livePnl, marketView, onMarketViewChange, onOpenChannel,
}: {
  props: SurfaceProps;
  channels: StrategistState[];
  sent: Digest;
  livePnl: Record<string, ChannelPnl>;
  marketView: MobileMarketView;
  onMarketViewChange: (view: MobileMarketView) => void;
  onOpenChannel?: (slug: string) => void;
}) {
  const { data, view, feed, spotUp, symbol, setSymbol, selected, setSelected, contractHistory } = props;
  const [chartSettingsOpen, setChartSettingsOpen] = useState(false);
  const fleet = buildFleetDecisionSummary(props.decisionAtlas.bySlug, props.decisionAtlas.throughSession);
  const atlasLabel = decisionAtlasFreshnessShortLabel({ freshness: props.decisionAtlas.freshness, reportThroughSession: props.decisionAtlas.throughSession });
  const ready = props.incident.severity === "normal" && props.opsReadiness.summary.tone !== "red";
  const researchVerified = props.decisionAtlas.state === "ready"
    && props.decisionAtlas.publication?.state === "verified" && props.decisionAtlas.freshness === "current";
  const researchLabel = props.decisionAtlas.state === "ready"
    ? props.decisionAtlas.freshness === "stale" ? atlasLabel : researchVerified
      ? `VERIFIED · ${props.decisionAtlas.throughSession?.slice(5).replace("-", "/")}` : "BUNDLE UNVERIFIED"
    : props.decisionAtlas.state.toUpperCase();
  const changeSymbol = (next: string) => {
    setSelected(null);
    setSymbol(next);
  };

  return (
    <>
      <div className="m2-scroll">
        <section className={`m2-decision-home ${ready && researchVerified ? "ready" : "attention"}`} aria-label="Decision Home summary">
          <header><span><small>DECISION HOME</small><b>{ready ? researchVerified ? "PAPER DESK READY" : "PAPER DESK READY · RESEARCH NEEDS REVIEW" : "CHECK BEFORE THE NEXT SESSION"}</b></span><em>{signedUsd(props.liveFund.dayPnl)} TODAY</em></header>
          <p>{!researchVerified ? "Channel research needs a verified close before the next decision." : fleet.lead ? `Next review: ${fleet.lead.channel} · ${fleet.lead.disposition.toLowerCase()}.` : "No urgent channel action. Continue collecting evidence."}</p>
          <div><span data-review={props.opsReadiness.summary.tone === "red"}><small>TRADING</small><b>{props.opsReadiness.summary.tone === "red" ? "REVIEW" : "READY"}</b></span><span data-review={data.status === "err"}><small>DATA</small><b>{data.status === "err" ? "REVIEW" : "AVAILABLE"}</b></span><span data-review={!researchVerified}><small>RESEARCH</small><b>{researchLabel}</b></span></div>
        </section>
        <nav className="m2-market-switch" aria-label="Markets workspace">
          <button type="button" className={marketView === "chart" ? "on" : ""} onClick={() => onMarketViewChange("chart")} aria-pressed={marketView === "chart"}>CHART</button>
          <button type="button" className={marketView === "chain" ? "on" : ""} onClick={() => onMarketViewChange("chain")} aria-pressed={marketView === "chain"}>CHAIN</button>
          <span />
          {SUPPORTED_UNDERLYINGS.map((ticker) => <button type="button" key={ticker} className={`symbol${symbol === ticker ? " on" : ""}`} onClick={() => changeSymbol(ticker)} aria-pressed={symbol === ticker}>{ticker}</button>)}
        </nav>
        {marketView === "chart" ? <>
          <section className="m2-screen">
          <div className="m2-phead">
            <span className="idx">01</span>
            <span className="t">{symbol} · LIVE</span>
            <span className="grow" />
            <button
              type="button"
              className={`m2-chart-settings${chartSettingsOpen ? " on" : ""}`}
              onClick={() => setChartSettingsOpen((open) => !open)}
              aria-label="Chart settings"
              aria-expanded={chartSettingsOpen}
              title="Chart settings — interval, indicators, and line or candles"
            >
              <span aria-hidden="true">⚙</span>
            </button>
          </div>
          <div className="m2-chart-body">
            <IntradayChart
              bars={data.bars}
              dailyBars={data.dailyBars}
              spot={data.spot}
              spotUp={spotUp}
              mobile
              trades={feed.recentTrades}
              openPositions={feed.positions}
              symbol={symbol}
              onSymbolChange={setSymbol}
              hideTitle
              hideSymbolSelector
              mobileSettingsOpen={chartSettingsOpen}
              onMobileSettingsOpenChange={setChartSettingsOpen}
              compactTickerInToolbar
            />
          </div>
        </section>

        {feed.positions.length > 0 && <MobilePositions props={props} strategists={view.desk.strategists} />}
        <SentinelSection symbol={symbol} sent={sent} />
        <TapeSection events={data.events} strategists={view.desk.strategists} health={data.readHealth.events} />
        </> : <>
          <MarketReadStrip surface={props} compact />
          <MarketOpenRisk surface={props} compact />
          <section className="m2-markets-chain">
            <OptionChain snapshot={data.snapshot} spot={data.spot} deltasModeled={data.deltasModeled} selected={selected}
              onSelect={(occ) => setSelected((current) => current === occ ? null : occ)} compact symbol={symbol} />
          </section>
          {selected && <section className="m2-markets-contract"><ContractDetailView occSymbol={selected} onClose={() => setSelected(null)} history={contractHistory} /></section>}
        </>}
      </div>

      <MobileDock channels={channels} livePnl={livePnl} lens={sent.lens} write={props.write} onOpenChannel={onOpenChannel} />
    </>
  );
}
