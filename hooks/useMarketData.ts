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
import { useAuth } from "@/hooks/useAuth";

// CHAIN (option_quotes) safety-net poll. The chain is the heavy read (200 full
// rows) and was the egress that blew the quota, so it runs slow; the bars poll +
// spot below keep the CHART live independently. Pauses while the tab is hidden.
export const POLL_INTERVAL_MS = 60000;
// Release identity changes only when the worker boots. Keep that verification
// independent from the market loop so a slow journal lookup can never delay
// chart/chain/tape updates. The bounded window keeps the leading-wildcard
// message predicate off the full append-only events history.
export const RELEASE_POLL_MS = 300000;
export const RELEASE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const OPTION_QUOTE_FIELDS = "id,occ_symbol,underlying,expiration,strike,opt_type,underlying_price,bid,ask,mid,iv,delta,gamma,captured_at";
// Closed bars change once per minute and Realtime already triggers the market
// refresh on insert. A 60s safety poll is sufficient; the live forming candle
// still tracks the 3s Alpaca spot below without Supabase egress.
const BARS_POLL_MS = 60000;
// The live chart EDGE for exit timing: /api/spot (Alpaca last trade) folds into
// the forming candle every 3s — kept fast (only pauses when the tab is hidden).
const SPOT_POLL_MS = 3000;
// History (1-min bars) loaded ONCE on mount. Six RTH sessions cover the 1W
// preset plus its prior-close anchor; longer presets use the daily rollup.
// The former 5,850-row startup transfer was unnecessary browser egress.
const HISTORY_LIMIT = 2340;
const RECENT_BARS = 60;
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
  /** Latest Day 1 startup receipt event, queried independently so a busy tape
   *  cannot evict release identity from operator surfaces. */
  releaseEvents: MarketEvent[];
  /** Health of the dedicated release-receipt query. Kept separate from the
   *  busy event-tape read so operator surfaces can distinguish CHECKING,
   *  EMPTY, and READ ERROR without making a false runtime claim. */
  releaseReceiptHealth: MarketReadHealth;
  /** Distinct expirations present in the latest pull. */
  expirations: number;
  /** Wall-clock time of the last completed poll. */
  updatedAt: string | null;
  /** Human-readable error for the banner; null when healthy. */
  error: string | null;
  /** Non-blocking source degradation; shown only in market/ops workspaces. */
  warning: string | null;
  /** Per-query diagnostics retained across recovery (no SQL or secrets). */
  readHealth: Record<MarketReadSource, MarketReadHealth>;
  /** True when the error looks like an auth / RLS / key problem. */
  isAccessError: boolean;
  /** True when ≥1 delta in the snapshot was modeled (Alpaca had none — 0DTE). */
  deltasModeled: boolean;
  /** Daily OHLCV rollup (underlying_bars_daily view) for the long-range presets
   *  (3M / 1Y / Max). ~580 rows back to early 2024; loaded once on mount. */
  dailyBars: UnderlyingBar[];
}

export type MarketReadSource = "option_chain" | "bars" | "events";
export interface MarketReadHealth {
  failureCount: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

const EMPTY_READ_HEALTH: MarketReadHealth = {
  failureCount: 0, firstFailureAt: null, lastFailureAt: null, lastSuccessAt: null, lastError: null,
};
const INITIAL_READ_HEALTH: Record<MarketReadSource, MarketReadHealth> = {
  option_chain: { ...EMPTY_READ_HEALTH }, bars: { ...EMPTY_READ_HEALTH }, events: { ...EMPTY_READ_HEALTH },
};

function markReadFailure(health: MarketReadHealth, at: string, error: string): MarketReadHealth {
  return { ...health, failureCount: health.failureCount + 1, firstFailureAt: health.firstFailureAt ?? at, lastFailureAt: at, lastError: error };
}
function markReadSuccess(health: MarketReadHealth, at: string): MarketReadHealth {
  return { ...health, lastSuccessAt: at, lastError: null };
}

const ACCESS_ERROR_RE =
  /permission denied|row-level|JWT|apikey|Invalid API key|Missing Supabase env/i;

function readErrorMessage(err: unknown): string {
  const raw = err && typeof err === "object" && "message" in err &&
    typeof (err as { message: unknown }).message === "string"
    ? (err as { message: string }).message
    : String(err ?? "");
  return raw.trim() === "" || raw === "[object Object]"
    ? "Read rejected (likely an invalid API key or missing RLS policy)."
    : raw;
}

const INITIAL: MarketData = {
  status: "live",
  spot: null,
  lastIngestTs: null,
  snapshot: [],
  bars: [],
  events: [],
  releaseEvents: [],
  releaseReceiptHealth: { ...EMPTY_READ_HEALTH },
  expirations: 0,
  updatedAt: null,
  error: null,
  warning: null,
  readHealth: INITIAL_READ_HEALTH,
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
  const { session } = useAuth();
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
    let pollInFlight = false;
    let releaseInFlight = false;
    let barsInFlight = false;
    let spotInFlight = false;
    // Switching instruments: drop the previous ticker's history + visible bars so
    // a stale SPY candle never bleeds into a QQQ poll (mergeBars keys off ts only).
    historyBars.current = [];
    setData((d) => ({ ...d, bars: [], dailyBars: [], snapshot: [], spot: null, lastIngestTs: null }));

    async function poll() {
      if (pollInFlight || !live()) return;
      pollInFlight = true;
      try {
      const sb = getSupabase();
      // These reads have different operational importance. Settling them
      // independently keeps an optional event/bar timeout from poisoning a
      // healthy options chain. The old exact COUNT scanned the whole symbol
      // partition every minute and was removed from the live path entirely.
      const [quotesSettled, barsSettled, eventsSettled] = await Promise.allSettled([
        sb.from("option_quotes").select(OPTION_QUOTE_FIELDS).eq("underlying", symbol).order("captured_at", { ascending: false }).limit(200),
        sb.from("underlying_bars").select("ts,open,high,low,close,volume,vwap").eq("symbol", symbol).order("ts", { ascending: false }).limit(RECENT_BARS),
        sb.from("events").select("id,level,strategist_id,message,meta,created_at").order("created_at", { ascending: false }).limit(14),
      ]);

      const quotesRes = quotesSettled.status === "fulfilled" ? quotesSettled.value : null;
      const barsRes = barsSettled.status === "fulfilled" ? barsSettled.value : null;
      const eventsRes = eventsSettled.status === "fulfilled" ? eventsSettled.value : null;
      const quoteError = quotesSettled.status === "rejected" ? quotesSettled.reason : quotesRes?.error;
      const barsError = barsSettled.status === "rejected" ? barsSettled.reason : barsRes?.error;
      const eventsError = eventsSettled.status === "rejected" ? eventsSettled.reason : eventsRes?.error;
      const completedAt = new Date().toISOString();
      if (quoteError) {
        const message = readErrorMessage(quoteError);
        const isAccessError = ACCESS_ERROR_RE.test(message);
        const failedAt = new Date().toISOString();
        if (!live()) return;
        setData((prev) => {
          const lastGoodFresh = prev.snapshot.length > 0 && prev.lastIngestTs != null
            && Date.now() - Date.parse(prev.lastIngestTs) <= STALE_AFTER_MIN * 60_000;
          return {
            ...prev,
            // With fresh prior evidence, retain it and expose a scoped
            // degradation instead of replacing the desk with a global banner.
            status: lastGoodFresh ? "stale" : "err",
            error: lastGoodFresh ? null : message,
            warning: lastGoodFresh ? `OPTIONS CHAIN READ DEGRADED · ${message}` : null,
            isAccessError,
            readHealth: { ...prev.readHealth, option_chain: markReadFailure(prev.readHealth.option_chain, failedAt, message) },
          };
        });
        return;
      }

      const warnings = [
        barsError ? `CHART ${readErrorMessage(barsError)}` : null,
        eventsError ? `EVENT TAPE ${readErrorMessage(eventsError)}` : null,
      ].filter((value): value is string => value != null);

      const quotes = (quotesRes?.data ?? []) as OptionQuote[];
      const recentDesc = barsError ? [] : ((barsRes?.data ?? []) as UnderlyingBar[]);
      const recent = [...recentDesc].reverse(); // oldest → newest
      const bars = recent.length ? mergeBars(historyBars.current, recent) : null;
      const events = eventsError ? null : ((eventsRes?.data ?? []) as MarketEvent[]);

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
            (bars?.length ? bars[bars.length - 1].close : null);
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
        bars: bars ?? prev.bars,
        events: events ?? prev.events,
        expirations,
        updatedAt: completedAt,
        error: null,
        warning: warnings.length ? `MARKET READ DEGRADED · ${warnings.join(" · ")}` : null,
        isAccessError: false,
        deltasModeled,
        readHealth: {
          option_chain: markReadSuccess(prev.readHealth.option_chain, completedAt),
          bars: barsError
            ? markReadFailure(prev.readHealth.bars, completedAt, readErrorMessage(barsError))
            : markReadSuccess(prev.readHealth.bars, completedAt),
          events: eventsError
            ? markReadFailure(prev.readHealth.events, completedAt, readErrorMessage(eventsError))
            : markReadSuccess(prev.readHealth.events, completedAt),
        },
      }));
      } catch (err) {
        const message = readErrorMessage(err);
        const failedAt = new Date().toISOString();
        if (!live()) return;
        setData((prev) => {
          const lastGoodFresh = prev.snapshot.length > 0 && prev.lastIngestTs != null
            && Date.now() - Date.parse(prev.lastIngestTs) <= STALE_AFTER_MIN * 60_000;
          return {
            ...prev,
            status: lastGoodFresh ? "stale" : "err",
            error: lastGoodFresh ? null : message,
            warning: lastGoodFresh ? `OPTIONS CHAIN READ DEGRADED · ${message}` : null,
            isAccessError: ACCESS_ERROR_RE.test(message),
            readHealth: {
              option_chain: markReadFailure(prev.readHealth.option_chain, failedAt, message),
              bars: markReadFailure(prev.readHealth.bars, failedAt, message),
              events: markReadFailure(prev.readHealth.events, failedAt, message),
            },
          };
        });
      } finally {
        pollInFlight = false;
      }
    }

    // Startup release identity is operational evidence, not live market data.
    // Read it on its own slow cadence and retain the last verified receipt
    // through transient failures. This prevents a journal timeout from holding
    // the option chain, chart and tape behind the same promise barrier.
    async function pollRelease() {
      if (releaseInFlight || !live()) return;
      releaseInFlight = true;
      const completedAt = new Date().toISOString();
      try {
        const cutoff = new Date(Date.now() - RELEASE_LOOKBACK_MS).toISOString();
        const result = await getSupabase()
          .from("events")
          .select("id,level,strategist_id,message,meta,created_at")
          .gte("created_at", cutoff)
          .ilike("message", "%day1-release ACTIVE%")
          .order("created_at", { ascending: false })
          .limit(1);
        if (!live()) return;
        if (result.error) {
          const message = readErrorMessage(result.error);
          setData((prev) => ({
            ...prev,
            releaseReceiptHealth: markReadFailure(prev.releaseReceiptHealth, completedAt, message),
          }));
          return;
        }
        setData((prev) => ({
          ...prev,
          releaseEvents: (result.data ?? []) as MarketEvent[],
          releaseReceiptHealth: markReadSuccess(prev.releaseReceiptHealth, completedAt),
        }));
      } catch (err) {
        if (!live()) return;
        const message = readErrorMessage(err);
        setData((prev) => ({
          ...prev,
          releaseReceiptHealth: markReadFailure(prev.releaseReceiptHealth, completedAt, message),
        }));
      } finally {
        releaseInFlight = false;
      }
    }

    // Bars-only poll for the CHART (exit-critical). Cheap and decoupled from the
    // heavy chain poll, so the closed candles stay fresh within ~10s even if the
    // realtime tick drops; the live forming candle tracks the 3s spot. mergeBars
    // keys on ts → idempotent with the chain poll's bars (whichever lands last).
    async function pollBars() {
      if (barsInFlight || !live()) return;
      barsInFlight = true;
      try {
        const sb = getSupabase();
        const barsRes = await sb
          .from("underlying_bars")
          .select("ts,open,high,low,close,volume,vwap")
          .eq("symbol", symbol)
          .order("ts", { ascending: false })
          .limit(RECENT_BARS);
        if (barsRes.error || !live()) return;
        const recent = [...((barsRes.data ?? []) as UnderlyingBar[])].reverse();
        const bars = mergeBars(historyBars.current, recent);
        setData((prev) => ({ ...prev, bars }));
      } catch {
        /* keep the last bars on a failed poll */
      } finally {
        barsInFlight = false;
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
      if (spotInFlight || !live()) return;
      spotInFlight = true;
      try {
        const res = await fetch(`/api/spot?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) return;
        const j = (await res.json()) as { price?: number | null };
        if (typeof j.price === "number" && live()) {
          fastSpotAt.current = Date.now(); // live path healthy → main poll yields
          setData((d) => ({ ...d, spot: j.price as number }));
        }
      } catch {
        /* offline / route missing — fall back to the minute spot */
      } finally {
        spotInFlight = false;
      }
    }

    poll();
    pollRelease();
    pollBars();
    loadHistory();
    loadDaily();
    pollSpot();
    // Visibility-aware polling: every loop pauses while the tab is hidden (a
    // backgrounded / after-hours tab re-reading the tape was the dominant
    // Supabase egress) and resumes with an immediate refresh. The bars + spot
    // loops stay fast (the live chart for exits); only the heavy chain is slow.
    const stopPoll = startVisibilityPoll(poll, POLL_INTERVAL_MS);
    const stopRelease = startVisibilityPoll(pollRelease, RELEASE_POLL_MS);
    const stopBars = startVisibilityPoll(pollBars, BARS_POLL_MS);
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
      stopRelease();
      stopBars();
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
  }, [symbol, session?.access_token]);

  return data;
}
