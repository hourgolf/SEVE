import type { OptionQuote } from "@/lib/types";

// occ_symbol → a "live" option mark for marking open positions.
//
// The option chain (option_quotes) only refreshes ~once a minute (the ingest
// cadence), but the spot LED ticks every few seconds via /api/spot. So a mark
// taken straight from the chain's mid freezes between minutes. We bridge the gap
// by nudging each contract's mid by delta·(liveSpot − quoteUnderlying) — a
// first-order (delta) estimate of where the option is trading right now. It's
// modeled (delta is itself modeled for 0DTE), but it makes Mark + Unrealized P&L
// move in real time instead of stepping once a minute. Falls back to the raw mid
// when spot or delta isn't available; floored at 0.
export function computeLiveMarks(
  snapshot: OptionQuote[],
  spot: number | null
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of snapshot) {
    if (q.mid == null) continue;
    let mark = Number(q.mid);
    if (spot != null && q.delta != null && q.underlying_price != null) {
      mark = Math.max(0, mark + Number(q.delta) * (spot - Number(q.underlying_price)));
    }
    out[q.occ_symbol] = mark;
  }
  return out;
}
