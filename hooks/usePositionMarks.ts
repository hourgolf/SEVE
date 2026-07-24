"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { startVisibilityPoll } from "@/lib/pollControl";
import { useAuth } from "@/hooks/useAuth";
import type { Position } from "@/lib/desk/types";
import { SUPPORTED_UNDERLYINGS } from "@/lib/desk/strategySpec";

// occ_symbol → a "live" mark for EVERY open position, BOTH tickers, independent of
// which chart/ticker is selected.
//
// BUG FIX: the old path marked positions off `useMarketData(symbol)` — the SELECTED
// ticker's chain + spot only. So when SPY was on screen, QQQ positions (and vice
// versa) had no live mark and froze on the worker's ~1-min unrealized_pnl cadence.
//
// This hook is ticker-agnostic: it pulls the latest option_quotes for exactly the
// HELD contracts (one `.in()` query, every supported ticker) + the fast /api/spot tick for
// each underlying, and marks each contract off its OWN ticker:
//   mark = mid + delta·(liveSpot − quoteUnderlying)   (floored at 0)
// — the same first-order delta estimate computeLiveMarks used, just not chart-bound.

async function fetchSpot(sym: string, accessToken: string): Promise<number | null> {
  try {
    const r = await fetch(`/api/spot?symbol=${encodeURIComponent(sym)}`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j.price === "number" ? j.price : null;
  } catch {
    return null;
  }
}

interface QuoteRow { occ_symbol: string; mid: number | null; delta: number | null; underlying_price: number | null; underlying: string }

export function usePositionMarks(positions: Position[]): Record<string, number> {
  const [marks, setMarks] = useState<Record<string, number>>({});
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  // stable dependency: the set of held OCCs (re-poll only when it changes)
  const open = positions.filter((p) => p.status === "open");
  const occKey = open.map((p) => p.occ_symbol).sort().join(",");
  // strike + type per held OCC — to SYNTHESIZE a delta when the feed omits greeks
  // (option_quotes.delta is frequently null), so the mark still tracks the live spot.
  const metaKey = open.map((p) => `${p.occ_symbol}|${p.strike}|${p.opt_type}`).sort().join(",");

  useEffect(() => {
    const occs = occKey ? occKey.split(",") : [];
    if (!occs.length) { setMarks({}); return; }
    const meta = new Map(metaKey.split(",").filter(Boolean).map((e) => { const [occ, k, t] = e.split("|"); return [occ, { strike: Number(k), optType: t }] as const; }));
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
          accessToken
            ? Promise.all(SUPPORTED_UNDERLYINGS.map((sym) => fetchSpot(sym, accessToken)))
            : Promise.resolve(SUPPORTED_UNDERLYINGS.map(() => null)),
        ]);
        const spot: Record<string, number | null> = {};
        SUPPORTED_UNDERLYINGS.forEach((s, i) => { spot[s] = spotArr[i]; });

        // newest quote per OCC (rows are captured_at-desc)
        const latest = new Map<string, QuoteRow>();
        for (const r of (qres.data ?? []) as QuoteRow[]) if (!latest.has(r.occ_symbol)) latest.set(r.occ_symbol, r);

        const out: Record<string, number> = {};
        for (const [occ, r] of latest) {
          if (r.mid == null) continue;
          let mark = Number(r.mid);
          const s = spot[r.underlying] ?? null;
          const undl = r.underlying_price != null ? Number(r.underlying_price) : null;
          // Effective delta: the feed's if present, else a 0DTE moneyness PROXY (greeks
          // are frequently null). ATM ≈ ±0.5, scaled over ~$7 of moneyness; sign by
          // call/put. Rough but the point is RESPONSIVENESS — the mark then moves with
          // the live spot every poll instead of freezing on the 1-min option tape.
          let d: number | null = r.delta != null ? Number(r.delta) : null;
          if (d == null && undl != null) {
            const m = meta.get(occ);
            if (m) {
              const ref = s ?? undl;
              const moneyIn = m.optType === "call" ? ref - m.strike : m.strike - ref;
              const mag = Math.min(0.97, Math.max(0.03, 0.5 + moneyIn / 7));
              d = m.optType === "call" ? mag : -mag;
            }
          }
          if (s != null && d != null && undl != null) mark = Math.max(0, mark + d * (s - undl));
          out[occ] = mark;
        }
        if (alive) setMarks(out);
      } catch {
        /* keep the last marks on a failed poll */
      }
    }

    poll();
    // Live position P&L is exit-critical → stays fast (4s). It's cheap: only the
    // open OCCs (~4 rows each) and only while a position is open, and it pauses in
    // a background tab — so it's not an egress risk. Marks track the live spot.
    const stop = startVisibilityPoll(poll, 4000);
    return () => { alive = false; stop(); };
  }, [occKey, metaKey, accessToken]);

  return marks;
}
