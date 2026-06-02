"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type { Position, TradeInsight } from "@/lib/desk/types";

// Lazily fetch the drill-down detail for ONE trade (the row the operator clicked) —
// the triggering acted-signal (its type + rationale features) and the exit reason
// (parsed from the EXEC exit event). Kept OUT of the always-polled desk feed (which
// only loads the last 16 signals); fetched on demand so "click to zoom in" stays cheap.
export function useTradeInsight(trade: Position | null): { insight: TradeInsight | null; loading: boolean } {
  const [insight, setInsight] = useState<TradeInsight | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trade) { setInsight(null); setLoading(false); return; }
    let alive = true;
    setLoading(true); setInsight(null);
    (async () => {
      const sb = getSupabase();
      const openedMs = Date.parse(trade.opened_at ?? trade.closed_at ?? "") || Date.now();
      const closedMs = Date.parse(trade.closed_at ?? "") || openedMs;
      // The acted entry signal carries rationale.occ = this contract; it fires the same
      // minute the position opens, so allow a +90s window. Multiple channels can trade the
      // same OCC, so over-fetch and pick this channel's nearest-before-open signal.
      const upper = new Date(openedMs + 90_000).toISOString();
      const [sigRes, evRes] = await Promise.all([
        sb.from("signals")
          .select("signal_type,direction,underlying_price,rationale,created_at,strategists(slug)")
          .filter("rationale->>occ", "eq", trade.occ_symbol)
          .eq("acted_on", true)
          .lte("created_at", upper)
          .order("created_at", { ascending: false })
          .limit(12),
        sb.from("events")
          .select("message,created_at")
          .ilike("message", `%exit ${trade.occ_symbol}%`)
          .order("created_at", { ascending: false })
          .limit(12),
      ]);
      if (!alive) return;

      // trigger: this channel's most-recent acted signal at/just-before the open
      const sigs = ((sigRes.data ?? []) as Record<string, unknown>[])
        .filter((r) => ((r.strategists as { slug?: string } | null)?.slug ?? "") === trade.strategist_slug);
      const t = sigs[0];
      const trigger = t
        ? {
            signal_type: String(t.signal_type ?? "signal"),
            direction: (t.direction as string | null) ?? null,
            underlying_price: t.underlying_price != null ? Number(t.underlying_price) : undefined,
            rationale: (t.rationale as Record<string, unknown> | null) ?? null,
            created_at: t.created_at as string,
          }
        : null;

      // exit reason: the exit event for this OCC closest to the trade's close time
      let exitReason: string | null = null;
      const evs = (evRes.data ?? []) as { message: string; created_at: string }[];
      if (evs.length) {
        const nearest = evs.reduce((best, e) =>
          Math.abs(Date.parse(e.created_at) - closedMs) < Math.abs(Date.parse(best.created_at) - closedMs) ? e : best);
        const m = /\(([^)]+)\)\s*$/.exec(nearest.message);
        exitReason = m ? m[1] : null;
      }

      setInsight({ trigger, exitReason });
      setLoading(false);
    })().catch(() => { if (alive) { setInsight({ trigger: null, exitReason: null }); setLoading(false); } });
    return () => { alive = false; };
  }, [trade?.id, trade?.occ_symbol, trade?.opened_at, trade?.closed_at, trade?.strategist_slug]);

  return { insight, loading };
}
