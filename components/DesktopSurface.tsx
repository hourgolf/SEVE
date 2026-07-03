"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { AddChannel } from "@/components/console/AddChannel";
import { AuthControl } from "@/components/AuthControl";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetail } from "@/components/ContractDetail";
import { OpsPreflight } from "@/components/console/OpsPreflight";
import { DayBooksStrip } from "@/components/console/DayBooksStrip";
import { MasterStopControl } from "@/components/console/MasterStopControl";
import { EventLog } from "@/components/EventLog";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ChannelStrip } from "@/components/console/ChannelStrip";
import { RosterTable } from "@/components/console/RosterTable";
import { SessionSequencer } from "@/components/console/SessionSequencer";
import { TodayStrip } from "@/components/console/TodayStrip";
import { DndContext, closestCenter, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useChannelOrdering } from "@/hooks/useChannelOrdering";
import { useFold } from "@/hooks/useFold";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { MasterStrip } from "@/components/console/MasterStrip";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { NetExposurePanel } from "@/components/console/NetExposurePanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { ManVsMachine } from "@/components/console/ManVsMachine";
import { PushToggle } from "@/components/console/PushToggle";
import { SignalsTape } from "@/components/console/SignalsTape";
import { DailyAutopsyPanel } from "@/components/console/DailyAutopsyPanel";
import { WeeklyAutopsyPanel } from "@/components/console/WeeklyAutopsyPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { LabPanel } from "@/components/console/LabPanel";
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

// ---- RACK v1 (slice 5): the Live Book panels are modules — drag the ⠿ grip to
// re-rack them within/between the two columns; order persists locally. ----
const RACK_KEY = "seve-rack-livebook";
const RACK_DEFAULT: Record<"a" | "b", string[]> = { a: ["book", "netx"], b: ["signals", "chain"] };

function RackItem({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={`rack-item${isDragging ? " dragging" : ""}`}
    >
      <button type="button" className="rack-grip" {...attributes} {...listeners} title="drag to re-rack this panel" aria-label={`move ${id} panel`}>⠿</button>
      {children}
    </div>
  );
}

function RackColumn({ colId, className, items, panels }: { colId: "a" | "b"; className: string; items: string[]; panels: Record<string, ReactNode> }) {
  const { setNodeRef } = useDroppable({ id: `col-${colId}` });
  return (
    <div ref={setNodeRef} className={className}>
      <SortableContext items={items} strategy={rectSortingStrategy}>
        {items.map((k) => (
          <RackItem key={k} id={k}>
            {panels[k]}
          </RackItem>
        ))}
      </SortableContext>
    </div>
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
}: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [addOpen, setAddOpen] = useState(false);
  const [rosterView, setRosterView] = useState<"strips" | "table">("strips"); // Mixer: per-channel strips vs the fleet table
  const [hlTrade, setHlTrade] = useState<Position | null>(null); // trade highlighted on the chart
  const [composeFolded, toggleCompose] = useFold("compose");
  const { canWrite } = write;

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

  // ---- RACK v1 state: per-column panel order, local preference ----
  const [rack, setRack] = useState<Record<"a" | "b", string[]>>(RACK_DEFAULT);
  const rackLoaded = useRef(false);
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(RACK_KEY);
      if (s) {
        const p = JSON.parse(s) as Record<"a" | "b", string[]>;
        if (Array.isArray(p?.a) && Array.isArray(p?.b)) setRack(p);
      }
    } catch { /* */ }
    rackLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!rackLoaded.current) return;
    try { window.localStorage.setItem(RACK_KEY, JSON.stringify(rack)); } catch { /* */ }
  }, [rack]);
  const rackColOf = (id: string): "a" | "b" | null =>
    id === "col-a" || rack.a.includes(id) ? "a" : id === "col-b" || rack.b.includes(id) ? "b" : null;
  const onRackDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = rackColOf(String(active.id));
    const to = rackColOf(String(over.id));
    if (!from || !to || from === to) return;
    setRack((r) => {
      const src = r[from].filter((x) => x !== String(active.id));
      const dst = [...r[to]];
      const overIdx = dst.indexOf(String(over.id));
      dst.splice(overIdx >= 0 ? overIdx : dst.length, 0, String(active.id));
      return { ...r, [from]: src, [to]: dst };
    });
  };
  const onRackDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const col = rackColOf(String(active.id));
    if (!col) return;
    setRack((r) => {
      const from = r[col].indexOf(String(active.id));
      const to = r[col].indexOf(String(over.id));
      if (from < 0 || to < 0 || from === to) return r;
      return { ...r, [col]: arrayMove(r[col], from, to) };
    });
  };
  const rackSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // ---- drag-to-reorder + group-by (operator only; persists sort_order) ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { order: channelOrder, persist, groupBy } = useChannelOrdering(armed, write);
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
              {/* RACK v1 — the four Live Book modules; ⠿ re-racks within/between columns */}
              {(() => {
                const rackPanels: Record<string, ReactNode> = {
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
                      {selected && <ContractDetail occSymbol={selected} onClose={() => setSelected(null)} />}
                    </>
                  ),
                };
                return (
                  // stable id — dnd-kit's auto ids are SSR-nondeterministic with 2 contexts
                  <DndContext id="rack-livebook" sensors={rackSensors} collisionDetection={closestCenter} onDragOver={onRackDragOver} onDragEnd={onRackDragEnd}>
                    <div className="grid grid--live">
                      <RackColumn colId="a" className="col col--fill" items={rack.a} panels={rackPanels} />
                      <RackColumn colId="b" className="col" items={rack.b} panels={rackPanels} />
                    </div>
                  </DndContext>
                );
              })()}
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
                <button type="button" onClick={() => groupBy("underlying")}>ticker</button>
                <button type="button" onClick={() => groupBy("regime")}>regime</button>
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
                  <button className="add-channel-btn" onClick={() => setAddOpen(true)}>+ Add Channel</button>
                </div>
              </div>
            </div>
            <div className="col"><LabPanel /></div>
          </div>
        )}
      </section>

      {/* ============ 04 TAPE — review: P&L · autopsies · forensics ========== */}
      <section className="room room--tape log-section" id="room-tape" data-room-id="tape">
        <RoomHead def={ROOM_DEFS[3]} folded={roomFolds.tape} onToggle={() => toggleRoom("tape")} />
        {!roomFolds.tape && (<>
          <div className="grid grid--live">
            <div className="col col--fill">
              <PnlPanel
                strategists={desk.strategists}
                pnlByStrategist={livePnl}
                fundPnl={liveFund}
                equityCurve={feed.equityCurve}
              />
              <ManVsMachine strategists={desk.strategists} pnl={livePnl} />
            </div>
          </div>
          <div className="grid grid--live grid--even au-pair" style={{ marginTop: 14 }}>
            <div className="col"><DailyAutopsyPanel strategists={desk.strategists} /></div>
            <div className="col"><WeeklyAutopsyPanel strategists={desk.strategists} /></div>
          </div>
          <div style={{ marginTop: 14 }}><ForensicsPanel /></div>
        </>)}
      </section>

      {/* ============ 05 OPS — tend the machine ============================== */}
      <section className="room room--ops log-section" id="room-ops" data-room-id="ops">
        <RoomHead def={ROOM_DEFS[4]} folded={roomFolds.ops} onToggle={() => toggleRoom("ops")} />
        {!roomFolds.ops && (<>
          <DayBooksStrip
            strategists={desk.strategists}
            pnl={livePnl}
            fund={liveFund}
            closedToday={feed.recentTrades.length}
            openCount={feed.positions.length}
          />
          <div className="grid grid--live grid--even" style={{ marginTop: 14 }}>
            <div className="col">
              <OpsPreflight
                strategists={desk.strategists}
                tape={{ rowCount: data.rowCount, lastIngestTs: data.lastIngestTs, snapCount: data.snapshot.length, expirations: data.expirations }}
                ops={ops}
              />
            </div>
            <div className="col">
              {/* the MASTER hardware panel (capital knob · big NAV LED · full transport)
                  lives in OPS now — the shell transport carries the daily-use controls */}
              <MasterStrip fund={desk.fund} fundPnl={liveFund} />
              <MasterStopControl fund={desk.fund} />
              <div className="ops-controls" style={{ marginTop: 14 }}>
                <PushToggle />
                <div className="theme-toggle">
                  <span>Chassis theme</span>
                  <button type="button" className={theme === "cream" ? "on" : ""} onClick={() => setTheme("cream")}>cream</button>
                  <button type="button" className={theme === "blackout" ? "on" : ""} onClick={() => setTheme("blackout")}>blackout</button>
                </div>
                <AuthControl />
              </div>
            </div>
          </div>
          <div className="log-foot" style={{ marginTop: 14 }}>
            <EventLog events={data.events} />
          </div>
        </>)}
      </section>
    </div>
  );
}
