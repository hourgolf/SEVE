"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Position } from "@/lib/desk/types";

// occ_symbol → a "live" mark for EVERY open position, BOTH tickers, independent of
// which chart/ticker is selected.
//
// BUG FIX: the old path marked positions off `useMarketData(symbol)` — the SELECTED
// ticker's chain + spot only. So when SPY was on screen, QQQ positions (and vice
// versa) had no live mark and froze on the worker's ~1-min unrealized_pnl cadence.
//
// This hook is ticker-agnostic: it pulls the latest option_quotes for exactly the
// HELD contracts (one `.in()` query, both tickers) + the fast /api/spot tick for
// each underlying, and marks each contract off its OWN ticker:
//   mark = mid + delta·(liveSpot − quoteUnderlying)   (floored at 0)
// — the same first-order delta estimate computeLiveMarks used, just not chart-bound.

const SPOT_SYMS = ["SPY", "QQQ"] as const;

async function fetchSpot(sym: string): Promise<number | null> {
  try {
    const r = await fetch(`/api/spot?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
    const j = await r.json();
    return typeof j.price === "number" ? j.price : null;
  } catch {
    return null;
  }
}

interface QuoteRow { occ_symbol: string; mid: number | null; delta: number | null; underlying_price: number | null; underlying: string }

export function usePositionMarks(positions: Position[]): Record<string, number> {
  const [marks, setMarks] = useState<Record<string, number>>({});
  // stable dependency: the set of held OCCs (re-poll only when it changes)
  const occKey = positions.filter((p) => p.status === "open").map((p) => p.occ_symbol).sort().join(",");

  useEffect(() => {
    const occs = occKey ? occKey.split(",") : [];
    if (!occs.length) { setMarks({}); return; }
    let alive = true;
    const sb = getSupabase();

    async function poll() {
      try {
        const [qres, spotArr] = await Promise.all([
          sb.from("option_quotes")
            .select("occ_symbol,mid,delta,underlying_price,underlying,captured_at")
            .in("occ_symbol", occs)
            .order("captured_at", { ascending: false })
            .limit(occs.length * 4),
          Promise.all(SPOT_SYMS.map(fetchSpot)),
        ]);
        const spot: Record<string, number | null> = {};
        SPOT_SYMS.forEach((s, i) => { spot[s] = spotArr[i]; });

        // newest quote per OCC (rows are captured_at-desc)
        const latest = new Map<string, QuoteRow>();
        for (const r of (qres.data ?? []) as QuoteRow[]) if (!latest.has(r.occ_symbol)) latest.set(r.occ_symbol, r);

        const out: Record<string, number> = {};
        for (const [occ, r] of latest) {
          if (r.mid == null) continue;
          let mark = Number(r.mid);
          const s = spot[r.underlying] ?? null;
          if (s != null && r.delta != null && r.underlying_price != null) {
            mark = Math.max(0, mark + Number(r.delta) * (s - Number(r.underlying_price)));
          }
          out[occ] = mark;
        }
        if (alive) setMarks(out);
      } catch {
        /* keep the last marks on a failed poll */
      }
    }

    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [occKey]);

  return marks;
}
