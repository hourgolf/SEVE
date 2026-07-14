// Phase 1H-B pure capture primitives. No socket, storage, database, broker,
// position, order, or execution dependency is permitted in this module.

import type { IntraminuteCaptureGap, SipQuoteEvent, SipTradeEvent } from "./intraminuteObserverModel.js";

export const INTRAMINUTE_CAPTURE_SCHEMA_VERSION = 1 as const;

export type IntraminuteCaptureEvent =
  | { schemaVersion: 1; kind: "trade"; symbol: string; providerAtMs: number; receivedAtMs: number; payload: SipTradeEvent }
  | { schemaVersion: 1; kind: "quote"; symbol: string; providerAtMs: number; receivedAtMs: number; payload: SipQuoteEvent }
  | { schemaVersion: 1; kind: "gap"; symbol: string; providerAtMs: number; receivedAtMs: number; payload: IntraminuteCaptureGap };

export interface CaptureQueueDrain {
  events: readonly IntraminuteCaptureEvent[];
  estimatedBytes: number;
  droppedEvents: number;
  rejectedOversize: number;
}
export interface CapturePartition {
  dateEt: string;
  hourEt: number;
  symbol: string;
  events: readonly IntraminuteCaptureEvent[];
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", hour12: false,
});

function etPartition(ms: number): { dateEt: string; hourEt: number } {
  let year = "", month = "", day = "", hour = 0;
  for (const part of ET_PARTS.formatToParts(new Date(ms))) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
    else if (part.type === "hour") hour = Number(part.value) % 24;
  }
  return { dateEt: `${year}-${month}-${day}`, hourEt: hour };
}

/** Synchronous bounded queue: observer pressure sheds evidence, never execution. */
export class BoundedIntraminuteCaptureQueue {
  private events: IntraminuteCaptureEvent[] = [];
  private estimatedBytes = 0;
  private droppedEvents = 0;
  private rejectedOversize = 0;

  constructor(readonly maxEvents: number, readonly maxBytes: number) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("maxEvents must be a positive integer");
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer");
  }

  enqueue(event: IntraminuteCaptureEvent): { accepted: boolean; utilization: number; reason?: "oversize" | "capacity" } {
    const bytes = Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
    if (bytes > this.maxBytes) {
      this.droppedEvents++;
      this.rejectedOversize++;
      return { accepted: false, utilization: this.utilization(), reason: "oversize" };
    }
    if (this.events.length >= this.maxEvents || this.estimatedBytes + bytes > this.maxBytes) {
      this.droppedEvents++;
      return { accepted: false, utilization: this.utilization(), reason: "capacity" };
    }
    this.events.push(event);
    this.estimatedBytes += bytes;
    return { accepted: true, utilization: this.utilization() };
  }

  size(): number { return this.events.length; }
  utilization(): number { return Math.max(this.events.length / this.maxEvents, this.estimatedBytes / this.maxBytes); }

  drain(): CaptureQueueDrain {
    const drained = {
      events: this.events,
      estimatedBytes: this.estimatedBytes,
      droppedEvents: this.droppedEvents,
      rejectedOversize: this.rejectedOversize,
    };
    this.events = [];
    this.estimatedBytes = 0;
    this.droppedEvents = 0;
    this.rejectedOversize = 0;
    return drained;
  }
}

/** Deterministic provider-time partitioning; receipt time never changes ownership. */
export function partitionIntraminuteCapture(events: readonly IntraminuteCaptureEvent[]): CapturePartition[] {
  const grouped = new Map<string, { dateEt: string; hourEt: number; symbol: string; events: IntraminuteCaptureEvent[] }>();
  for (const event of events) {
    const { dateEt, hourEt } = etPartition(event.providerAtMs);
    const symbol = event.symbol.toUpperCase();
    const key = `${dateEt}|${String(hourEt).padStart(2, "0")}|${symbol}`;
    const group = grouped.get(key) ?? { dateEt, hourEt, symbol, events: [] };
    group.events.push(event);
    grouped.set(key, group);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => ({
    ...group,
    events: [...group.events].sort((a, b) => a.providerAtMs - b.providerAtMs
      || a.receivedAtMs - b.receivedAtMs || a.kind.localeCompare(b.kind)),
  }));
}
