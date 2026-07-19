// ============================================================================
//  Real-options chain provider for the backtest.
//  Reads backfilled option_bars (real per-minute trade prices) and serves a
//  chain at any minute: mid = the real last-trade price (forward-filled), with
//  a MODELED spread around it (Alpaca's free plan gives no historical bid/ask).
//  So fills use real option price LEVELS — only the spread is assumed.
// ============================================================================

import { readFileSync } from "node:fs";
import type { OptType, Quote } from "./types";
import { createServerSupabaseClient } from "../scripts/serverSupabase";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}

const SPREAD_FRAC = 0.03; // modeled bid/ask = mid ± 1.5% (until real quotes exist)

// ── transient-load retry + completeness invariant (2026-07-06) ───────────────
// Under the nightly capture chain's DB load a page read can die server-side
// ("canceling statement due to statement timeout"). That single lost page used to
// surface as a THROW that backtest.ts caught and silently replaced with modeled
// chains — the power/07-02 closed-day flicker (−144.96 real vs −487.31 modeled,
// same 2 trades). So: (a) every page retries with backoff before giving up, and
// (b) each day's fetched row count is checked against the server's own count —
// any shortfall mechanism that does NOT error (row cap, dropped page) throws too.
// A partial tape must never sim as if it were the real one.
const PAGE_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// query is a FACTORY (a fresh builder per attempt — supabase builders are single-use).
async function withRetry<R extends { error: { message: string } | null }>(label: string, query: () => PromiseLike<R>): Promise<R> {
  let lastMsg = "";
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(500 * 3 ** (attempt - 2)); // 0.5s → 1.5s → 4.5s
    try {
      const res = await query();
      if (!res.error) return res;
      lastMsg = res.error.message;
    } catch (e) {
      lastMsg = (e as Error).message; // fetch-level (network) rejection
    }
  }
  throw new Error(`${label}: ${lastMsg} (after ${PAGE_ATTEMPTS} attempts)`);
}

export type ChainProvider = (spot: number, minutesToClose: number, tsMs: number) => Quote[];

interface Series {
  strike: number;
  optType: OptType;
  ts: number[]; // sorted ascending (epoch ms)
  close: number[];
}

// largest close at or before tsMs (forward-fill); null if none yet.
function lastAtOrBefore(s: Series, tsMs: number): number | null {
  let lo = 0;
  let hi = s.ts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.ts[mid] <= tsMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? s.close[ans] : null;
}

interface RawOB {
  occ_symbol: string;
  ts: string;
  strike: number;
  opt_type: OptType;
  close: number | null;
  expiration: string;
}

// Load option_bars grouped by expiration date (= the 0DTE session), fetching
// PER DAY (filtered by the indexed `expiration`) — offset-paging the whole
// 1M+ row table times out, but a single day (~11k rows, small offsets) is fast.
export async function loadOptionBarsByDay(dates: string[], underlying = "SPY"): Promise<Map<string, Series[]>> {
  loadEnv();
  const sb = createServerSupabaseClient("engine option-bars source");

  const PAGE = 1000;
  const out = new Map<string, Series[]>();
  // option_bars has no `underlying` column, but the OCC root IS the ticker, so a
  // prefix match isolates one instrument's contracts. Without it, once QQQ bars are
  // backfilled a SPY and QQQ contract at the same strike/expiry would both land in
  // the chain (the chain keys on strike, not ticker) and cross-contaminate fills.
  const occPrefix = `${underlying}%`;

  for (const date of dates) {
    const contracts = new Map<string, Series>();
    // completeness invariant: the server's own count is the floor the scan must reach
    // (rows only ever ARRIVE mid-scan — same-day deletes don't happen — so fetched < count
    // means pages were silently lost, not that the table moved).
    const { count } = await withRetry(`option_bars count ${date}`, () =>
      sb.from("option_bars").select("occ_symbol", { count: "exact", head: true }).eq("expiration", date).like("occ_symbol", occPrefix));
    const expected = count ?? 0;
    let fetched = 0;
    if (expected > 0) for (let from = 0; ; from += PAGE) {
      const { data } = await withRetry(`option_bars page ${date}@${from}`, () =>
        sb.from("option_bars")
          .select("occ_symbol,ts,strike,opt_type,close,expiration")
          .eq("expiration", date)
          .like("occ_symbol", occPrefix)
          // ts alone is not unique (every contract bars the same minute) — without the
          // occ_symbol tie-break, offset pages can shuffle ties across the boundary and
          // silently drop/duplicate rows even on an idle table.
          .order("ts", { ascending: true })
          .order("occ_symbol", { ascending: true })
          .range(from, from + PAGE - 1));
      const rows = (data ?? []) as RawOB[];
      fetched += rows.length;
      for (const r of rows) {
        if (r.close == null) continue;
        let s = contracts.get(r.occ_symbol);
        if (!s) {
          s = { strike: Number(r.strike), optType: r.opt_type, ts: [], close: [] };
          contracts.set(r.occ_symbol, s);
        }
        s.ts.push(Date.parse(r.ts));
        s.close.push(Number(r.close));
      }
      if (rows.length < PAGE) break;
    }
    if (fetched < expected)
      throw new Error(`option_bars ${date}: fetched ${fetched}/${expected} rows — partial series (DB under load?); refusing to serve a truncated tape`);
    if (contracts.size) out.set(date, [...contracts.values()]);
  }
  return out;
}

// Build a chain provider from one day's contract series.
export function makeRealChain(contracts: Series[]): ChainProvider {
  return (_spot, _mtc, tsMs) => {
    const quotes: Quote[] = [];
    for (const c of contracts) {
      const close = lastAtOrBefore(c, tsMs);
      if (close == null) continue;
      const mid = Math.max(0.01, close);
      const spread = Math.max(0.02, mid * SPREAD_FRAC);
      quotes.push({
        strike: c.strike,
        optType: c.optType,
        bid: Math.max(0, mid - spread / 2),
        ask: mid + spread / 2,
        mid,
      });
    }
    return quotes;
  };
}

// ── option_quotes source (the SAME-WEEK real-NBBO chain) ────────────────────
// option_bars/Databento are T+1-embargoed, so a TODAY backtest can't use them.
// option_quotes is the live NBBO the worker captured this session (real bid/ask,
// 7-day retention) — so a same-week run gets REAL fills. Used by the benched-channel
// "would-be vs live" sim (scripts/benched-sim.ts): it replays each cut channel's REAL
// strategy + exits (trail incl.) on the real chain, which ride-to-close can't.

interface QSeries { strike: number; optType: OptType; ts: number[]; bid: number[]; ask: number[]; }
const QFILL_LAG_MS = 60_000; // mirror Databento: serve the quote captured within ~1 min of the bar

function qIdxAtOrBefore(ts: number[], tsMs: number): number {
  let lo = 0, hi = ts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ts[m] <= tsMs) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

interface RawOQ { occ_symbol: string; captured_at: string; strike: number; opt_type: OptType; bid: number | null; ask: number | null; }

// Load option_quotes for each ET date's 0DTE chain (expiration = date), grouped into
// per-contract bid/ask series. underlying filters the ticker (option_quotes HAS the column,
// unlike option_bars). Same per-day keyset paging as loadOptionBarsByDay.
export async function loadOptionQuotesByDay(dates: string[], underlying = "SPY"): Promise<Map<string, QSeries[]>> {
  loadEnv();
  const sb = createServerSupabaseClient("engine option-quotes source");

  const PAGE = 1000;
  const out = new Map<string, QSeries[]>();
  for (const date of dates) {
    const contracts = new Map<string, QSeries>();
    let lastId = "";
    // completeness invariant (see withRetry): quotes only INSERT intraday, and retention
    // prunes whole >7d days — a same-week day's rows never vanish mid-scan, so any
    // fetched-below-count is a silent shortfall, not churn.
    const { count } = await withRetry(`option_quotes count ${date}`, () =>
      sb.from("option_quotes").select("id", { count: "exact", head: true }).eq("expiration", date).eq("underlying", underlying));
    const expected = count ?? 0;
    let fetched = 0;
    // keyset-paginate on id (OFFSET paging this table times out — the W3 export learned this)
    if (expected > 0) for (;;) {
      const { data } = await withRetry(`option_quotes page ${date} after ${lastId || "start"}`, () => {
        let q = sb.from("option_quotes")
          .select("id,occ_symbol,captured_at,strike,opt_type,bid,ask")
          .eq("expiration", date).eq("underlying", underlying)
          .order("id", { ascending: true }).limit(PAGE);
        if (lastId) q = q.gt("id", lastId);
        return q;
      });
      const rows = (data ?? []) as Array<RawOQ & { id: string }>;
      fetched += rows.length;
      for (const r of rows) {
        if (r.bid == null || r.ask == null) continue;
        let s = contracts.get(r.occ_symbol);
        if (!s) { s = { strike: Number(r.strike), optType: r.opt_type, ts: [], bid: [], ask: [] }; contracts.set(r.occ_symbol, s); }
        s.ts.push(Date.parse(r.captured_at));
        s.bid.push(Number(r.bid));
        s.ask.push(Number(r.ask));
      }
      if (rows.length < PAGE) break;
      lastId = rows[rows.length - 1].id;
    }
    if (fetched < expected)
      throw new Error(`option_quotes ${date}: fetched ${fetched}/${expected} rows — partial tape (DB under load?); refusing to sim on it`);
    // keyset order is by id, not time → sort each series by ts so the binary search holds
    for (const s of contracts.values()) {
      const ord = s.ts.map((_, i) => i).sort((a, b) => s.ts[a] - s.ts[b]);
      s.ts = ord.map((i) => s.ts[i]); s.bid = ord.map((i) => s.bid[i]); s.ask = ord.map((i) => s.ask[i]);
    }
    if (contracts.size) out.set(date, [...contracts.values()]);
  }
  return out;
}

// Chain provider from one day's option_quotes series — real bid/ask, crossed like Databento
// (no modeled spread). Forward-fill with a 3-min staleness guard (a strike that drifts off
// the captured NTM chain stops quoting; don't serve a stale mark).
export function makeQuotesChain(contracts: QSeries[]): ChainProvider {
  return (_spot, _mtc, tsMs) => {
    const at = tsMs + QFILL_LAG_MS;
    const quotes: Quote[] = [];
    for (const c of contracts) {
      const i = qIdxAtOrBefore(c.ts, at);
      if (i < 0) continue;
      if (at - c.ts[i] > 180_000) continue; // stale forward-fill guard
      const bid = c.bid[i], ask = c.ask[i];
      if (!(ask > 0) || ask < bid) continue;
      quotes.push({ strike: c.strike, optType: c.optType, bid, ask, mid: (bid + ask) / 2 });
    }
    return quotes;
  };
}
