"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Chassis } from "@/components/console/Chassis";
import { AddChannel } from "@/components/console/AddChannel";
import { HeadReadouts } from "@/components/console/HeadReadouts";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetail } from "@/components/ContractDetail";
import { TapeHealth } from "@/components/TapeHealth";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { MasterStrip } from "@/components/console/MasterStrip";
import { StepRow } from "@/components/console/hw/StepRow";
import { Bezel } from "@/components/console/hw/Bezel";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { SignalsTape } from "@/components/console/SignalsTape";
import { DailyAutopsyPanel } from "@/components/console/DailyAutopsyPanel";
import { computeLiveMarks } from "@/lib/desk/liveMarks";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { Position } from "@/lib/desk/types";

// The whole desk on one TR-909 surface: LIVE market readout → strategy COMPOSER
// → LOG, all inside one cream chassis. The desktop layout.
const SECTIONS = [
  { id: "live", label: "Live Desk" },
  { id: "composer", label: "Strategy Composer" },
  { id: "log", label: "Log" },
] as const;

function SectionLabel({ id, idx, children }: { id: string; idx: string; children: ReactNode }) {
  return (
    <div className="section-label" id={id}>
      <span className="idx">{idx}</span>
      <span className="lab">{children}</span>
    </div>
  );
}

export function DesktopSurface({
  data,
  view,
  feed,
  write,
  spotUp,
  selected,
  setSelected,
}: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [addOpen, setAddOpen] = useState(false);
  const [hlTrade, setHlTrade] = useState<Position | null>(null); // trade highlighted on the chart
  const { canWrite } = write;

  // occ_symbol → live option mark (delta-extrapolated off the fast spot tick), so
  // open positions mark in real time, not once a minute. Recomputes each spot tick.
  const liveMarks = useMemo(() => computeLiveMarks(data.snapshot, data.spot), [data.snapshot, data.spot]);

  return (
    <Chassis
      brand={<>$EVE<span> · DESK</span></>}
      sub="Get Money, Fuck Bitches."
      right={
        <div className="head-nav">
          <nav className="surface-nav" aria-label="sections">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.label}
              </a>
            ))}
          </nav>
          <span
            className={`write-chip${canWrite ? " on" : ""}`}
            title={canWrite ? "changes persist to the desk" : "sign in (top right) to save changes"}
          >
            {canWrite ? "● operator" : "○ read-only"}
          </span>
        </div>
      }
    >
      <div className="surface-bar">
        <MasterStrip fund={desk.fund} fundPnl={feed.fundPnl} compact />
        <HeadReadouts fund={desk.fund} fundPnl={feed.fundPnl} spot={data.spot} spotUp={spotUp} />
      </div>

      {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}

      {/* ---- 01 · LIVE DESK (chart hero → book + chain | P&L) ---------- */}
      <SectionLabel id="live" idx="01">Live Desk</SectionLabel>
      <IntradayChart bars={data.bars} dailyBars={data.dailyBars} spot={data.spot} spotUp={spotUp} trades={feed.recentTrades} openPositions={feed.positions} highlightTrade={hlTrade} />
      <div className="grid grid--live live-body">
        <div className="col">
          <PositionsPanel positions={feed.positions} strategists={desk.strategists} recentTrades={feed.recentTrades} liveMarks={liveMarks} onOpenTrade={setHlTrade} />
          <OptionChain
            snapshot={data.snapshot}
            spot={data.spot}
            deltasModeled={data.deltasModeled}
            selected={selected}
            onSelect={(s) => setSelected((cur) => (cur === s ? null : s))}
          />
          {selected && <ContractDetail occSymbol={selected} onClose={() => setSelected(null)} />}
        </div>
        <div className="col col--fill">
          <PnlPanel
            strategists={desk.strategists}
            pnlByStrategist={feed.pnlByStrategist}
            fundPnl={feed.fundPnl}
            equityCurve={feed.equityCurve}
          />
        </div>
      </div>

      {/* ---- 02 · STRATEGY COMPOSER ----------------------------------- */}
      <SectionLabel id="composer" idx="02">
        Strategy Composer
        <button className="add-channel-btn" onClick={() => setAddOpen(true)}>+ Add Channel</button>
      </SectionLabel>
      {addOpen && (
        <AddChannel
          onClose={() => setAddOpen(false)}
          existingSlugs={desk.strategists.map((s) => s.slug)}
        />
      )}
      <div className="console-grid">
        <div className="channels">
          {desk.strategists.map((s) => (
            <ChannelStrip
              key={s.slug}
              strategist={s}
              pnl={feed.pnlByStrategist[s.slug]}
              active={isActive(s.slug)}
              ducked={anySolo && !s.config.soloed && !s.config.muted}
            />
          ))}
        </div>
        <MasterStrip fund={desk.fund} fundPnl={feed.fundPnl} />
      </div>
      <Bezel label="16-Step Tape · recent signals" className="tape">
        <StepRow steps={feed.steps} />
      </Bezel>

      {/* ---- 03 · LOG (autopsy → signals + tape health → event log) --- */}
      <SectionLabel id="log" idx="03">Log</SectionLabel>
      <DailyAutopsyPanel strategists={desk.strategists} />
      <div className="grid grid--live grid--even" style={{ marginTop: 14 }}>
        <div className="col">
          <SignalsTape signals={feed.signals} />
        </div>
        <div className="col">
          <TapeHealth
            rowCount={data.rowCount}
            lastIngestTs={data.lastIngestTs}
            snapCount={data.snapshot.length}
            expirations={data.expirations}
          />
        </div>
      </div>
      <div className="log-foot">
        <EventLog events={data.events} />
      </div>
    </Chassis>
  );
}
