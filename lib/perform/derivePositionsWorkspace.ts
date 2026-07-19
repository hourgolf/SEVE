import { computeNetExposure, type NetExposure } from "@/lib/desk/netExposure";
import type { Position } from "@/lib/desk/types";
import { operationalMark } from "@/lib/perform/deriveMarketWorkspace";

export interface OpenBookSummary {
  count: number;
  contracts: number;
  unrealized: number;
  notional: number;
}

export interface OpenPositionDecisionRow {
  position: Position;
  mark: number;
  unrealized: number;
  returnPct: number | null;
  peakMark: number | null;
  peakPct: number | null;
  givebackPct: number | null;
  capturePct: number | null;
  markedNotional: number;
}

export interface RecentExitRow {
  position: Position;
  returnPct: number | null;
  peakPct: number | null;
  givebackPct: number | null;
  capturePct: number | null;
  peakExceeded: boolean;
  holdMinutes: number | null;
}

export interface RecentExitSummary {
  rows: RecentExitRow[];
  realized: number;
  wins: number;
  losses: number;
}

export interface PositionsWorkspaceModel {
  open: OpenBookSummary;
  rows: OpenPositionDecisionRow[];
  exposure: NetExposure;
  exits: RecentExitSummary;
}

const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

export function deriveOpenPositionRows(
  positions: Position[],
  liveMarks: Record<string, number>,
  observedPeaks: Record<string, number> = {},
): OpenPositionDecisionRow[] {
  return positions.map((position) => {
    const entry = position.avg_entry_price;
    const mark = operationalMark(position, liveMarks);
    const observedPeak = observedPeaks[position.occ_symbol];
    const durablePeak = position.peak_mark;
    const peakMark = finite(observedPeak) && observedPeak > 0
      ? observedPeak
      : finite(durablePeak) && durablePeak > 0
        ? durablePeak
        : null;
    const direction = Math.sign(position.qty) || 1;
    const returnPct = entry > 0 && finite(mark)
      ? ((mark - entry) / entry) * 100 * direction
      : null;
    const peakPct = entry > 0 && peakMark != null && peakMark > entry
      ? ((peakMark - entry) / entry) * 100 * direction
      : null;
    const peakRange = peakMark != null ? (peakMark - entry) * direction : 0;
    const givebackPct = peakPct != null && peakMark != null && (mark - peakMark) * direction < 0
      ? Math.min(999, Math.max(0, ((peakMark - mark) * direction / peakRange) * 100))
      : null;
    const capturePct = peakPct != null && peakRange > 0
      ? Math.min(999, Math.max(-999, (((mark - entry) * direction) / peakRange) * 100))
      : null;
    return {
      position,
      mark,
      unrealized: (mark - entry) * position.qty * 100,
      returnPct,
      peakMark,
      peakPct,
      givebackPct,
      capturePct,
      markedNotional: Math.abs(mark * position.qty * 100),
    };
  });
}

export function deriveRecentExits(recentTrades: Position[]): RecentExitSummary {
  const rows = recentTrades.map((position) => {
    const entry = position.avg_entry_price;
    const exit = position.current_mark;
    const peak = finite(position.peak_mark) ? position.peak_mark : null;
    const returnPct = entry > 0 && finite(exit) ? ((exit - entry) / entry) * 100 : null;
    const peakPct = entry > 0 && peak != null && peak > entry ? ((peak - entry) / entry) * 100 : null;
    const peakExceeded = peakPct != null && peak != null && exit > peak;
    const givebackPct = peakPct != null && peak != null && exit < peak
      ? Math.min(999, Math.max(0, ((peak - exit) / (peak - entry)) * 100))
      : null;
    const capturePct = peakPct != null && peak != null && !peakExceeded
      ? Math.min(999, Math.max(-999, ((exit - entry) / (peak - entry)) * 100))
      : null;
    const openedAt = position.opened_at ? Date.parse(position.opened_at) : Number.NaN;
    const closedAt = position.closed_at ? Date.parse(position.closed_at) : Number.NaN;
    const holdMinutes = Number.isFinite(openedAt) && Number.isFinite(closedAt) && closedAt >= openedAt
      ? Math.round((closedAt - openedAt) / 60_000)
      : null;
    return { position, returnPct, peakPct, givebackPct, capturePct, peakExceeded, holdMinutes };
  });
  return {
    rows,
    realized: rows.reduce((sum, row) => sum + (row.position.realized_pnl ?? 0), 0),
    wins: rows.filter((row) => (row.position.realized_pnl ?? 0) > 0).length,
    losses: rows.filter((row) => (row.position.realized_pnl ?? 0) < 0).length,
  };
}

export function derivePositionsWorkspace(
  positions: Position[],
  recentTrades: Position[],
  liveMarks: Record<string, number>,
  observedPeaks: Record<string, number> = {},
): PositionsWorkspaceModel {
  const rows = deriveOpenPositionRows(positions, liveMarks, observedPeaks);
  const exposure = computeNetExposure(positions, liveMarks);
  const unrealized = rows.reduce((sum, row) => sum + row.unrealized, 0);
  return {
    open: {
      count: positions.length,
      contracts: positions.reduce((sum, position) => sum + Math.abs(position.qty), 0),
      unrealized,
      notional: exposure.totalNotional,
    },
    rows,
    exposure,
    exits: deriveRecentExits(recentTrades),
  };
}
