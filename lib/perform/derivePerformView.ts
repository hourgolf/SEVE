import type { ChannelPnl, StrategistState } from "@/lib/desk/types";
import type { MarketEvent } from "@/lib/types";
import type { Severity } from "@/lib/incident/deriveIncident";

export type PerformFocus = "market" | "positions" | "incident";
export type PerformSection = "overview" | "market" | "positions" | "research" | "sentinel" | "tape" | "ops";

export interface CollapsedEvent extends MarketEvent {
  count: number;
}

export interface PrioritizedChannels {
  visible: StrategistState[];
  inactive: StrategistState[];
}

/**
 * The chart is the default instrument, but it stops being the hero when the desk
 * has exposure or a deterministic high-severity incident. This is presentation
 * priority only: severity remains owned by deriveIncident at the page seam.
 */
export function derivePerformFocus(severity: Severity, openPositions: number): PerformFocus {
  if (severity === "critical" || severity === "high") return "incident";
  if (openPositions > 0) return "positions";
  return "market";
}

function channelRank(ch: StrategistState, pnl?: ChannelPnl): number {
  if ((pnl?.openCount ?? 0) > 0) return 0;
  if (ch.config.muted || ch.config.boosted || (pnl?.dayPnl ?? 0) !== 0) return 1;
  if (ch.status === "armed") return 2;
  return 3;
}

/**
 * Keep the dock operationally small: exposure and exceptions first, healthy
 * armed channels next, inert draft/disabled rows behind one explicit fold.
 */
export function prioritizeChannels(
  channels: StrategistState[],
  livePnl: Record<string, ChannelPnl>,
): PrioritizedChannels {
  const ordered = channels
    .map((ch, index) => ({ ch, index, rank: channelRank(ch, livePnl[ch.slug]) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  return {
    visible: ordered.filter((x) => x.rank < 3).map((x) => x.ch),
    inactive: ordered.filter((x) => x.rank === 3).map((x) => x.ch),
  };
}

/** Collapse only adjacent duplicates so chronology remains truthful. */
export function collapseEvents(events: MarketEvent[]): CollapsedEvent[] {
  const out: CollapsedEvent[] = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (prev && prev.level === event.level && prev.message.trim() === event.message.trim()) {
      prev.count += 1;
      continue;
    }
    out.push({ ...event, count: 1 });
  }
  return out;
}
