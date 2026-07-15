import type { Position, StrategistState } from "@/lib/desk/types";

export interface MarketRiskRow {
  position: Position;
  strategist?: StrategistState;
  mark: number;
  unrealized: number;
  contractLabel: string;
}

export interface MarketRiskSummary {
  rows: MarketRiskRow[];
  totalUnrealized: number;
}

export function operationalMark(position: Position, liveMarks: Record<string, number>): number {
  const live = liveMarks[position.occ_symbol];
  return live != null && Number.isFinite(live) && live > 0 ? live : position.current_mark;
}

export function deriveMarketRisk(
  positions: Position[],
  strategists: StrategistState[],
  liveMarks: Record<string, number>,
): MarketRiskSummary {
  const rows = positions.map((position) => {
    const strategist = strategists.find((candidate) => candidate.slug === position.strategist_slug);
    const mark = operationalMark(position, liveMarks);
    const root = position.occ_symbol.match(/^([A-Z]+)\d/)?.[1] ?? strategist?.underlying ?? "SPY";
    return {
      position,
      strategist,
      mark,
      unrealized: (mark - position.avg_entry_price) * position.qty * 100,
      contractLabel: `${root} ${position.strike.toFixed(0)}${position.opt_type === "call" ? "C" : "P"} ×${position.qty}`,
    };
  });
  return { rows, totalUnrealized: rows.reduce((sum, row) => sum + row.unrealized, 0) };
}
