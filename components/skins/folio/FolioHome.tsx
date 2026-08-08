"use client";

import { IntradayChart } from "@/components/IntradayChart";
import { MobileDock } from "@/components/mobile2/MobileDock";
import { MobilePositions } from "@/components/mobile2/MobilePositions";
import { IncidentDetail } from "@/components/perform/IncidentDetail";
import { PerformDock } from "@/components/perform/PerformDock";
import { PositionsSection } from "@/components/perform/PerformRail";
import { SystemHealthStrip } from "@/components/perform/SystemHealthStrip";
import { TapeReadStrip } from "@/components/perform/EventTapeWorkspace";
import { deriveSentinelDigestReceipt } from "@/components/perform/SentinelWorkspace";
import type { SurfaceProps } from "@/components/surfaceTypes";
import { timeOfDay } from "@/lib/format";
import { deriveTapeRows } from "@/lib/perform/eventTape";
import { DecisionAtlasFleetPulse } from "@/components/research/DecisionAtlasFleetPulse";

function FolioSentinelCard({ surface, compact = false }: { surface: SurfaceProps; compact?: boolean }) {
  const { sentinel, symbol } = surface;
  const receipt = deriveSentinelDigestReceipt(sentinel);
  const verdict = sentinel.judge?.verdict ?? "CHECKING";
  const message = sentinel.judge?.soWhat ?? "Nightly interpretation will appear after the next complete session.";
  const candidate = sentinel.scan?.promote?.[0] ?? sentinel.scan?.fixable?.[0] ?? null;
  const terrain = sentinel.brief?.sentLevels?.[symbol];
  const levels = [...(terrain?.above ?? []), ...(terrain?.below ?? [])].slice(0, 2);

  return (
    <section className={`folio-work-card folio-sentinel-card${compact ? " compact" : ""}`}>
      <header><span><small>SENTINEL</small><b>{verdict}</b></span><em data-tone={receipt.tone}>{receipt.label}</em></header>
      <p>{message}</p>
      <footer>
        {candidate ? <span><small>LEADING PROBE</small><b>{candidate.slug}</b><em>{candidate.n}/15 samples</em></span> : <span><small>PROBE</small><b>None queued</b></span>}
        {levels.map((level) => <span key={`${level.label}-${level.px}`}><small>{level.label}</small><b>{level.px}</b></span>)}
      </footer>
    </section>
  );
}

function FolioActivityCard({ surface, compact = false }: { surface: SurfaceProps; compact?: boolean }) {
  const rows = deriveTapeRows(surface.data.events).slice(0, compact ? 4 : 6);
  return (
    <section className={`folio-work-card folio-activity-card${compact ? " compact" : ""}`}>
      <header><span><small>ACTIVITY</small><b>Latest desk events</b></span><em>LIVE</em></header>
      <TapeReadStrip health={surface.data.readHealth.events} events={surface.data.events} compact />
      <div className="folio-activity-rows">
        {rows.length === 0 ? <p className="folio-empty">No retained events yet.</p> : rows.map((row) => (
          <div key={row.id} data-kind={row.category}>
            <time>{timeOfDay(row.created_at)}</time><b>{row.level}</b><span>{row.message}</span>{row.count > 1 && <em>×{row.count}</em>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FolioMarketCard({ surface, mobile = false }: { surface: SurfaceProps; mobile?: boolean }) {
  const { data, feed, spotUp, symbol, setSymbol } = surface;
  return (
    <section className={`folio-market-card${mobile ? " mobile" : ""}`}>
      <header>
        <span><small>LIVE MARKET</small><b>{symbol} intraday</b></span>
        <em>{data.spot == null ? "Awaiting quote" : `${data.spot.toFixed(2)} · ${spotUp ? "UP" : "DOWN"}`}</em>
      </header>
      {data.warning && <div className="market-read-warning" role="status">{data.warning}</div>}
      <div className="folio-market-chart">
        <IntradayChart
          bars={data.bars}
          dailyBars={data.dailyBars}
          spot={data.spot}
          spotUp={spotUp}
          mobile={mobile}
          trades={feed.recentTrades}
          openPositions={feed.positions}
          symbol={symbol}
          onSymbolChange={setSymbol}
          fill={!mobile}
        />
      </div>
    </section>
  );
}

export function FolioHomeDesktop({ surface }: { surface: SurfaceProps }) {
  const channels = surface.acctId
    ? surface.view.desk.strategists.filter((channel) => channel.account_id === surface.acctId)
    : surface.view.desk.strategists;
  const reconciliation = surface.opsReadiness.evidence.find((item) => item.id === "reconciliation");

  return (
    <div className="folio-home folio-home-desktop">
      <div className="folio-home-grid">
        <FolioMarketCard surface={surface} />
        <aside className="folio-home-side">
          <DecisionAtlasFleetPulse reports={surface.decisionAtlas} />
          <section className="folio-health-card"><SystemHealthStrip incident={surface.incident} /><IncidentDetail incident={surface.incident} /></section>
          <div className="folio-position-card">
            <PositionsSection
              positions={surface.feed.positions}
              strategists={surface.view.desk.strategists}
              liveMarks={surface.liveMarks}
              peaks={surface.positionPeaks}
              write={surface.write}
              targeted={false}
              reconciliation={reconciliation}
              channelWorkspace={surface.channelWorkspace}
            />
          </div>
          <FolioSentinelCard surface={surface} />
          <FolioActivityCard surface={surface} />
        </aside>
      </div>
      <div className="folio-channel-drawer"><PerformDock channels={channels} livePnl={surface.livePnl} channelWorkspace={surface.channelWorkspace} /></div>
    </div>
  );
}

export function FolioHomeMobile({ surface }: { surface: SurfaceProps }) {
  const channels = surface.acctId
    ? surface.view.desk.strategists.filter((channel) => channel.account_id === surface.acctId)
    : surface.view.desk.strategists;
  return (
    <div className="folio-home folio-home-mobile">
      <div className="folio-home-scroll">
        <DecisionAtlasFleetPulse reports={surface.decisionAtlas} />
        <FolioMarketCard surface={surface} mobile />
        <MobilePositions props={surface} strategists={surface.view.desk.strategists} />
        <FolioSentinelCard surface={surface} compact />
        <FolioActivityCard surface={surface} compact />
      </div>
      <div className="folio-mobile-drawer"><MobileDock channels={channels} livePnl={surface.livePnl} lens={surface.sentinel.lens} write={surface.write} /></div>
    </div>
  );
}
