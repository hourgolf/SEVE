"use client";

import { useState, type ReactNode } from "react";
import "./console.css";
import { useMarketData } from "@/hooks/useMarketData";
import { useDeskState } from "@/hooks/useDeskState";
import { useDeskFeed } from "@/hooks/useDeskFeed";
import { useDeskWrite } from "@/hooks/useDeskWrite";
import { DeskProvider } from "@/components/console/DeskProvider";
import { Chassis } from "@/components/console/Chassis";
import { TopBar } from "@/components/TopBar";
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

// The whole desk on one TR-909 surface: LIVE market readout → strategy COMPOSER
// → DESK book/P&L, all inside one cream chassis. (Formerly three routes.)
const SECTIONS = [
  { id: "live", label: "Live Market" },
  { id: "composer", label: "Strategy Composer" },
  { id: "desk", label: "Book & P&L" },
] as const;

function SectionLabel({ id, idx, children }: { id: string; idx: string; children: ReactNode }) {
  return (
    <div className="section-label" id={id}>
      <span className="idx">{idx}</span>
      <span className="lab">{children}</span>
    </div>
  );
}

function Surface() {
  const data = useMarketData();
  const { desk, anySolo, isActive } = useDeskState();
  const feed = useDeskFeed();
  const { canWrite } = useDeskWrite();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Chassis
      brand={<>SEVE<span> · DESK</span></>}
      sub="SPY · 0DTE / 1DTE · ALPACA → SUPABASE"
      right={
        <div className="surface-status">
          <TopBar status={data.status} spot={data.spot} updatedAt={data.updatedAt} />
          <span
            className={`write-chip${canWrite ? " on" : ""}`}
            title={canWrite ? "changes persist to the desk" : "sign in (top right) to save changes"}
          >
            {canWrite ? "● operator" : "○ read-only"}
          </span>
        </div>
      }
    >
      <nav className="surface-nav" aria-label="sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      {data.error && (
        <ErrorBanner message={data.error} isAccessError={data.isAccessError} />
      )}

      {/* ---- 01 · LIVE MARKET (was /) ---------------------------------- */}
      <SectionLabel id="live" idx="01">Live Market</SectionLabel>
      <div className="grid grid--live">
        <div className="col">
          <IntradayChart bars={data.bars} />
          <OptionChain
            snapshot={data.snapshot}
            spot={data.spot}
            deltasModeled={data.deltasModeled}
            selected={selected}
            onSelect={(s) => setSelected((cur) => (cur === s ? null : s))}
          />
          {selected && (
            <ContractDetail occSymbol={selected} onClose={() => setSelected(null)} />
          )}
        </div>
        <div className="col">
          <TapeHealth
            rowCount={data.rowCount}
            lastIngestTs={data.lastIngestTs}
            snapCount={data.snapshot.length}
            expirations={data.expirations}
          />
          <EventLog events={data.events} />
        </div>
      </div>

      {/* ---- 02 · STRATEGY COMPOSER (was /console) --------------------- */}
      <SectionLabel id="composer" idx="02">Strategy Composer</SectionLabel>
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

      {/* ---- 03 · BOOK & P&L (was /desk) ------------------------------- */}
      <SectionLabel id="desk" idx="03">Book &amp; P&amp;L</SectionLabel>
      <div className="grid">
        <div className="col">
          <PositionsPanel positions={feed.positions} strategists={desk.strategists} />
        </div>
        <div className="col">
          <PnlPanel
            strategists={desk.strategists}
            pnlByStrategist={feed.pnlByStrategist}
            fundPnl={feed.fundPnl}
            equityCurve={feed.equityCurve}
          />
          <SignalsTape signals={feed.signals} />
        </div>
      </div>
    </Chassis>
  );
}

export default function Page() {
  return (
    <div className="console-root">
      <DeskProvider>
        <Surface />
      </DeskProvider>
    </div>
  );
}
