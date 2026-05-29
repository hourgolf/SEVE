"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";
import type {
  FeedStatus,
  MarketEvent,
  OptionQuote,
  UnderlyingBar,
} from "@/lib/types";

// How often we poll (ms) — mirrors the reference HTML's 5s refresh.
export const POLL_INTERVAL_MS = 5000;
// Snapshot older than this is "stale" (market closed / cron paused).
const STALE_AFTER_MIN = 3;

export interface MarketData {
  status: FeedStatus;
  /** Spot price for the topbar; null until first successful read. */
  spot: number | null;
  /** ISO time of the most recent option_quotes snapshot. */
  lastIngestTs: string | null;
  /** All contracts in the most recent snapshot (one capture timestamp). */
  snapshot: OptionQuote[];
  /** Last ~60 minute bars, oldest → newest (ready for the sparkline). */
  bars: UnderlyingBar[];
  /** Latest ~14 system events, newest first. */
  events: MarketEvent[];
  /** Total rows in option_quotes. */
  rowCount: number;
  /** Distinct expirations present in the latest pull. */
  expirations: number;
  /** Wall-clock time of the last completed poll. */
  updatedAt: string | null;
  /** Human-readable error for the banner; null when healthy. */
  error: string | null;
  /** True when the error looks like an auth / RLS / key problem. */
  isAccessError: boolean;
}

const ACCESS_ERROR_RE =
  /permission denied|row-level|JWT|apikey|Invalid API key|Missing Supabase env/i;

const INITIAL: MarketData = {
  status: "live",
  spot: null,
  lastIngestTs: null,
  snapshot: [],
  bars: [],
  events: [],
  rowCount: 0,
  expirations: 0,
  updatedAt: null,
  error: null,
  isAccessError: false,
};

/**
 * Single source of truth for the live feed. v1 polls every 5s; the whole
 * fetch lives here so a later phase can swap it for Supabase realtime
 * subscriptions without touching the panels.
 */
export function useMarketData(): MarketData {
  const [data, setData] = useState<MarketData>(INITIAL);
  // Avoid setState after unmount when a slow poll resolves late.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    async function poll() {
      try {
        const sb = getSupabase();
        const [countRes, quotesRes, barsRes, eventsRes] = await Promise.all([
          sb.from("option_quotes").select("*", { count: "exact", head: true }),
          sb
            .from("option_quotes")
            .select("*")
            .order("captured_at", { ascending: false })
            .limit(200),
          sb
            .from("underlying_bars")
            .select("ts,close")
            .order("ts", { ascending: false })
            .limit(60),
          sb
            .from("events")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(14),
        ]);

        // A failing HEAD count request comes back with an empty message, so
        // prefer whichever error actually carries text for the banner.
        const readError = quotesRes.error ?? countRes.error;
        if (readError) throw readError;

        const quotes = (quotesRes.data ?? []) as OptionQuote[];
        const barsDesc = (barsRes.data ?? []) as UnderlyingBar[];
        const bars = [...barsDesc].reverse(); // oldest → newest for the chart
        const events = (eventsRes.data ?? []) as MarketEvent[];

        let status: FeedStatus = "stale";
        let spot: number | null = null;
        let lastIngestTs: string | null = null;
        let snapshot: OptionQuote[] = [];

        if (quotes.length) {
          lastIngestTs = quotes[0].captured_at;
          snapshot = quotes.filter((r) => r.captured_at === lastIngestTs);
          const head = snapshot[0];
          spot =
            head?.underlying_price ??
            (bars.length ? bars[bars.length - 1].close : null);
          const ageMin =
            (Date.now() - new Date(lastIngestTs).getTime()) / 60000;
          status = ageMin > STALE_AFTER_MIN ? "stale" : "live";
        }

        const expirations = new Set(quotes.map((r) => r.expiration)).size;

        if (!mounted.current) return;
        setData({
          status,
          spot,
          lastIngestTs,
          snapshot,
          bars,
          events,
          rowCount: countRes.count ?? 0,
          expirations,
          updatedAt: new Date().toISOString(),
          error: null,
          isAccessError: false,
        });
      } catch (err) {
        // Supabase/PostgREST errors are plain objects with a `.message`, not
        // Error instances — mirror the reference's `e.message || String(e)`.
        const rawMessage =
          (err &&
            typeof err === "object" &&
            "message" in err &&
            typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : null) ?? String(err);
        // Empty/unhelpful errors on a failed read are almost always an auth/RLS
        // problem (e.g. a 401 HEAD request returns no body) — surface that.
        const isAccessError =
          rawMessage.trim() === "" ||
          rawMessage === "[object Object]" ||
          ACCESS_ERROR_RE.test(rawMessage);
        const message =
          rawMessage.trim() === "" || rawMessage === "[object Object]"
            ? "Read rejected (likely an invalid API key or missing RLS policy)."
            : rawMessage;
        if (!mounted.current) return;
        setData((prev) => ({
          ...prev,
          status: "err",
          error: message,
          isAccessError,
        }));
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, []);

  return data;
}
