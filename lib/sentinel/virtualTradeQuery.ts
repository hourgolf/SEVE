// Sentinel's virtual-trade scan must use the table's real primary key as the
// second sort key. pageAll requires a total order so page boundaries cannot
// duplicate or omit rows that share signal_at.
export const SENTINEL_VIRTUAL_TRADE_SELECT = [
  "slug",
  "mfe_pct",
  "giveback_pct",
  "pnl_per_contract",
  "signal_id",
].join(",");

export const SENTINEL_VIRTUAL_TRADE_ORDER = ["signal_at", "signal_id"] as const;

export type SentinelVirtualTradeRow = {
  signal_id: string;
  slug: string;
  mfe_pct: number;
  giveback_pct: number;
  pnl_per_contract: number;
};
