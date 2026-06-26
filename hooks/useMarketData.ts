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
import { startVisibilityPoll, isHidden } from "@/lib/pollControl";

// Safety-net poll interval (ms). The cheap underlying_bars realtime tick (one
// row/min) drives fresh updates; this only covers dropped subscriptions, so it
// runs slow — and pauses while the tab is hidden — to keep egress low.
export const POLL_INTERVAL_MS = 60000;
// The Supabase tape only refreshes once a minute (the ingest cadence), so the
// spot LED gets a faster live tick from /api/spot (Alpaca IEX last trade).
const SPOT_POLL_MS = 3000;
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
  /** Daily OHLCV rollup (underlying_bars_daily view) for the long-range presets
   *  (3M / 1Y / Max). ~580 rows back to early 2024; loaded once on mount. */
  dailyBars: UnderlyingBar[];
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
  dailyBars: [],
};

/**
 * Single source of truth for the live feed. v1 polls every 5s; the whole
 * fetch lives here so a later phase can swap it for Supabase realtime
 * subscriptions without touching the panels.
 *
 * `symbol` (QQQ rollout, step 4) scopes EVERY read to one instrument —
 * underlying_bars / option_quotes / the daily rollup / the /api/spot tick all
 * filter to it. Since market-ingest now writes SPY *and* QQQ into the same
 * tables, an unfiltered read would interleave both tickers; this keeps the §01
 * market context to the selected one. Changing `symbol` re-runs the effect
 * (fresh fetch + subscription) and clears the prior ticker's bars so they never
 * mix on the chart.
 */
export function useMarketData(symbol: string = "SPY"): MarketData {
  const [data, setData] = useState<MarketData>(INITIAL);
  // Avoid setState after unmount when a slow poll resolves late.
  const mounted = useRef(true);
  // Deep intraday history (1-min bars), loaded once; the poll merges its recent
  // tail into this. Serves the short-range presets (1D / 1W).
  const historyBars = useRef<UnderlyingBar[]>([]);
  // When the fast /api/spot tick last delivered a live trade price. The main
  // poll's spot (minute-ingest underlying_price — up to ~60s stale) must NOT
  // overwrite a healthy live tick: doing so made the displayed price snap
  // BACKWARDS 30-50¢ every poll cycle on a moving tape (live tick forward,
  // minute snapshot back). Main-poll spot is the FALLBACK, used only when the
  // fast path has been quiet for >15s.
  const fastSpotAt = useRef(0);

  useEffect(() => {
    mounted.current = true;
    // PER-EFFECT cancellation: `mounted` (a shared ref) can't distinguish "unmounted"
    // from "symbol changed" — on a SPY↔QQQ toggle the cleanup runs then the new effect
    // sets mounted.current=true again, so an in-flight request from the OLD symbol would
    // still pass the `mounted` guard and write its bars/spot into the NEW symbol's chart
    // (the phantom candle). This local flag is captured per effect run; the old effect's
    // cleanup sets ITS cancelled=true, so its late responses are dropped.
    let cancelled = false;
    const live = () => mounted.current && !cancelled;
    // Switching instruments: drop the previous ticker's history + visible bars so
    // a stale SPY candle never bleeds into a QQQ poll (mergeBars keys off ts only).
    historyBars.current = [];
    setData((d) => ({ ...d, bars: [], dailyBars: [], snapshot: [], spot: null, lastIngestTs: null }));

    async function poll() {
      try {
        const sb = getSupabase();
        const [countRes, quotesRes, barsRes, eventsRes] = await Promise.all([
          sb.from("option_quotes").select("*", { count: "exact", head: true }).eq("underlying", symbol),
          sb
            .from("option_quotes")
            .select("*")
            .eq("underlying", symbol)
            .order("captured_at", { ascending: false })
            .limit(200),
          sb
            .from("underlying_bars")
            .select("ts,open,high,low,close,volume,vwap")
            .eq("symbol", symbol)
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

        if (!live()) return;
        setData((prev) => ({
          ...prev,
          status,
          // Live-tick precedence: keep the fast /api/spot price while that path
          // is healthy; the minute-derived spot only fills in when it's not.
          spot: Date.now() - fastSpotAt.current < 15_000 && prev.spot != null ? prev.spot : spot,
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
        }));
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
        if (!live()) return;
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
              .eq("symbol", symbol)
              .order("ts", { ascending: false })
              .range(from, to)
          )
        );
        const desc = pages.flatMap((p) => (p.data ?? []) as UnderlyingBar[]);
        if (!desc.length) return;
        historyBars.current = desc.reverse(); // desc pages → oldest→newest
        if (live()) poll();
      } catch {
        /* poll-only */
      }
    }

    // Daily OHLCV rollup for the long-range presets — one cheap read (~580 rows,
    // under the PostgREST cap). Silent fallback: long ranges just stay empty.
    async function loadDaily() {
      try {
        const sb = getSupabase();
        const { data: rows } = await sb
          .from("underlying_bars_daily")
          .select("ts,open,high,low,close,volume,vwap")
          .eq("symbol", symbol)
          .order("ts", { ascending: true });
        const daily = (rows ?? []) as UnderlyingBar[];
        if (daily.length && live()) {
          setData((d) => ({ ...d, dailyBars: daily }));
        }
      } catch {
        /* view missing / not granted — long ranges simply show nothing */
      }
    }

    // Fast live-spot tick: overrides the displayed spot between minute snapshots
    // so the LED moves like a real ticker. No-ops (keeps the 1/min spot) if the
    // route returns null — e.g. Alpaca keys not set in the deploy env.
    async function pollSpot() {
      try {
        const res = await fetch(`/api/spot?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { price?: number | null };
        if (typeof j.price === "number" && live()) {
          fastSpotAt.current = Date.now(); // live path healthy → main poll yields
          setData((d) => ({ ...d, spot: j.price as number }));
        }
      } catch {
        /* offline / route missing — fall back to the minute spot */
      }
    }

    poll();
    loadHistory();
    loadDaily();
    pollSpot();
    // Visibility-aware polling: both loops pause while the tab is hidden (a
    // backgrounded / after-hours tab re-reading the 1-min tape every few seconds
    // was the dominant Supabase egress) and resume with an immediate refresh.
    const stopPoll = startVisibilityPoll(poll, POLL_INTERVAL_MS);
    const stopSpot = startVisibilityPoll(pollSpot, SPOT_POLL_MS);

    // Realtime: a CHEAP minute-tick trigger. Subscribe ONLY to underlying_bars
    // (~1 row/min/symbol) — NOT option_quotes, whose hundreds-of-rows/min fan-out
    // was the egress that blew the quota. A new bar = a new minute of tape, so
    // refetch the chain then; the poll above is the safety net. Skipped while
    // hidden (the websocket keeps firing even when the interval is paused).
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce || isHidden()) return;
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
        .subscribe();
    } catch {
      /* env missing — poll-only */
    }

    return () => {
      mounted.current = false;
      cancelled = true; // drop any in-flight responses from THIS (old-symbol) effect
      stopPoll();
      stopSpot();
      if (debounce) clearTimeout(debounce);
      if (channel) {
        try {
          getSupabase().removeChannel(channel);
        } catch {
          /* ignore */
        }
      }
    };
  }, [symbol]);

  return data;
}
