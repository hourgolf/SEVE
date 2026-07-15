"use client";

import { useRef, useState } from "react";
import { LedDisplay } from "@/components/console/hw/LedDisplay";
import { KillControl } from "@/components/console/hw/KillControl";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetailView } from "@/components/ContractDetail";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { GAP_MIN } from "@/components/console/TodayStrip";
import { useTodayReadiness } from "@/hooks/useTodayReadiness";
import { PnlPanel } from "@/components/console/PnlPanel";
import { PushToggle } from "@/components/console/PushToggle";
import { KitToggle } from "@/components/console/KitToggle";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { AddChannel } from "@/components/console/AddChannel";
import { MasterStrip } from "@/components/console/MasterStrip";
import { SignalsTape } from "@/components/console/SignalsTape";
import { AutopsyPanel } from "@/components/console/AutopsyPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { BriefPanel } from "@/components/console/BriefPanel";
import { SentinelPanel } from "@/components/console/SentinelPanel";
import { OpsPreflight } from "@/components/console/OpsPreflight";
import { DayBooksStrip } from "@/components/console/DayBooksStrip";
import { MasterStopControl } from "@/components/console/MasterStopControl";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AuthControl } from "@/components/AuthControl";
import { useChannelOrdering } from "@/hooks/useChannelOrdering";
import { useFold } from "@/hooks/useFold";
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
const IcWrite = () => (
  <svg viewBox="0 0 24 24" {...sv}><path d="M4 20l4-1L19 8l-3-3L5 16l-1 4z" /><path d="M14 7l3 3" /></svg>
);

// The 5 rooms of the 909 desk (parity with the desktop transport, slice 5):
// PLAY (perform) · MIX (tune) · WRITE (compose) · TAPE (review) · OPS (tend —
// absorbs the old cog settings sheet).
type Tab = "play" | "mix" | "write" | "tape" | "ops";
const TABS: { id: Tab; label: string; jp: string; Icon: () => React.ReactNode }[] = [
  { id: "play", label: "Play", jp: "演奏", Icon: IcMarket },
  { id: "mix", label: "Mix", jp: "ミキサー", Icon: IcMixer },
  { id: "write", label: "Write", jp: "作曲", Icon: IcWrite },
  { id: "tape", label: "Tape", jp: "テープ", Icon: IcReview },
  { id: "ops", label: "Ops", jp: "整備", Icon: IcCog },
];

function inRth(): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  return d >= 1 && d <= 5 && m >= 570 && m < 960;
}

export function MobileApp({ data, view, feed, write, spotUp, selected, setSelected, contractHistory, symbol, setSymbol, theme, setTheme, accounts, acctId, setAcctId, ops, liveMarks, livePnl, liveFund }: SurfaceProps) {
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
  const [tab, setTab] = useState<Tab>("play");
  const [hlTrade, setHlTrade] = useState<Position | null>(null);
  const [show, setShow] = useState({ chart: true, positions: true, chain: false });
  const [addOpen, setAddOpen] = useState(false);
  const [composeFolded, toggleCompose] = useFold("compose");
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
  // K-format NAV: fits the $1M cockpit buckets in 5 cells (a raw 7-digit NAV
  // overflowed the 6-digit window) and buys the ticker pills their column.
  const navK = (liveFund.nav / 1000).toFixed(1);

  // TODAY readiness → header ticker pills (replaces the space-eating TodayStrip):
  // lit + arrow = gap cleared the gate (direction of the move); unlit + dim
  // arrow = flat open, gap-gated channels standing down; unlit · = pre-open.
  const { gaps, todayET } = useTodayReadiness();

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
        </div>
        <div className="m-vleds">
          <div className="m-pills">
            <span className={`m-pill m-run ${runCls}`}>{runLabel}</span>
            <span className={`m-pill m-mode ${desk.fund.mode}`}>{desk.fund.mode === "live" ? "LIVE" : "PAPER"}</span>
            <span className={`m-pill m-books-pill shb-${dTone}`} title="BOOKS — NAV − attribution Σ (small = the books reconcile)">
              Δ{signedUsd(booksDelta)}
            </span>
          </div>
          <div className="m-pills m-ticks" role="status" aria-label="gap gate readiness">
            {tradedUnderlyings.map((sym) => {
              const g = gaps[sym];
              const gapPct = g && g.sessionDate === todayET ? g.gapPct : null;
              if (gapPct == null) {
                const why = !g ? "no tape" : g.sessionDate !== todayET ? "pre-open" : "gap pending";
                return (
                  <span key={sym} className="m-tick off" title={`${sym} — ${why}`}>
                    <b>{sym}</b><i>·</i>
                  </span>
                );
              }
              const isGap = Math.abs(gapPct) >= GAP_MIN;
              const dir = gapPct >= 0 ? "up" : "down";
              return (
                <span
                  key={sym}
                  className={`m-tick${isGap ? ` on ${dir}` : " flat"}`}
                  title={`${sym} ${gapPct >= 0 ? "+" : ""}${gapPct}% — ${isGap ? `gap day (clears the ${GAP_MIN}% gate)` : "flat open — gap-gated channels stand down"}`}
                >
                  <b>{sym}</b><i>{dir === "up" ? "▲" : "▼"}</i>
                </span>
              );
            })}
          </div>
          <div className="m-led"><LedDisplay value={navK} digits={5} unit="K" color={dayColor} caption="fund $" /></div>
          <div className="m-led"><LedDisplay value={dayLed} digits={6} color={dayColor} caption="day p&l $" /></div>
        </div>
      </header>

      <main className={`m-screen${tab === "mix" ? " m-screen--mix" : ""}`}>
        {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}

        {tab === "play" && (
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
                <PositionsPanel positions={feed.positions} strategists={desk.strategists} recentTrades={feed.recentTrades} liveMarks={liveMarks} onOpenTrade={setHlTrade} loading={feed.updatedAt == null} />
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
                {selected && <ContractDetailView occSymbol={selected} onClose={() => setSelected(null)} history={contractHistory} />}
              </>
            )}
          </>
        )}

        {tab === "write" && (
          <>
            <div className={`panel write-compose${composeFolded ? " folded" : ""}`}>
              <div className="phead"><span className="t">Add Channel</span><span className="x">thesis → spec → gate → arm</span><button type="button" className="pfold" onClick={toggleCompose} aria-expanded={!composeFolded} title={composeFolded ? "expand" : "collapse"}>{composeFolded ? "▸" : "▾"}</button></div>
              <div className="pbody">
                <p className="write-hint">
                  Import a strategy thesis (.md): frontmatter preview, LLM compile to a spec,
                  the backtest gate, then arm to the bench.
                </p>
                <button className="add-channel-btn" onClick={() => setAddOpen(true)}>+ Add Channel</button>
              </div>
            </div>
          </>
        )}

        {tab === "tape" && (
          <>
            <PnlPanel strategists={desk.strategists} pnlByStrategist={livePnl} fundPnl={liveFund} equityCurve={feed.equityCurve} acctId={acctId} />
            <BriefPanel />
            <SentinelPanel />
            <AutopsyPanel strategists={desk.strategists} />
            <ForensicsPanel />
          </>
        )}

        {tab === "ops" && (
          <>
            <DayBooksStrip strategists={desk.strategists} pnl={livePnl} fund={liveFund} closedToday={feed.recentTrades.length} openCount={feed.positions.length} />
            <OpsPreflight
              strategists={desk.strategists}
              tape={{ rowCount: data.rowCount, lastIngestTs: data.lastIngestTs, snapCount: data.snapshot.length, expirations: data.expirations }}
              ops={ops}
            />
            <MasterStopControl fund={desk.fund} />
            <MasterStrip fund={desk.fund} fundPnl={liveFund} />
            <div className="panel">
              <div className="phead"><span className="t">Settings</span><span className="x">operator · chassis · alerts</span></div>
              <div className="pbody m-ops-settings">
                <div className="m-ops-auth">
                  <AuthControl />
                  <span className={`write-chip${write.canWrite ? " on" : ""}`}>{write.canWrite ? "● operator" : "○ read-only"}</span>
                </div>
                <div className="theme-toggle">
                  <span>Chassis theme</span>
                  <button type="button" className={theme === "cream" ? "on" : ""} onClick={() => setTheme("cream")}>cream</button>
                  <button type="button" className={theme === "blackout" ? "on" : ""} onClick={() => setTheme("blackout")}>blackout</button>
                </div>
                <PushToggle />
                <KitToggle variant="sheet" />
              </div>
            </div>
            <EventLog events={data.events} />
          </>
        )}

        {tab === "mix" && (
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

      {/* SESSION SEQUENCER dock — the day's pattern pinned above the tab bar
          (909-redesign slice 1); slim + closed by default, tap to expand. */}
      <SessionSequencer variant="dock" positions={feed.positions} recentTrades={feed.recentTrades} strategists={desk.strategists} />

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
