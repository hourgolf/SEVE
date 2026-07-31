"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { prefersReducedMotion } from "@/lib/motion";
import { Shell } from "@/components/Shell";
import { AddChannel } from "@/components/console/AddChannel";
import { AuthControl } from "@/components/AuthControl";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetailView } from "@/components/ContractDetail";
import { OpsPreflight } from "@/components/console/OpsPreflight";
import { DayBooksStrip } from "@/components/console/DayBooksStrip";
import { MasterStopControl } from "@/components/console/MasterStopControl";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { RosterTable } from "@/components/console/RosterTable";
import { Rack } from "@/components/console/Rack";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { TodayStrip } from "@/components/console/TodayStrip";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useChannelOrdering } from "@/hooks/useChannelOrdering";
import { useFold } from "@/hooks/useFold";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { MasterStrip } from "@/components/console/MasterStrip";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { NetExposurePanel } from "@/components/console/NetExposurePanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { PushToggle } from "@/components/console/PushToggle";
import { SignalsTape } from "@/components/console/SignalsTape";
import { AutopsyPanel } from "@/components/console/AutopsyPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { SentinelPanel } from "@/components/console/SentinelPanel";
import { BriefPanel } from "@/components/console/BriefPanel";
import { padCode } from "@/components/mobile/MixerPads";
import { pmVar } from "@/lib/desk/colors";
import { marketSummary } from "@/lib/marketSummary";
import { signedUsd } from "@/lib/format";
import type { Room, SurfaceProps } from "@/components/surfaceTypes";
import type { Position } from "@/lib/desk/types";

// ---- one-page rooms (909-redesign slices 2+4) ------------------------------
// The FIVE rooms of the 909 desk STACK on one scrolling page: PLAY (perform:
// chart · live book · sequencer) · MIX (tune: strips · fleet · bench) · WRITE
// (compose: add-channel · virtual bench LAB) · TAPE (review: P&L · autopsies ·
// forensics) · OPS (tend). Shell tabs anchor-jump (scrollspy keeps the lit tab
// honest); each room folds via its silkscreen head, and folded rooms don't
// mount — WRITE/TAPE/OPS defer their fetches until opened.
const ROOM_DEFS: { id: Room; idx: string; label: string; jp: string }[] = [
  { id: "play", idx: "01", label: "Play", jp: "演奏" },
  { id: "mix", idx: "02", label: "Mix", jp: "ミキサー" },
  { id: "write", idx: "03", label: "Write", jp: "作曲" },
  { id: "tape", idx: "04", label: "Tape", jp: "テープ" },
  { id: "ops", idx: "05", label: "Ops", jp: "整備" },
];
const ROOM_FOLD_KEY = "seve-room-folds";

// GSAP Flip (client only — "use client" components still SSR-render, so the
// register and the layout effect both need the window guard).
if (typeof window !== "undefined") gsap.registerPlugin(Flip);
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function RoomHead({ def, folded, onToggle }: { def: (typeof ROOM_DEFS)[number]; folded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="section-label room-head" onClick={onToggle} aria-expanded={!folded}>
      <span className="idx">{def.idx}</span>
      <span className="lab">{def.label}</span>
      <span className="sec-jp">{def.jp}</span>
      <span className="fold-ch">{folded ? "▸" : "▾"}</span>
    </button>
  );
}

// One draggable channel card. useSortable provides the transform + the drag-handle
// listeners; we hand the listeners to the grip ONLY (so the knobs stay interactive)
// and attach the transform to the grid-cell wrapper. `disabled` (anon) = no drag.
function SortableChannel(props: {
  strategist: StrategistState;
  pnl: ChannelPnl | undefined;
  active: boolean;
  ducked: boolean;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.strategist.slug,
    disabled: props.disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="ch-sortable">
      <ChannelStrip
        strategist={props.strategist}
        pnl={props.pnl}
        active={props.active}
        ducked={props.ducked}
        dragHandle={props.disabled ? undefined : { ...attributes, ...listeners }}
        dragging={isDragging}
      />
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
  contractHistory,
  symbol,
  setSymbol,
  theme,
  setTheme,
  accounts,
  acctId,
  setAcctId,
  ops,
  liveMarks,
  livePnl,
  liveFund,
  activeRoom,
  setActiveRoom,
  collapsedMarket,
  setCollapsedMarket,
  reviewEvidence,
}: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [addOpen, setAddOpen] = useState(false);
  const [rosterView, setRosterView] = useState<"strips" | "table">("strips"); // Mixer: per-channel strips vs the fleet table
  const [hlTrade, setHlTrade] = useState<Position | null>(null); // trade highlighted on the chart
  const [composeFolded, toggleCompose] = useFold("compose");
  const { canWrite, canDirectConfigure } = write;
  const selectedAccount = accounts.find((account) => account.id === acctId);
  const accountScope = selectedAccount ? `${selectedAccount.name} ACCOUNT` : "ACCOUNT UNSELECTED";

  // Room folds (one-page desk): play + mix open, write/tape/ops folded until
  // wanted — folded rooms don't mount, so their data fetches defer too. Persisted.
  const [roomFolds, setRoomFolds] = useState<Record<Room, boolean>>({ play: false, mix: false, write: true, tape: true, ops: true });
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(ROOM_FOLD_KEY);
      if (s) setRoomFolds((f) => ({ ...f, ...(JSON.parse(s) as Partial<Record<Room, boolean>>) }));
    } catch { /* */ }
  }, []);
  const persistFolds = (n: Record<Room, boolean>) => {
    try { window.localStorage.setItem(ROOM_FOLD_KEY, JSON.stringify(n)); } catch { /* */ }
  };
  const toggleRoom = (r: Room) => setRoomFolds((f) => { const n = { ...f, [r]: !f[r] }; persistFolds(n); return n; });
  // Shell tab click → unfold + smooth-scroll to the room (scrollspy below keeps
  // the lit tab honest on manual scroll).
  const jumpToRoom = (r: Room) => {
    setActiveRoom(r);
    setRoomFolds((f) => { if (!f[r]) return f; const n = { ...f, [r]: false }; persistFolds(n); return n; });
    // setTimeout (not rAF — throttled tabs may never fire rAF) after the unfold commits;
    // "auto" behavior so the jump lands even where smooth-scroll animation is suppressed.
    // Re-assert once more after async panels (autopsies/forensics) land and shift heights.
    window.setTimeout(() => document.getElementById(`room-${r}`)?.scrollIntoView({ block: "start" }), 30);
    window.setTimeout(() => document.getElementById(`room-${r}`)?.scrollIntoView({ block: "start" }), 550);
  };
  // Scrollspy — a throttled scroll listener (not IntersectionObserver: IO rides
  // the rendering pipeline and goes silent in throttled/backgrounded tabs). The active
  // room = the last one whose top has crossed the 30%-from-top reading line.
  useEffect(() => {
    let pending = false;
    const spy = () => {
      pending = false;
      const line = window.innerHeight * 0.3;
      let cur: Room = "play";
      for (const d of ROOM_DEFS) {
        const el = document.getElementById(`room-${d.id}`);
        if (el && el.getBoundingClientRect().top <= line) cur = d.id;
      }
      setActiveRoom(cur);
    };
    const onScroll = () => {
      if (pending) return;
      pending = true;
      window.setTimeout(spy, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [setActiveRoom]);

  // Multi-account: scope the roster to the selected account (accounts/acctId lifted to Surface).
  const accountChannels = acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists;

  // Traded indices (desk-wide, armed) for the TODAY readiness strip — gaps are market-wide, so
  // this isn't account-scoped. Order SPY · QQQ · IWM, then anything else.
  const tradedUnderlyings = [...new Set(desk.strategists.filter((s) => s.status === "armed").map((s) => s.underlying.toUpperCase()))]
    .sort((a, b) => { const o = ["SPY", "QQQ", "IWM"]; const ai = o.indexOf(a), bi = o.indexOf(b); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b); });

  // The 86'd shelf: only ARMED channels get full strips; benched (draft) channels
  // collapse to small pads on a rail below — tap one to inspect / re-arm.
  const armed = accountChannels.filter((s) => s.status === "armed");
  const benched = accountChannels.filter((s) => s.status !== "armed");
  const [benchOpen, setBenchOpen] = useState<string | null>(null);

  // ---- drag-to-reorder + group-by (operator only; persists sort_order) ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { order: channelOrder, persist, groupBy } = useChannelOrdering(armed, write);

  // FLIP the strips on group-by: drags already animate via dnd-kit; this covers
  // the PROGRAMMATIC re-arrange that used to snap. Capture every strip's box
  // BEFORE the REORDER dispatch, then animate old box → new box after React
  // commits the new order. The ref is only armed here, so drag drops and feed
  // refreshes never re-animate; reduced-motion never arms it (instant, as now).
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const groupByFlip = (key: "underlying" | "regime") => {
    if (!prefersReducedMotion()) flipStateRef.current = Flip.getState(".channels .ch-sortable");
    groupBy(key);
  };
  const orderKey = channelOrder.join("|");
  useIsoLayoutEffect(() => {
    const st = flipStateRef.current;
    if (!st) return;
    flipStateRef.current = null;
    Flip.from(st, { duration: 0.5, ease: "power2.inOut", stagger: 0.02 });
  }, [orderKey]);
  const onDragEnd = (e: DragEndEvent) => {
    const from = channelOrder.indexOf(String(e.active.id));
    const to = e.over ? channelOrder.indexOf(String(e.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    persist(arrayMove(channelOrder, from, to));
  };

  // BOOKS Δ for the shell: NAV-truth day P&L − Σ per-channel attribution (shared-OCC).
  const attrib = Object.values(livePnl).reduce((a, c) => a + (c.dayPnl || 0), 0);
  const booksDelta = Math.round(liveFund.dayPnl - attrib);

  // Collapsed-market ticker: the selected symbol's day summary + a sparkline path.
  const mkt = marketSummary(data.bars, data.spot);
  const sMin = mkt.spark.length ? Math.min(...mkt.spark) : 0;
  const sMax = mkt.spark.length ? Math.max(...mkt.spark) : 1;
  const sparkPts = mkt.spark.map((v, i) => `${i * 4},${(23 - ((v - sMin) / (sMax - sMin || 1)) * 21).toFixed(2)}`).join(" ");
  const realizedToday = feed.recentTrades.reduce((a, t) => a + (t.realized_pnl ?? 0), 0);

  return (
    <div className="chassis">
      <Shell
        fund={desk.fund}
        liveFund={liveFund}
        booksDelta={booksDelta}
        ops={ops}
        accounts={accounts}
        acctId={acctId}
        setAcctId={setAcctId}
        activeRoom={activeRoom}
        setActiveRoom={jumpToRoom}
      />

      {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}
      {addOpen && (
        <AddChannel onClose={() => setAddOpen(false)} existingSlugs={desk.strategists.map((s) => s.slug)} />
      )}

      {/* ============ 01 PLAY — perform: chart · live book · sequencer ======= */}
      <section className="room room--play" id="room-play" data-room-id="play">
        <RoomHead def={ROOM_DEFS[0]} folded={roomFolds.play} onToggle={() => toggleRoom("play")} />
        {!roomFolds.play && (<>
          <TodayStrip underlyings={tradedUnderlyings} />
          <div className="market-section">
            <div className={`mkt-bar${collapsedMarket ? " collapsed" : ""}`}>
              <span className="mkt-pills">
                <button type="button" className={`mkt-pill${symbol === "SPY" ? " on" : ""}`} onClick={() => setSymbol("SPY")}>SPY</button>
                <button type="button" className={`mkt-pill${symbol === "QQQ" ? " on" : ""}`} onClick={() => setSymbol("QQQ")}>QQQ</button>
              </span>
              <span className="mkt-spot" style={{ color: spotUp ? "var(--lcd-up)" : "var(--lcd-down)" }}>{data.spot != null ? data.spot.toFixed(2) : "—"}</span>
              {mkt.dayChangePct != null && (
                <span className="mkt-chg" style={{ color: mkt.dayChangePct < 0 ? "var(--lcd-down)" : "var(--lcd-up)" }}>
                  {mkt.dayChangePct >= 0 ? "+" : ""}{mkt.dayChangePct.toFixed(2)}%
                </span>
              )}
              {mkt.vwap != null && <span className="mkt-stat"><b>VWAP</b> {mkt.vwap.toFixed(2)}</span>}
              {mkt.dayHigh != null && mkt.dayLow != null && <span className="mkt-stat"><b>RANGE</b> {mkt.dayLow.toFixed(1)}–{mkt.dayHigh.toFixed(1)}</span>}
              {mkt.spark.length > 1 && (
                <svg className="mkt-spark" viewBox={`0 0 ${(mkt.spark.length - 1) * 4} 24`} preserveAspectRatio="none" aria-hidden>
                  <polyline points={sparkPts} fill="none" stroke={spotUp ? "var(--lcd-up)" : "var(--lcd-down)"} strokeWidth="1.4" />
                </svg>
              )}
              <button type="button" className="mkt-exp" onClick={() => setCollapsedMarket((c) => !c)}>
                {collapsedMarket ? "▾ expand chart" : "▴ collapse chart"}
              </button>
            </div>
            <div className="mkt-chart" style={{ display: collapsedMarket ? "none" : "block" }}>
              <IntradayChart bars={data.bars} dailyBars={data.dailyBars} spot={data.spot} spotUp={spotUp} trades={feed.recentTrades} openPositions={feed.positions} highlightTrade={hlTrade} symbol={symbol} onSymbolChange={setSymbol} />
            </div>
            {/* LIVE BOOK — directly under the chart so open positions ↔ price are visible together
                for exit timing (no scroll). Positions LEFT; signals tape stacked over the chain RIGHT.
                Stays visible when the chart is collapsed. */}
            <div className="section-label" id="livebook">
              <span className="idx">B</span>
              <span className="lab">Live Book<span className="sec-jp">ブック</span></span>
              <span className="sec-right">{feed.positions.length} open · realized <span className={realizedToday < 0 ? "neg" : "pos"}>{signedUsd(realizedToday)}</span></span>
            </div>
            <div className="log-section livebook-section">
              {/* RACK — the four Live Book modules; ⠿ re-racks within/between columns */}
              <Rack
                storageKey="seve-rack-livebook"
                defaults={{ a: ["book", "netx"], b: ["signals", "chain"] }}
                optional={["netx"]}
                panels={{
                  book: <PositionsPanel positions={feed.positions} strategists={desk.strategists} recentTrades={feed.recentTrades} liveMarks={liveMarks} onOpenTrade={setHlTrade} loading={feed.updatedAt == null} />,
                  netx: <NetExposurePanel positions={feed.positions} liveMarks={liveMarks} />,
                  signals: <SignalsTape signals={feed.signals} />,
                  chain: (
                    <>
                      <OptionChain
                        snapshot={data.snapshot}
                        spot={data.spot}
                        deltasModeled={data.deltasModeled}
                        selected={selected}
                        onSelect={(s) => setSelected((cur) => (cur === s ? null : s))}
                        symbol={symbol}
                        compact
                      />
                      {selected && <ContractDetailView occSymbol={selected} onClose={() => setSelected(null)} history={contractHistory} />}
                    </>
                  ),
                }}
              />
            </div>
            {/* SESSION SEQUENCER — the day as a 16-step pattern, under the live
                chain (909-redesign slice 1). Read-only off the same feed. */}
            <SessionSequencer positions={feed.positions} recentTrades={feed.recentTrades} strategists={desk.strategists} />
          </div>
        </>)}
      </section>

      {/* ============ 02 MIX — tune: strips · fleet table · bench ============ */}
      <section className="room room--mix" id="room-mix" data-room-id="mix">
        <RoomHead def={ROOM_DEFS[1]} folded={roomFolds.mix} onToggle={() => toggleRoom("mix")} />
        {!roomFolds.mix && (<>
          <div className="mix-ctl">
            <span className="roster-toggle" title="per-channel strips vs the fleet table">
              <button type="button" className={rosterView === "strips" ? "on" : ""} onClick={() => setRosterView("strips")}>strips</button>
              <button type="button" className={rosterView === "table" ? "on" : ""} onClick={() => setRosterView("table")}>table</button>
            </span>
            {canWrite && rosterView === "strips" && (
              <span className="group-by" title="auto-arrange the channels, then nudge by hand">
                <span className="gb-label">group</span>
                <button type="button" onClick={() => groupByFlip("underlying")}>ticker</button>
                <button type="button" onClick={() => groupByFlip("regime")}>regime</button>
              </span>
            )}
          </div>
          <div className="console-grid">
            <div className="channels-col">
              {rosterView === "table" ? (
                <RosterTable channels={armed} livePnl={livePnl} />
              ) : (
              <DndContext id="mixer-strips" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={channelOrder} strategy={rectSortingStrategy}>
                  <div className="channels">
                    {armed.map((s) => (
                      <SortableChannel
                        key={s.slug}
                        strategist={s}
                        pnl={livePnl[s.slug]}
                        active={isActive(s.slug)}
                        ducked={anySolo && !s.config.soloed && !s.config.muted}
                        disabled={!canWrite}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              )}
              {benched.length > 0 && (
                <div className="bench">
                  <div className="bench-bar">
                    <span className="bench-title">Bench · 86&apos;d</span>
                    <span className="bench-hint">no entries; open positions wind down — tap to inspect / re-arm</span>
                  </div>
                  <div className="bench-pads">
                    {benched.map((s) => (
                      <button
                        key={s.slug}
                        type="button"
                        className={`bench-pad${benchOpen === s.slug ? " on" : ""}`}
                        style={{ ["--pad" as string]: pmVar(s.color) }}
                        onClick={() => setBenchOpen((cur) => (cur === s.slug ? null : s.slug))}
                        title={`${s.name} — ${s.status}`}
                      >
                        {padCode(s)}
                      </button>
                    ))}
                  </div>
                  {benchOpen && (() => {
                    const s = benched.find((x) => x.slug === benchOpen);
                    if (!s) return null;
                    return (
                      <div className="bench-open">
                        <ChannelStrip strategist={s} pnl={livePnl[s.slug]} active={false} ducked={false} />
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </>)}
      </section>

      {/* ============ 03 WRITE — compose: add-channel · virtual bench ======== */}
      <section className="room room--write log-section" id="room-write" data-room-id="write">
        <RoomHead def={ROOM_DEFS[2]} folded={roomFolds.write} onToggle={() => toggleRoom("write")} />
        {!roomFolds.write && (
          <div className="grid grid--live grid--even">
            <div className="col">
              <div className={`panel write-compose${composeFolded ? " folded" : ""}`}>
                <div className="phead"><span className="t">Add Channel</span><span className="x">thesis → spec → gate → arm</span><button type="button" className="pfold" onClick={toggleCompose} aria-expanded={!composeFolded} title={composeFolded ? "expand" : "collapse"}>{composeFolded ? "▸" : "▾"}</button></div>
                <div className="pbody">
                  <p className="write-hint">
                    Import a strategy thesis (.md): instant frontmatter preview, LLM compile to a spec,
                    the 5-window backtest gate, then arm to the bench. Duplicates for A/Bs live on each
                    strip&apos;s flip-editor in MIX.
                  </p>
                  <button
                    className="add-channel-btn"
                    disabled={!canDirectConfigure}
                    title={canDirectConfigure ? "Add a channel" : write.configurationWriteFact}
                    onClick={() => setAddOpen(true)}
                  >
                    + Add via proposal
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ============ 04 TAPE — review: P&L · autopsies · forensics ========== */}
      <section className="room room--tape log-section" id="room-tape" data-room-id="tape">
        <RoomHead def={ROOM_DEFS[3]} folded={roomFolds.tape} onToggle={() => toggleRoom("tape")} />
        {!roomFolds.tape && (
          /* TAPE is a RACK — both columns fill; drag ⠿ to arrange the review stack */
          <Rack
            storageKey="seve-rack-tape"
            defaults={{ a: ["pnl", "autopsy", "forensics"], b: ["brief", "sentinel"] }}
            panels={{
              pnl: <PnlPanel
                strategists={desk.strategists}
                pnlByStrategist={livePnl}
                fundPnl={liveFund}
                equityCurve={feed.equityCurve}
                window={reviewEvidence.pnlWindow}
                setWindow={reviewEvidence.setPnlWindow}
                windowed={reviewEvidence.windowedPnl}
                scopeLabel={accountScope}
                todayAttribution={feed.positionAttribution}
              />,
              autopsy: <AutopsyPanel strategists={desk.strategists} daily={reviewEvidence.daily} weekly={reviewEvidence.weekly} />,
              brief: <BriefPanel />,
              sentinel: <SentinelPanel />,
              forensics: <ForensicsPanel
                forensics={reviewEvidence.forensics}
                pyramid={reviewEvidence.pyramid}
                virtualBench={reviewEvidence.virtualBench}
              />,
            }}
          />
        )}
      </section>

      {/* ============ 05 OPS — tend the machine ============================== */}
      <section className="room room--ops log-section" id="room-ops" data-room-id="ops">
        <RoomHead def={ROOM_DEFS[4]} folded={roomFolds.ops} onToggle={() => toggleRoom("ops")} />
        {!roomFolds.ops && (<>
          <DayBooksStrip
            strategists={desk.strategists}
            pnl={livePnl}
            fund={liveFund}
            closedToday={feed.sessionTrades.closed}
            openCount={feed.sessionTrades.open}
          />
          <div style={{ marginTop: 14 }}>
            <Rack
              storageKey="seve-rack-ops"
              gridClass="grid grid--live grid--even"
              colAClass="col"
              colBClass="col"
              defaults={{ a: ["preflight", "eventlog"], b: ["master", "masterstop", "settings"] }}
              panels={{
                preflight: (
                  <OpsPreflight
                    strategists={desk.strategists}
                    tape={{ lastIngestTs: data.lastIngestTs, snapCount: data.snapshot.length, expirations: data.expirations }}
                    ops={ops}
                  />
                ),
                eventlog: <EventLog events={data.events} />,
                /* the MASTER hardware panel (capital knob · big NAV LED · full transport)
                   lives in OPS — the shell transport carries the daily-use controls */
                master: <MasterStrip fund={desk.fund} fundPnl={liveFund} />,
                masterstop: <MasterStopControl fund={desk.fund} />,
                settings: (
                  <div className="panel">
                    <div className="phead"><span className="t">Settings</span><span className="x">operator · chassis · alerts</span></div>
                    <div className="pbody ops-controls">
                      <PushToggle />
                      <div className="theme-toggle">
                        <span>Chassis theme</span>
                        <button type="button" className={theme === "cream" ? "on" : ""} onClick={() => setTheme("cream")}>cream</button>
                        <button type="button" className={theme === "blackout" ? "on" : ""} onClick={() => setTheme("blackout")}>blackout</button>
                      </div>
                      <AuthControl />
                    </div>
                  </div>
                ),
              }}
            />
          </div>
        </>)}
      </section>
    </div>
  );
}
