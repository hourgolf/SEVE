"use client";

import { useMemo, useState } from "react";
import type { MarketReadHealth } from "@/hooks/useMarketData";
import type { StrategistState } from "@/lib/desk/types";
import { pmVar } from "@/lib/desk/colors";
import { timeOfDay } from "@/lib/format";
import type { MarketEvent } from "@/lib/types";
import {
  deriveAfterActionStatus, deriveEventTapeStatus, deriveTapeRows, filterTapeRows,
  type EventTapeFilter, type TapeRow,
} from "@/lib/perform/eventTape";
import type { OpsReadinessModel } from "@/lib/ops/readiness";
import { PositionEvidenceChains } from "@/components/ops/OpsReadinessPanel";

const FILTERS: { id: EventTapeFilter; label: string }[] = [
  { id: "all", label: "ALL" }, { id: "execution", label: "EXECUTION" },
  { id: "risk", label: "RISK / WARN" }, { id: "data", label: "DATA" },
  { id: "sentinel", label: "SENTINEL" }, { id: "system", label: "SYSTEM" },
];

const localTime = (value: string): string => value ? new Date(value).toLocaleString("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
}) + " PT" : "—";

function EventMessage({ event, strategists, readiness }: { event: TapeRow; strategists: StrategistState[]; readiness: OpsReadinessModel }) {
  if (event.message === "Manager observers started slowly during restart") {
    const managers = readiness.evidence.find((item) => item.id === "managers");
    return <span>{managers?.tone === "green" ? `Manager observers started slowly during restart · resolved (${managers.detail})` : event.message}</span>;
  }
  const hit = strategists.find((row) => event.message.includes(row.slug));
  if (!hit) return <span>{event.message}</span>;
  const index = event.message.indexOf(hit.slug);
  return <span>{event.message.slice(0, index)}<b style={{ color: pmVar(hit.color) }}>{hit.slug}</b>{event.message.slice(index + hit.slug.length)}</span>;
}

export function TapeReadStrip({ health, events, compact = false }: {
  health: MarketReadHealth; events: MarketEvent[]; compact?: boolean;
}) {
  const status = deriveEventTapeStatus(health, events);
  return <div className={`tape-read-strip ${status.tone}${compact ? " compact" : ""}`} role="status">
    <i /><span><b>{status.label}</b><small>{status.detail}</small></span>
    {!compact && <><span><small>LAST QUERY OK</small><b>{localTime(health.lastSuccessAt ?? "")}</b></span><span><small>LATEST ROW</small><b>{localTime(status.latestAt)}</b></span></>}
  </div>;
}

export function EventTapeWorkspace({ events, health, strategists, readiness, embedded = false }: {
  events: MarketEvent[]; health: MarketReadHealth; strategists: StrategistState[]; readiness: OpsReadinessModel; embedded?: boolean;
}) {
  const [view, setView] = useState<"live" | "evidence">("live");
  const [filter, setFilter] = useState<EventTapeFilter>("all");
  const rows = useMemo(() => deriveTapeRows(events), [events]);
  const visible = useMemo(() => filterTapeRows(rows, filter), [rows, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(({ id }) => [id, filterTapeRows(rows, id).length])), [rows]);
  const evidenceStatus = deriveAfterActionStatus(readiness);

  return <section className="etw" id="perform-tape" tabIndex={-1} aria-label="Event Tape evidence workspace">
    <header className={`etw-head${embedded ? " embedded" : ""}`}>{!embedded && <span><b>EVENT TAPE</b><small>live operations + linked after-action evidence</small></span>}<nav aria-label="review view"><button type="button" className={view === "live" ? "on" : ""} onClick={() => setView("live")}>LIVE TAPE</button><button type="button" className={view === "evidence" ? "on" : ""} onClick={() => setView("evidence")}>TRADE EVIDENCE</button></nav></header>
    {view === "live" ? <TapeReadStrip health={health} events={events} /> : <div className={`tape-read-strip evidence ${evidenceStatus.tone}`} role="status"><i /><span><b>{evidenceStatus.label}</b><small>{evidenceStatus.detail}</small></span></div>}
    <div className="etw-tools">
      {view === "live" ? <><nav aria-label="event tape filter">{FILTERS.map((item) => <button type="button" key={item.id} className={filter === item.id ? "on" : ""} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id] ?? 0}</span></button>)}</nav><p>Supabase <code>events</code> · newest {events.length}/14 rows queried · filters apply only to this retained window</p></>
        : <p>linked by RC5 opportunity and position identity · configured evidence claims remain in Ops</p>}
    </div>
    {view === "live" ? <div className="etw-list">
      {visible.length === 0 ? <div className="etw-empty">no {filter === "all" ? "" : `${filter} `}events in the retained window</div> : visible.map((event) => <article key={event.id} data-kind={event.category}>
        <time>{timeOfDay(event.created_at)}</time><span className="etw-level">{event.level}</span><span className="etw-category">{event.category}</span>
        <EventMessage event={event} strategists={strategists} readiness={readiness} />
        {event.count > 1 && <strong title={`${event.count} adjacent identical events`}>×{event.count}</strong>}
      </article>)}
    </div> : <div className="etw-evidence"><PositionEvidenceChains model={readiness} /></div>}
  </section>;
}
