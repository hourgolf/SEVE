"use client";

import { type ReactNode, useState } from "react";
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
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useChannelOrdering } from "@/hooks/useChannelOrdering";
import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import { MasterStrip } from "@/components/console/MasterStrip";
import { StepRow } from "@/components/console/hw/StepRow";
import { Bezel } from "@/components/console/hw/Bezel";
import { PositionsPanel } from "@/components/console/PositionsPanel";
import { PnlPanel } from "@/components/console/PnlPanel";
import { SignalsTape } from "@/components/console/SignalsTape";
import { DailyAutopsyPanel } from "@/components/console/DailyAutopsyPanel";
import { WeeklyAutopsyPanel } from "@/components/console/WeeklyAutopsyPanel";
import { usePositionMarks } from "@/hooks/usePositionMarks";
import { channelPnl } from "@/lib/desk/derive";
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
}: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [addOpen, setAddOpen] = useState(false);
  const [hlTrade, setHlTrade] = useState<Position | null>(null); // trade highlighted on the chart
  const { canWrite } = write;

  // ---- drag-to-reorder + group-by (operator only; persists sort_order) ----
  // Logic lives in the shared useChannelOrdering hook (mobile uses it too); desktop just
  // drives `persist` from dnd-kit's drag end.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { order: channelOrder, persist, groupBy } = useChannelOrdering(desk.strategists, write);
  const onDragEnd = (e: DragEndEvent) => {
    const from = channelOrder.indexOf(String(e.active.id));
    const to = e.over ? channelOrder.indexOf(String(e.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    persist(arrayMove(channelOrder, from, to));
  };

  // occ_symbol → live option mark (delta-extrapolated off the fast spot tick), so
  // open positions mark in real time, not once a minute. Recomputes each spot tick.
  // Live marks for ALL open positions (both tickers) — independent of the selected
  // chart, so the unselected ticker's positions don't freeze. (was chart-bound)
  const liveMarks = usePositionMarks(feed.positions);
  // Per-channel P&L re-derived off the SAME live marks, so the Equity rows + channel
  // strips track the Open Positions panel instead of lagging on stored unrealized_pnl.
  const livePnl = channelPnl(feed.positions, liveMarks);

  return (
    <Chassis
      brand={<>$EVE<span> · DESK</span></>}
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
        <HeadReadouts fund={desk.fund} fundPnl={feed.fundPnl} spot={data.spot} spotUp={spotUp} symbol={symbol} />
      </div>

      {data.error && <ErrorBanner message={data.error} isAccessError={data.isAccessError} />}

      {/* ---- 01 · LIVE DESK (chart hero → book + chain | P&L) ---------- */}
      <SectionLabel id="live" idx="01">Live Desk</SectionLabel>
      <div className="market-section">
        <IntradayChart bars={data.bars} dailyBars={data.dailyBars} spot={data.spot} spotUp={spotUp} trades={feed.recentTrades} openPositions={feed.positions} highlightTrade={hlTrade} symbol={symbol} onSymbolChange={setSymbol} />
        <div className="grid grid--live live-body">
          <div className="col">
            <PositionsPanel positions={feed.positions} strategists={desk.strategists} recentTrades={feed.recentTrades} liveMarks={liveMarks} onOpenTrade={setHlTrade} />
            <OptionChain
              snapshot={data.snapshot}
              spot={data.spot}
              deltasModeled={data.deltasModeled}
              selected={selected}
              onSelect={(s) => setSelected((cur) => (cur === s ? null : s))}
              symbol={symbol}
            />
            {selected && <ContractDetail occSymbol={selected} onClose={() => setSelected(null)} />}
          </div>
          <div className="col col--fill">
            <PnlPanel
              strategists={desk.strategists}
              pnlByStrategist={livePnl}
              fundPnl={feed.fundPnl}
              equityCurve={feed.equityCurve}
            />
          </div>
        </div>
      </div>

      {/* ---- 02 · STRATEGY COMPOSER ----------------------------------- */}
      <SectionLabel id="composer" idx="02">
        Strategy Composer
        {canWrite && (
          <span className="group-by" title="auto-arrange the channels, then nudge by hand">
            <span className="gb-label">group</span>
            <button type="button" onClick={() => groupBy("underlying")}>ticker</button>
            <button type="button" onClick={() => groupBy("regime")}>regime</button>
          </span>
        )}
        <button className="add-channel-btn" onClick={() => setAddOpen(true)}>+ Add Channel</button>
      </SectionLabel>
      {addOpen && (
        <AddChannel
          onClose={() => setAddOpen(false)}
          existingSlugs={desk.strategists.map((s) => s.slug)}
        />
      )}
      <div className="console-grid">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={channelOrder} strategy={rectSortingStrategy}>
            <div className="channels">
              {desk.strategists.map((s) => (
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
        <MasterStrip fund={desk.fund} fundPnl={feed.fundPnl} />
      </div>
      <Bezel label="16-Step Tape · recent signals" className="tape">
        <StepRow steps={feed.steps} />
      </Bezel>

      {/* ---- 03 · LOG (autopsy → signals + tape health → event log) --- */}
      <SectionLabel id="log" idx="03">Log</SectionLabel>
      <div className="log-section">
        <div className="grid grid--live grid--even au-pair">
          <div className="col"><DailyAutopsyPanel strategists={desk.strategists} /></div>
          <div className="col"><WeeklyAutopsyPanel strategists={desk.strategists} /></div>
        </div>
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
      </div>
    </Chassis>
  );
}
