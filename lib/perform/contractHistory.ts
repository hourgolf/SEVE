import type { OptionQuote } from "@/lib/types";

/** Convert the newest-first bounded database result into chart order. */
export function normalizeContractHistoryRows(rows: OptionQuote[]): OptionQuote[] {
  return [...rows].sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
}
