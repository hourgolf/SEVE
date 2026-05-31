"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";
import {
  modelChainGreeks,
  type ChainContract,
  type ModeledGreeks,
} from "@/lib/greeks";
import type {
  FeedStatus,
  MarketEvent,
  OptionQuote,
  UnderlyingBar,
} from "@/lib/types";

// Safety-net poll interval (ms). Realtime drives updates; this only covers
// dropped subscriptions / missed events, so it can be slow.
export const POLL_INTERVAL_MS = 10000;
// History (1-min bars) loaded ONCE on mount — ~15 trading days, so higher
// timeframes have months of candles to pan through. The repeating poll only
// pulls the recent tail and merges it in, keeping live updates cheap.
const HISTORY_LIMIT = 5850;
const RECENT_BARS = 200;
// Snapshot older than this is "stale" (market closed / cron paused).
const STALE_AFTER_MIN = 3;

// Both lists oldest→newest. The recent tail supersedes the overlapping end of
// history (so the forming bar updates) and any newer bars are appended.
function mergeBars(history: UnderlyingBar[], recent: UnderlyingBar[]): UnderlyingBar[] {
  if (!recent.length) return history;
  if (!history.length) return recent;
  const cut = recent[0].ts;
  const head = history.filter((b) => b.ts < cut);
  return [...head, ...recent];
}

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
  /** True when ≥1 delta in the snapshot was modeled (Alpaca had none — 0DTE). */
  deltasModeled: boolean;
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
  deltasModeled: false,
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
  // Deep history, loaded once; the poll merges its recent tail into this.
  const historyBars = useRef<UnderlyingBar[]>([]);

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
            .select("ts,open,high,low,close,volume,vwap")
            .order("ts", { ascending: false })
            .limit(RECENT_BARS),
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
        const recentDesc = (barsRes.data ?? []) as UnderlyingBar[];
        const recent = [...recentDesc].reverse(); // oldest → newest
        const bars = mergeBars(historyBars.current, recent);
        const events = (eventsRes.data ?? []) as MarketEvent[];

        let status: FeedStatus = "stale";
        let spot: number | null = null;
        let lastIngestTs: string | null = null;
        let snapshot: OptionQuote[] = [];
        let deltasModeled = false;

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

          // Hybrid greeks: Alpaca's real greeks always win. Only rows where
          // delta is null (0DTE, which Alpaca suppresses) get modeled — and
          // we model per expiration so each strike shares one IV across legs.
          if (spot != null && spot > 0) {
            const needsModel = snapshot.filter(
              (r) => r.delta == null && r.mid != null
            );
            const byExp = new Map<string, ChainContract[]>();
            for (const r of needsModel) {
              const list = byExp.get(r.expiration) ?? [];
              list.push({
                key: r.id,
                type: r.opt_type,
                strike: r.strike,
                mid: r.mid,
              });
              byExp.set(r.expiration, list);
            }
            const modeled = new Map<string, ModeledGreeks>();
            for (const [exp, list] of byExp) {
              const m = modelChainGreeks(list, spot, exp, lastIngestTs!);
              for (const [k, v] of m) modeled.set(k, v);
            }
            if (modeled.size > 0) {
              deltasModeled = true;
              snapshot = snapshot.map((r) => {
                const g = modeled.get(r.id);
                if (!g) return r;
                return {
                  ...r,
                  delta: g.delta,
                  iv: r.iv ?? g.iv,
                  gamma: r.gamma ?? g.gamma,
                  theta: r.theta ?? g.theta,
                  vega: r.vega ?? g.vega,
                };
              });
            }
          }
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
          deltasModeled,
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

    // One-time deep history; on success re-poll so the chart gets the full
    // range. PostgREST caps a single request at ~1000 rows, so page with
    // .range() (in parallel) to reach HISTORY_LIMIT. Silent poll-only fallback.
    async function loadHistory() {
      try {
        const sb = getSupabase();
        const PAGE = 1000;
        const ranges: [number, number][] = [];
        for (let from = 0; from < HISTORY_LIMIT; from += PAGE) {
          ranges.push([from, Math.min(from + PAGE, HISTORY_LIMIT) - 1]);
        }
        const pages = await Promise.all(
          ranges.map(([from, to]) =>
            sb
              .from("underlying_bars")
              .select("ts,open,high,low,close,volume,vwap")
              .order("ts", { ascending: false })
              .range(from, to)
          )
        );
        const desc = pages.flatMap((p) => (p.data ?? []) as UnderlyingBar[]);
        if (!desc.length) return;
        historyBars.current = desc.reverse(); // desc pages → oldest→newest
        if (mounted.current) poll();
      } catch {
        /* poll-only */
      }
    }

    poll();
    loadHistory();
    const id = setInterval(poll, POLL_INTERVAL_MS);

    // Realtime: refetch (debounced) the instant new rows land, instead of
    // waiting up to POLL_INTERVAL_MS. The poll above remains the safety net if
    // the subscription never connects (publication not enabled) or drops.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        poll();
      }, 250);
    };
    let channel: RealtimeChannel | null = null;
    try {
      const sb = getSupabase();
      channel = sb
        .channel("monitor-feed")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "underlying_bars" }, trigger)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "option_quotes" }, trigger)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, trigger)
        .subscribe();
    } catch {
      /* env missing — poll-only */
    }

    return () => {
      mounted.current = false;
      clearInterval(id);
      if (debounce) clearTimeout(debounce);
      if (channel) {
        try {
          getSupabase().removeChannel(channel);
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return data;
}
