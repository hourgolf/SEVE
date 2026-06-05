"use client";

import { useMemo, useRef, useState } from "react";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetail } from "@/components/ContractDetail";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { AddChannel } from "@/components/console/AddChannel";
import { MasterStrip } from "@/components/console/MasterStrip";
import { StepRow } from "@/components/console/hw/StepRow";
import { Bezel } from "@/components/console/hw/Bezel";
import { SignalsTape } from "@/components/console/SignalsTape";
import { DailyAutopsyPanel } from "@/components/console/DailyAutopsyPanel";
import { WeeklyAutopsyPanel } from "@/components/console/WeeklyAutopsyPanel";
import { TapeHealth } from "@/components/TapeHealth";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AuthControl } from "@/components/AuthControl";
import { computeLiveMarks } from "@/lib/desk/liveMarks";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { Position } from "@/lib/desk/types";

// ---- 909-flavoured inline-SVG tab icons (silkscreen line-art, no emoji) ----
const sv = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IcLive = () => (
  <svg viewBox="0 0 24 24" {...sv}><path d="M3 20V4M3 20h18" /><rect x="6" y="11" width="2.6" height="6" /><rect x="11" y="7" width="2.6" height="10" /><rect x="16" y="13" width="2.6" height="4" /></svg>
);
const IcDesk = () => (
  <svg viewBox="0 0 24 24" {...sv}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
);
const IcMix = () => (
  <svg viewBox="0 0 24 24" {...sv}><path d="M7 4v16M17 4v16" /><circle cx="7" cy="9" r="2.3" /><circle cx="17" cy="15" r="2.3" /></svg>
);
const IcCog = () => (
  <svg viewBox="0 0 24 24" {...sv}><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" /></svg>
);

type Tab = "live" | "desk" | "mix";
const TABS: { id: Tab; label: string; Icon: () => React.ReactNode }[] = [
  { id: "live", label: "Live", Icon: IcLive },
  { id: "desk", label: "Desk", Icon: IcDesk },
  { id: "mix", label: "Mix", Icon: IcMix },
];

export function MobileApp({ data, view, feed, write, spotUp, selected, setSelected, symbol, setSymbol }: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [tab, setTab] = useState<Tab>("live");
  const [hlTrade, setHlTrade] = useState<Position | null>(null); // trade highlighted on the chart
  // Live: additive view toggles (like indicator chips) — chart is the base.
  const [show, setShow] = useState({ chart: true, chain: false, pos: false });
  const [settings, setSettings] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const deckRef = useRef<HTMLDivElement>(null);

  // occ_symbol → live option mark (delta-extrapolated off the fast spot tick), so
  // open positions mark in real time, not once a minute.
  const liveMarks = useMemo(() => computeLiveMarks(data.snapshot, data.spot), [data.snapshot, data.spot]);

  const goTab = (t: Tab) => {
    setTab(t);
    window.scrollTo(0, 0);
  };

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
        <div className="m-vtop">
          <span className="m-brand">$EVE<span> · DESK</span></span>
          <button className="m-cog" onClick={() => setSettings(true)} aria-label="settings & log">
            <IcCog />
          </button>
        </div>
        <div className="m-vleds">
          <div className="m-pills">
            <span className={`m-pill m-run ${runCls}`}>{runLabel}</span>
            <span className={`m-pill m-mode ${desk.fund.mode}`}>
              {desk.fund.mode === "live" ? "LIVE" : "PAPER"}
            </span>
          </div>
          <div className="m-led">
            <LedDisplay value={data.spot != null ? data.spot.toFixed(2) : "----"} digits={6} color={spyColor} caption={`${symbol.toLowerCase()} $`} />
          </div>
          <div className="m-led">
            <LedDisplay value={dayLed} digits={6} color={dayColor} caption="day p&l $" />
          </div>
        </div>
      </header>

      <main className={`m-screen${tab === "mix" ? " m-screen--mix" : ""}`}>
        {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}

        {tab === "live" && (
          <>
            <div className="m-toggles">
              <button className={`m-tog${show.chart ? " on" : ""}`} onClick={() => setShow((s) => ({ ...s, chart: !s.chart }))}>CHART</button>
              <button className={`m-tog${show.chain ? " on" : ""}`} onClick={() => setShow((s) => ({ ...s, chain: !s.chain }))}>CHAIN</button>
              <button className={`m-tog${show.pos ? " on" : ""}`} onClick={() => setShow((s) => ({ ...s, pos: !s.pos }))}>POSITIONS</button>
            </div>
            {show.chart && (
              <IntradayChart bars={data.bars} dailyBars={data.dailyBars} spot={data.spot} spotUp={spotUp} mobile trades={feed.recentTrades} openPositions={feed.positions} highlightTrade={hlTrade} symbol={symbol} onSymbolChange={setSymbol} />
            )}
            {show.chain && (
              <>
                <OptionChain
                  snapshot={data.snapshot}
                  spot={data.spot}
                  deltasModeled={data.deltasModeled}
                  selected={selected}
                  onSelect={(s) => setSelected((cur) => (cur === s ? null : s))}
                  compact
                  symbol={symbol}
                />
                {selected && <ContractDetail occSymbol={selected} onClose={() => setSelected(null)} />}
              </>
            )}
            {show.pos && <PositionsPanel positions={feed.positions} strategists={desk.strategists} recentTrades={feed.recentTrades} liveMarks={liveMarks} onOpenTrade={setHlTrade} />}
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
            <MasterStrip fund={desk.fund} fundPnl={feed.fundPnl} />
            <Bezel label="16-Step Tape · recent signals" className="tape m-steptape">
              <StepRow steps={feed.steps} />
            </Bezel>
            <DailyAutopsyPanel strategists={desk.strategists} />
            <WeeklyAutopsyPanel strategists={desk.strategists} />
          </>
        )}

        {tab === "mix" && (
          <div className="m-mix">
            <div className="m-deck" ref={deckRef} onScroll={onDeckScroll}>
              {desk.strategists.map((s) => (
                <div className="m-slide" key={s.slug}>
                  <ChannelStrip
                    strategist={s}
                    pnl={feed.pnlByStrategist[s.slug]}
                    active={isActive(s.slug)}
                    ducked={anySolo && !s.config.soloed && !s.config.muted}
                    mobile
                  />
                </div>
              ))}
            </div>
            <div className="m-dots">
              {desk.strategists.map((s, i) => (
                <i key={s.slug} className={i === slide ? "on" : ""} />
              ))}
            </div>
            <button className="m-addch" onClick={() => setAddOpen(true)}>+ Add Channel</button>
          </div>
        )}
      </main>

      <nav className="m-tabs" aria-label="sections">
        {TABS.map((t) => (
          <button key={t.id} className={`m-tab${tab === t.id ? " on" : ""}`} onClick={() => goTab(t.id)} aria-pressed={tab === t.id}>
            <span className="ic"><t.Icon /></span>
            {t.label}
          </button>
        ))}
      </nav>

      {addOpen && (
        <AddChannel onClose={() => setAddOpen(false)} existingSlugs={desk.strategists.map((s) => s.slug)} />
      )}

      {settings && (
        <div className="m-scrim" onClick={() => setSettings(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-grab" />
            <div className="m-sheet-head">
              <span>Settings · Log</span>
              <button className="m-sheet-x" onClick={() => setSettings(false)} aria-label="close">✕</button>
            </div>
            <div className="m-sheet-auth">
              <AuthControl />
              <span className={`write-chip${write.canWrite ? " on" : ""}`}>
                {write.canWrite ? "● operator" : "○ read-only"}
              </span>
            </div>
            <SignalsTape signals={feed.signals} />
            <TapeHealth
              rowCount={data.rowCount}
              lastIngestTs={data.lastIngestTs}
              snapCount={data.snapshot.length}
              expirations={data.expirations}
            />
            <EventLog events={data.events} />
          </div>
        </div>
      )}
    </div>
  );
}
