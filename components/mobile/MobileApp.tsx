"use client";

import { useRef, useState } from "react";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetail } from "@/components/ContractDetail";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { MasterStrip } from "@/components/console/MasterStrip";
import { StepRow } from "@/components/console/hw/StepRow";
import { Bezel } from "@/components/console/hw/Bezel";
import { SignalsTape } from "@/components/console/SignalsTape";
import { TapeHealth } from "@/components/TapeHealth";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import type { SurfaceProps } from "@/components/surfaceTypes";

type Tab = "live" | "desk" | "mix" | "master" | "log";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "live", label: "Live", icon: "📈" },
  { id: "desk", label: "Desk", icon: "💼" },
  { id: "mix", label: "Mix", icon: "🎛" },
  { id: "master", label: "Master", icon: "🎚" },
  { id: "log", label: "Log", icon: "📟" },
];

export function MobileApp({ data, view, feed, write, spotUp, selected, setSelected }: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [tab, setTab] = useState<Tab>("live");
  const [liveView, setLiveView] = useState<"chart" | "chain" | "pos">("chart");
  const [slide, setSlide] = useState(0);
  const deckRef = useRef<HTMLDivElement>(null);

  const goTab = (t: Tab) => {
    setTab(t);
    window.scrollTo(0, 0);
  };

  // vitals
  const running = desk.fund.running && !desk.fund.is_halted;
  const runLabel = desk.fund.is_halted ? "HALT" : running ? "RUN" : "STOP";
  const runCls = desk.fund.is_halted ? "halt" : running ? "on" : "off";
  const down = feed.fundPnl.dayPnl < 0;
  const dayLed = (down ? "-" : "") + Math.abs(Math.round(feed.fundPnl.dayPnl));
  const dayColor = down ? "var(--led-red)" : "var(--pm-green)";
  const spyColor = spotUp ? "var(--pm-green)" : "var(--led-red)";

  function onDeckScroll() {
    const el = deckRef.current;
    if (!el) return;
    const per = el.scrollWidth / desk.strategists.length || 1;
    setSlide(Math.round(el.scrollLeft / per));
  }

  return (
    <div className="m-app">
      <header className="m-vitals">
        <div className="m-pills">
          <span className={`m-pill m-run ${runCls}`}>{runLabel}</span>
          <span className={`m-pill m-mode ${desk.fund.mode}`}>
            {desk.fund.mode === "live" ? "LIVE" : "PAPER"}
          </span>
        </div>
        <div className="m-led">
          <LedDisplay
            value={data.spot != null ? data.spot.toFixed(2) : "----"}
            digits={6}
            color={spyColor}
            caption="spy $"
          />
        </div>
        <div className="m-led">
          <LedDisplay value={dayLed} digits={6} color={dayColor} caption="day p&l $" />
        </div>
      </header>

      <main className="m-screen">
        {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}

        {tab === "live" && (
          <>
            <div className="m-seg">
              <button className={liveView === "chart" ? "on" : ""} onClick={() => setLiveView("chart")}>CHART</button>
              <button className={liveView === "chain" ? "on" : ""} onClick={() => setLiveView("chain")}>CHAIN</button>
              <button className={liveView === "pos" ? "on" : ""} onClick={() => setLiveView("pos")}>POSITIONS</button>
            </div>
            {liveView === "chart" && <IntradayChart bars={data.bars} spot={data.spot} />}
            {liveView === "chain" && (
              <>
                <OptionChain
                  snapshot={data.snapshot}
                  spot={data.spot}
                  deltasModeled={data.deltasModeled}
                  selected={selected}
                  onSelect={(s) => setSelected((cur) => (cur === s ? null : s))}
                />
                {selected && <ContractDetail occSymbol={selected} onClose={() => setSelected(null)} />}
              </>
            )}
            {liveView === "pos" && (
              <PositionsPanel positions={feed.positions} strategists={desk.strategists} />
            )}
          </>
        )}

        {tab === "desk" && (
          <>
            <PnlPanel
              strategists={desk.strategists}
              pnlByStrategist={feed.pnlByStrategist}
              fundPnl={feed.fundPnl}
              equityCurve={feed.equityCurve}
            />
            <PositionsPanel positions={feed.positions} strategists={desk.strategists} />
          </>
        )}

        {tab === "mix" && (
          <>
            <div className="m-deck" ref={deckRef} onScroll={onDeckScroll}>
              {desk.strategists.map((s) => (
                <div className="m-slide" key={s.slug}>
                  <ChannelStrip
                    strategist={s}
                    pnl={feed.pnlByStrategist[s.slug]}
                    active={isActive(s.slug)}
                    ducked={anySolo && !s.config.soloed && !s.config.muted}
                  />
                </div>
              ))}
            </div>
            <div className="m-dots">
              {desk.strategists.map((s, i) => (
                <i key={s.slug} className={i === slide ? "on" : ""} />
              ))}
            </div>
          </>
        )}

        {tab === "master" && (
          <>
            <MasterStrip fund={desk.fund} fundPnl={feed.fundPnl} />
            <Bezel label="16-Step Tape · recent signals" className="tape">
              <StepRow steps={feed.steps} />
            </Bezel>
          </>
        )}

        {tab === "log" && (
          <>
            <SignalsTape signals={feed.signals} />
            <TapeHealth
              rowCount={data.rowCount}
              lastIngestTs={data.lastIngestTs}
              snapCount={data.snapshot.length}
              expirations={data.expirations}
            />
            <EventLog events={data.events} />
          </>
        )}
      </main>

      <nav className="m-tabs" aria-label="sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`m-tab${tab === t.id ? " on" : ""}`}
            onClick={() => goTab(t.id)}
            aria-pressed={tab === t.id}
          >
            <span className="ic">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
