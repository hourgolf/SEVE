"use client";

import { type ReactNode, useState } from "react";
import { Chassis } from "@/components/console/Chassis";
import { AddChannel } from "@/components/console/AddChannel";
import { HeadReadouts } from "@/components/console/HeadReadouts";
import { IntradayChart } from "@/components/IntradayChart";
import { OptionChain } from "@/components/OptionChain";
import { ContractDetail } from "@/components/ContractDetail";
import { OpsPreflight } from "@/components/console/OpsPreflight";
import { DayBooksStrip } from "@/components/console/DayBooksStrip";
import { AccountSwitcher } from "@/components/console/AccountSwitcher";
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
import { ManVsMachine } from "@/components/console/ManVsMachine";
import { PushToggle } from "@/components/console/PushToggle";
import { SignalsTape } from "@/components/console/SignalsTape";
import { DailyAutopsyPanel } from "@/components/console/DailyAutopsyPanel";
import { WeeklyAutopsyPanel } from "@/components/console/WeeklyAutopsyPanel";
import { ForensicsPanel } from "@/components/console/ForensicsPanel";
import { padCode } from "@/components/mobile/MixerPads";
import { pmVar } from "@/lib/desk/colors";
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
  accounts,
  acctId,
  setAcctId,
  ops,
  liveMarks,
  livePnl,
  liveFund,
}: SurfaceProps) {
  const { desk, anySolo, isActive } = view;
  const [addOpen, setAddOpen] = useState(false);
  const [hlTrade, setHlTrade] = useState<Position | null>(null); // trade highlighted on the chart
  const { canWrite } = write;

  // Multi-account: scope the roster to the selected account (accounts/acctId lifted to Surface).
  const accountChannels = acctId ? desk.strategists.filter((s) => s.account_id === acctId) : desk.strategists;

  // The 86'd shelf: only ARMED channels get full strips; benched (draft) channels
  // collapse to small pads on a rail below — tap one to inspect / re-arm. Keeps a
  // 7-channel working surface after a cull instead of a graveyard of dead strips.
  const armed = accountChannels.filter((s) => s.status === "armed");
  const benched = accountChannels.filter((s) => s.status !== "armed");
  const [benchOpen, setBenchOpen] = useState<string | null>(null);

  // ---- drag-to-reorder + group-by (operator only; persists sort_order) ----
  // Logic lives in the shared useChannelOrdering hook (mobile uses it too); desktop just
  // drives `persist` from dnd-kit's drag end. Ordering covers the ARMED grid only —
  // bench pads keep their stored sort_order for when they return.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { order: channelOrder, persist, groupBy } = useChannelOrdering(armed, write);
  const onDragEnd = (e: DragEndEvent) => {
    const from = channelOrder.indexOf(String(e.active.id));
    const to = e.over ? channelOrder.indexOf(String(e.over.id)) : -1;
    if (from < 0 || to < 0 || from === to) return;
    persist(arrayMove(channelOrder, from, to));
  };

  // liveMarks / livePnl / liveFund are lifted to Surface (the seam) and arrive as props,
  // so the persistent shell LEDs and the rooms share the SAME live-marked values.

  return (
    <Chassis
      brand={<>$EVE<span> · DESK</span></>}
      right={
        <div className="head-nav">
          <AccountSwitcher accounts={accounts} selected={acctId} onSelect={setAcctId} />
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
          <PushToggle />
        </div>
      }
    >
      <div className="surface-bar">
        <MasterStrip fund={desk.fund} fundPnl={liveFund} compact />
        <HeadReadouts fund={desk.fund} fundPnl={liveFund} spot={data.spot} spotUp={spotUp} symbol={symbol} />
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
              fundPnl={liveFund}
              equityCurve={feed.equityCurve}
            />
            <ManVsMachine strategists={desk.strategists} pnl={livePnl} />
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
        <div className="channels-col">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
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
        <MasterStrip fund={desk.fund} fundPnl={liveFund} />
      </div>
      <Bezel label="16-Step Tape · recent signals" className="tape">
        <StepRow steps={feed.steps} />
      </Bezel>

      {/* ---- 03 · LOG (day·books strip → autopsy → signals + ops → event log) --- */}
      <SectionLabel id="log" idx="03">Log</SectionLabel>
      <div className="log-section">
        <DayBooksStrip
          strategists={desk.strategists}
          pnl={livePnl}
          fund={liveFund}
          closedToday={feed.recentTrades.length}
          openCount={feed.positions.length}
        />
        <div className="grid grid--live grid--even au-pair" style={{ marginTop: 14 }}>
          <div className="col"><DailyAutopsyPanel strategists={desk.strategists} /></div>
          <div className="col"><WeeklyAutopsyPanel strategists={desk.strategists} /></div>
        </div>
        <div style={{ marginTop: 14 }}><ForensicsPanel /></div>
        <div className="grid grid--live grid--even" style={{ marginTop: 14 }}>
          <div className="col">
            <SignalsTape signals={feed.signals} />
          </div>
          <div className="col">
            <OpsPreflight
              strategists={desk.strategists}
              tape={{ rowCount: data.rowCount, lastIngestTs: data.lastIngestTs, snapCount: data.snapshot.length, expirations: data.expirations }}
              ops={ops}
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
