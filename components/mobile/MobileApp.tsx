"use client";

import { useRef, useState } from "react";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { KillControl } from "@/components/console/hw/KillControl";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetail } from "@/components/ContractDetail";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { TodayStrip } from "@/components/console/TodayStrip";
import { PnlPanel } from "@/components/console/PnlPanel";
import { ManVsMachine } from "@/components/console/ManVsMachine";
import { PushToggle } from "@/components/console/PushToggle";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { AddChannel } from "@/components/console/AddChannel";
import { MasterStrip } from "@/components/console/MasterStrip";
import { SignalsTape } from "@/components/console/SignalsTape";
import { DailyAutopsyPanel } from "@/components/console/DailyAutopsyPanel";
import { WeeklyAutopsyPanel } from "@/components/console/WeeklyAutopsyPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { LabPanel } from "@/components/console/LabPanel";
import { OpsPreflight } from "@/components/console/OpsPreflight";
import { DayBooksStrip } from "@/components/console/DayBooksStrip";
import { MasterStopControl } from "@/components/console/MasterStopControl";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AuthControl } from "@/components/AuthControl";
import { useChannelOrdering } from "@/hooks/useChannelOrdering";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
import { MixerPads, padCode } from "@/components/mobile/MixerPads";
import { pmVar } from "@/lib/desk/colors";
import { signedUsd } from "@/lib/format";
import type { SurfaceProps } from "@/components/surfaceTypes";
import type { Position } from "@/lib/desk/types";

// ---- 909-flavoured inline-SVG tab icons (silkscreen line-art, no emoji) ----
const sv = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IcMarket = () => (
  <svg viewBox="0 0 24 24" {...sv}><path d="M3 20V4M3 20h18" /><rect x="6" y="11" width="2.6" height="6" /><rect x="11" y="7" width="2.6" height="10" /><rect x="16" y="13" width="2.6" height="4" /></svg>
);
const IcMixer = () => (
  <svg viewBox="0 0 24 24" {...sv}><path d="M7 4v16M17 4v16" /><circle cx="7" cy="9" r="2.3" /><circle cx="17" cy="15" r="2.3" /></svg>
);
const IcBook = () => (
  <svg viewBox="0 0 24 24" {...sv}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
);
const IcReview = () => (
  <svg viewBox="0 0 24 24" {...sv}><path d="M4 4v16h16" /><path d="M7 14l4-5 3 3 4-6" /></svg>
);
const IcCog = () => (
  <svg viewBox="0 0 24 24" {...sv}><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" /></svg>
);

type Tab = "market" | "mixer" | "book" | "review";
const TABS: { id: Tab; label: string; jp: string; Icon: () => React.ReactNode }[] = [
  { id: "market", label: "Market", jp: "ライブ", Icon: IcMarket },
  { id: "mixer", label: "Mixer", jp: "ミキサー", Icon: IcMixer },
  { id: "review", label: "Review", jp: "検証", Icon: IcReview },
];

function inRth(): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  return d >= 1 && d <= 5 && m >= 570 && m < 960;
}

export function MobileApp({ data, view, feed, write, spotUp, selected, setSelected, symbol, setSymbol, theme, setTheme, accounts, acctId, setAcctId, ops, liveMarks, livePnl, liveFund }: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  // Multi-account: scope the roster to the selected account (accounts/acctId lifted to Surface).
  const accountChannels = acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists;

  // Traded indices (desk-wide, armed) for the TODAY readiness strip — gaps are market-wide.
  const tradedUnderlyings = [...new Set(desk.strategists.filter((s) => s.status === "armed").map((s) => s.underlying.toUpperCase()))]
    .sort((a, b) => { const o = ["SPY", "QQQ", "IWM"]; const ai = o.indexOf(a), bi = o.indexOf(b); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b); });
  const armed = accountChannels.filter((s) => s.status === "armed");
  const benched = accountChannels.filter((s) => s.status !== "armed");
  const { persist, canWrite } = useChannelOrdering(armed, write);
  const [expanded, setExpanded] = useState<string | null>(null); // Mixer: channel open for full-knob editing
  const [benchOpen, setBenchOpen] = useState(false);
  const PER_PAGE = 4;
  const [tab, setTab] = useState<Tab>("market");
  const [hlTrade, setHlTrade] = useState<Position | null>(null);
  const [show, setShow] = useState({ chart: true, positions: true, chain: false });
  const [settings, setSettings] = useState(false); // cog → OPS sheet
  const [addOpen, setAddOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const deckRef = useRef<HTMLDivElement>(null);

  // liveMarks / livePnl / liveFund are lifted to Surface (the seam) and arrive as props.
  const goTab = (t: Tab) => { setTab(t); window.scrollTo(0, 0); };

  const running = desk.fund.running && !desk.fund.is_halted;
  const runLabel = desk.fund.is_halted ? "HALT" : running ? "RUN" : "STOP";
  const runCls = desk.fund.is_halted ? "halt" : running ? "on" : "off";
  const down = liveFund.dayPnl < 0;
  const dayLed = (down ? "-" : "") + Math.abs(Math.round(liveFund.dayPnl));
  const dayColor = down ? "var(--led-red)" : "var(--pm-green)";
  const navLed = String(Math.round(liveFund.nav));

  // BOOKS Δ + composite HEALTH dot for the persistent vitals header (mirrors the desktop Shell).
  const attrib = Object.values(livePnl).reduce((a, c) => a + (c.dayPnl || 0), 0);
  const booksDelta = Math.round(liveFund.dayPnl - attrib);
  const dTone = Math.abs(booksDelta) < 100 ? "ok" : Math.abs(booksDelta) < 500 ? "warn" : "bad";
  const rth = inRth();
  let hTone: "ok" | "warn" | "bad" | "dim" = "dim";
  if (ops.loaded) {
    if (ops.hbAgeSec == null) hTone = rth && ops.streamArmed > 0 ? "bad" : "dim";
    else if (ops.hbAgeSec < 60) hTone = "ok";
    else if (ops.hbAgeSec < 300) hTone = "warn";
    else hTone = rth && ops.streamArmed > 0 ? "bad" : "dim";
  }

  function onDeckScroll() {
    const el = deckRef.current;
    if (!el) return;
    setSlide(Math.round(el.scrollLeft / (el.clientWidth || 1)));
  }
  const jumpToChannel = (slug: string) => {
    const i = armed.findIndex((s) => s.slug === slug);
    if (i < 0) return;
    const el = deckRef.current;
    if (el) el.scrollTo({ left: Math.floor(i / PER_PAGE) * el.clientWidth, behavior: "smooth" });
  };
  type GridItem = typeof desk.strategists[number] | "add";
  const gridItems: GridItem[] = [...armed, "add"];
  const pages: GridItem[][] = [];
  for (let i = 0; i < gridItems.length; i += PER_PAGE) pages.push(gridItems.slice(i, i + PER_PAGE));
  const pageSlugs = (pages[slide] ?? []).filter((it): it is typeof desk.strategists[number] => it !== "add").map((s) => s.slug);

  return (
    <div className="m-app">
      <header className="m-vitals">
        <div className="m-vtop">
          <span className="m-brand">$EVE</span>
          <span className={`m-health sh-${hTone}`} title="stream/cron health" aria-label="health"><i /></span>
          <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />
          <span className="m-vtop-sp" />
          <KillControl halted={desk.fund.is_halted} />
          <button className="m-cog" onClick={() => setSettings(true)} aria-label="ops & settings">
            <IcCog />
          </button>
        </div>
        <div className="m-vleds">
          <div className="m-pills">
            <span className={`m-pill m-run ${runCls}`}>{runLabel}</span>
            <span className={`m-pill m-mode ${desk.fund.mode}`}>{desk.fund.mode === "live" ? "LIVE" : "PAPER"}</span>
          </div>
          <div className="m-led"><LedDisplay value={navLed} digits={6} color={dayColor} caption="fund $" /></div>
          <div className="m-led"><LedDisplay value={dayLed} digits={6} color={dayColor} caption="day p&l $" /></div>
          <span className={`m-books shb-${dTone}`} title="NAV − attribution Σ">Δ {signedUsd(booksDelta)}</span>
        </div>
      </header>

      <TodayStrip underlyings={tradedUnderlyings} />

      <main className={`m-screen${tab === "mixer" ? " m-screen--mix" : ""}`}>
        {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}

        {tab === "market" && (
          <>
            <div className="m-toggles">
              <button className={`m-tog${show.chart ? " on" : ""}`} onClick={() => setShow((s) => ({ ...s, chart: !s.chart }))}>CHART</button>
              <button className={`m-tog${show.positions ? " on" : ""}`} onClick={() => setShow((s) => ({ ...s, positions: !s.positions }))}>BOOK</button>
              <button className={`m-tog${show.chain ? " on" : ""}`} onClick={() => setShow((s) => ({ ...s, chain: !s.chain }))}>CHAIN</button>
            </div>
            {show.chart && (
              <IntradayChart bars={data.bars} dailyBars={data.dailyBars} spot={data.spot} spotUp={spotUp} mobile trades={feed.recentTrades} openPositions={feed.positions} highlightTrade={hlTrade} symbol={symbol} onSymbolChange={setSymbol} />
            )}
            {/* BOOK right under the chart — open positions ↔ price together for exit timing (no tab-hop). */}
            {show.positions && (
              <>
                <PositionsPanel positions={feed.positions} strategists={desk.strategists} recentTrades={feed.recentTrades} liveMarks={liveMarks} onOpenTrade={setHlTrade} />
                <SignalsTape signals={feed.signals} />
              </>
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
          </>
        )}

        {tab === "review" && (
          <>
            <PnlPanel strategists={desk.strategists} pnlByStrategist={livePnl} fundPnl={liveFund} equityCurve={feed.equityCurve} />
            <ManVsMachine strategists={desk.strategists} pnl={livePnl} />
            <DailyAutopsyPanel strategists={desk.strategists} />
            <WeeklyAutopsyPanel strategists={desk.strategists} />
            <ForensicsPanel />
            <LabPanel />
          </>
        )}

        {tab === "mixer" && (
          <div className="m-mix">
            <div className="m-grid" ref={deckRef} onScroll={onDeckScroll}>
              {pages.map((page, pi) => (
                <div className="m-page" key={pi}>
                  {page.map((it) => {
                    if (it === "add") {
                      return (
                        <button key="add" type="button" className="channel channel--mc m-addcard" onClick={() => setAddOpen(true)}>
                          <span>+ ADD CHANNEL</span>
                        </button>
                      );
                    }
                    return (
                      <ChannelStrip
                        key={it.slug}
                        strategist={it}
                        pnl={livePnl[it.slug]}
                        active={isActive(it.slug)}
                        ducked={anySolo && !it.config.soloed && !it.config.muted}
                        mobile
                        compact
                        onExpand={() => setExpanded(it.slug)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="m-pagedots">
              {pages.map((_, i) => <i key={i} className={i === slide ? "on" : ""} />)}
            </div>
            <MixerPads
              strategists={armed}
              focusedSlugs={pageSlugs}
              onJump={jumpToChannel}
              persist={persist}
              canWrite={canWrite}
            />
            {benched.length > 0 && (
              <div className={`mx-bench${benchOpen ? " open" : ""}`}>
                <button type="button" className="mx-bench-toggle" onClick={() => setBenchOpen((o) => !o)} aria-expanded={benchOpen}>
                  <span className="mx-title">Bench · 86&apos;d · {benched.length}</span>
                  <span className="mx-bench-chev" aria-hidden>{benchOpen ? "▾" : "▸"}</span>
                </button>
                {benchOpen && (
                  <div className="mx-pads">
                    {benched.map((s) => (
                      <button key={s.slug} type="button" className="mx-pad bench" style={{ ["--pad" as string]: pmVar(s.color) }} onClick={() => setExpanded(s.slug)} title={`${s.name} — ${s.status}`}>
                        {padCode(s)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <nav className="m-tabs" aria-label="rooms">
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

      {/* cog → OPS sheet: health/system controls + sign-in + theme + event log */}
      {settings && (
        <div className="m-scrim" onClick={() => setSettings(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-grab" />
            <div className="m-sheet-head">
              <span>OPS · 運用</span>
              <button className="m-sheet-x" onClick={() => setSettings(false)} aria-label="close">✕</button>
            </div>
            <div className="m-sheet-auth">
              <AuthControl />
              <span className={`write-chip${write.canWrite ? " on" : ""}`}>{write.canWrite ? "● operator" : "○ read-only"}</span>
            </div>
            <div className="theme-toggle">
              <span>Chassis theme</span>
              <button type="button" className={theme === "cream" ? "on" : ""} onClick={() => setTheme("cream")}>cream</button>
              <button type="button" className={theme === "blackout" ? "on" : ""} onClick={() => setTheme("blackout")}>blackout</button>
            </div>
            <PushToggle />
            <DayBooksStrip strategists={desk.strategists} pnl={livePnl} fund={liveFund} closedToday={feed.recentTrades.length} openCount={feed.positions.length} />
            <OpsPreflight
              strategists={desk.strategists}
              tape={{ rowCount: data.rowCount, lastIngestTs: data.lastIngestTs, snapCount: data.snapshot.length, expirations: data.expirations }}
              ops={ops}
            />
            <MasterStopControl fund={desk.fund} />
            <MasterStrip fund={desk.fund} fundPnl={liveFund} />
            <EventLog events={data.events} />
          </div>
        </div>
      )}

      {/* Expanded channel — full strip with draggable knobs (Mixer tap-to-expand). */}
      {expanded && (() => {
        const s = desk.strategists.find((x) => x.slug === expanded);
        if (!s) return null;
        return (
          <div className="m-scrim" onClick={() => setExpanded(null)}>
            <div className="m-sheet m-editsheet" onClick={(e) => e.stopPropagation()}>
              <div className="m-grab" />
              <div className="m-sheet-head">
                <span>{s.name}</span>
                <button className="m-sheet-x" onClick={() => setExpanded(null)} aria-label="close">✕</button>
              </div>
              <ChannelStrip
                strategist={s}
                pnl={livePnl[s.slug]}
                active={s.status === "armed" && isActive(s.slug)}
                ducked={anySolo && !s.config.soloed && !s.config.muted}
                mobile
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
