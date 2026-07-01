"use client";

// Feeds the TODAY readiness strip: each traded underlying's current-session gap
// (via the desk_today_gaps RPC — RTH open vs prior RTH close, server-side) + the
// FOMC event calendar (from engine/market-events, one source of truth). Read-only.

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { eventsOn, upcomingEvents } from "@/engine/market-events";

export interface SymbolGap {
  symbol: string;
  sessionDate: string; // YYYY-MM-DD (ET) of the session this gap is for
  gapPct: number | null; // (first RTH open − prior RTH close) / prior close · 100; null = no prior session yet

  barsToday: number;
  latestBar: string | null; // ISO
}

export interface TodayReadiness {
  gaps: Record<string, SymbolGap>; // by UPPERCASE symbol
  todayET: string;
  todayEvent: { label: string } | null; // an event scheduled today
  nextEvent: { date: string; kind: string } | null; // the next future event
  loading: boolean;
}

// YYYY-MM-DD in America/New_York (the desk's session calendar).
function etDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function useTodayReadiness(pollMs = 120_000): TodayReadiness {
  const [gaps, setGaps] = useState<Record<string, SymbolGap>>({});
  const [loading, setLoading] = useState(true);
  const todayET = etDate();

  const load = useCallback(async () => {
    try {
      const { data, error } = await getSupabase().rpc("desk_today_gaps");
      if (!error && Array.isArray(data)) {
        const m: Record<string, SymbolGap> = {};
        for (const r of data as Record<string, unknown>[]) {
          const sym = String(r.symbol).toUpperCase();
          m[sym] = {
            symbol: sym,
            sessionDate: String(r.session_date).slice(0, 10),
            gapPct: r.gap_pct == null ? null : Number(r.gap_pct),
            barsToday: Number(r.bars_today),
            latestBar: r.latest_bar ? String(r.latest_bar) : null,
          };
        }
        setGaps(m);
      }
    } catch {
      /* keep last-known on a transient failure */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, pollMs);
    return () => window.clearInterval(t);
  }, [load, pollMs]);

  const todays = eventsOn(todayET);
  const todayEvent = todays.length ? { label: todays[0].label } : null;
  const future = upcomingEvents(todayET, 250)
    .filter((e) => e.date > todayET)
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextEvent = future.length ? { date: future[0].date, kind: future[0].kind } : null;

  return { gaps, todayET, todayEvent, nextEvent, loading };
}
