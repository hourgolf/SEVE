// ============================================================================
//  Alpaca REST — account/positions/orders (paper host) + bar backfill & option
//  chain snapshot (data host). Mirrors the cron worker's REST surface; the
//  websocket bar stream lives in stream.ts. Bars are mapped to the engine's Bar.
// ============================================================================

import { config } from "./config.js";
import type { Bar, OptType } from "../../engine/types";
import {
  normalizeTargetedOptionSnapshots,
  targetedOptionBatches,
  type TargetedOptionQuote,
} from "./managerShadowQuoteModel.js";

// ---- per-account routing (cockpit P3) --------------------------------------
// An Api bundles ONE Alpaca paper account's creds + host. Paper-host calls
// (account/positions/orders/fills) take an `api` (default = account 1) so every
// pre-cockpit call site stays byte-identical, and the multi-account cycle passes
// each bucket's own Api. DATA-host calls (bars/chain) ALWAYS use account 1 — the
// sip/opra data subscription lives on that account; the other paper accounts have
// only the free feed, so market data must route through account 1's creds.
export interface Api { paperHost: string; headers: Record<string, string>; }
const credHeaders = (key: string, secret: string): Record<string, string> => ({
  "APCA-API-KEY-ID": key,
  "APCA-API-SECRET-KEY": secret,
  accept: "application/json",
});
/** Account 1 — the existing paper account; the default for every legacy call site. */
export const ACCT1_API: Api = { paperHost: config.alpacaPaperHost, headers: credHeaders(config.alpacaKey, config.alpacaSecret) };
/** Build an Api for another paper account (cred pair from config.altAccounts). */
export function makeApi(key: string, secret: string, paperHost = config.alpacaPaperHost): Api {
  return { paperHost, headers: credHeaders(key, secret) };
}
// Data host always rides account 1's creds (it holds the data subscription).
const DATA_HEADERS = credHeaders(config.alpacaKey, config.alpacaSecret);

// BOUNDED fetches (audit 2026-07-11, 1b #8): every Alpaca REST call carries a hard
// 15s abort — a hung socket used to hold whichever loop awaited it FOREVER (with the
// old shared `cycling` mutex that meant EVERY safety backstop was dead until a
// restart). 15s ≫ any healthy call; the abort surfaces as a clear timeout error the
// call sites already catch (skip-bucket / retry / journal — never a crash).
const FETCH_TIMEOUT_MS = 15_000;
const asTimeoutErr = (verb: string, path: string, e: unknown): Error =>
  e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
    ? new Error(`timeout ${FETCH_TIMEOUT_MS / 1000}s ${verb} ${path.split("?")[0]}`)
    : (e as Error);

async function get(host: string, path: string, headers: Record<string, string>): Promise<any> {
  let ok: boolean, status: number, body: string;
  try {
    const r = await fetch(host + path, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    ok = r.ok; status = r.status;
    body = await r.text(); // the body read shares the signal — a stalled stream aborts too
  } catch (e) { throw asTimeoutErr("GET", path, e); }
  if (!ok) throw new Error(`${status} GET ${path.split("?")[0]} → ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}

async function post(host: string, path: string, payload: unknown, headers: Record<string, string>): Promise<any> {
  let ok: boolean, status: number, body: string;
  try {
    const r = await fetch(host + path, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    ok = r.ok; status = r.status;
    body = await r.text();
  } catch (e) { throw asTimeoutErr("POST", path, e); }
  if (!ok) throw new Error(`${status} POST ${path.split("?")[0]} → ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}

async function del(host: string, path: string, headers: Record<string, string>): Promise<void> {
  let r: Response;
  try { r = await fetch(host + path, { method: "DELETE", headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }); }
  catch (e) { throw asTimeoutErr("DELETE", path, e); }
  if (!r.ok) throw new Error(`${r.status} DELETE ${path.split("?")[0]}`);
}

// ---- paper account / positions / orders ------------------------------------
export interface AlpacaAccount { equity: number; cash: number; }
export interface AlpacaPosition { symbol: string; qty: number; avg_entry_price: number; current_price: number; unrealized_pl: number; }

export async function getAccount(api: Api = ACCT1_API): Promise<AlpacaAccount> {
  const a = await get(api.paperHost, "/v2/account", api.headers);
  return { equity: Number(a.equity), cash: Number(a.cash) };
}
export async function getPositions(api: Api = ACCT1_API): Promise<AlpacaPosition[]> {
  const ps = await get(api.paperHost, "/v2/positions", api.headers);
  return (ps as any[]).map((p) => ({
    symbol: String(p.symbol),
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price),
    current_price: Number(p.current_price),
    unrealized_pl: Number(p.unrealized_pl),
  }));
}
export interface MarketClock { is_open: boolean; next_open: string; next_close: string; timestamp: string; }
export async function getClock(api: Api = ACCT1_API): Promise<MarketClock> {
  return get(api.paperHost, "/v2/clock", api.headers);
}

// ---- orders (Phase B execution) ---------------------------------------------
export interface AlpacaOrder {
  id: string; client_order_id: string; symbol: string; side: string; status: string;
  filled_qty: number; filled_avg_price: number;
}
const mapOrder = (o: any): AlpacaOrder => ({
  id: String(o.id ?? ""),
  client_order_id: String(o.client_order_id ?? ""),
  symbol: String(o.symbol ?? ""),
  side: String(o.side ?? ""),
  status: String(o.status ?? ""),
  filled_qty: Number(o.filled_qty ?? 0),
  filled_avg_price: Number(o.filled_avg_price ?? 0),
});

/** Recent orders, newest first — the per-channel ledger source (client_order_id
 *  prefixes). Mirrors the cron's cycle-start snapshot. `afterIso` date-scopes the
 *  window (audit L3): without it, a >500-order stretch ages SAME-DAY buys out of
 *  the snapshot and degrades the pyramid lot reconstruction + the order-tag
 *  cross-check. Callers pass ~2 days back (covers prior-session 1DTE buys). */
export async function getOrders(limit = 500, api: Api = ACCT1_API, afterIso?: string): Promise<AlpacaOrder[]> {
  const after = afterIso ? `&after=${encodeURIComponent(afterIso)}` : "";
  const res = await get(api.paperHost, `/v2/orders?status=all&limit=${limit}&direction=desc${after}`, api.headers);
  return (res as any[]).map(mapOrder);
}

/** Terminal order states — filled_qty is FINAL once one of these is reached. */
export const TERMINAL_ORDER_STATUS = new Set(["filled", "canceled", "expired", "rejected", "done_for_day", "stopped", "replaced"]);

/** Place an order, then poll for the ACTUAL fill (market orders fill in ms).
 *  Booking at the real fill — not the mid — is what makes the desk's P&L
 *  reconcile to the account (cron parity: aOrderAndFill). fill=0 → caller falls
 *  back to the quote.
 *  2026-06-11a PARTIAL-FILL FIX (cron parity): the old loop exited on the FIRST
 *  filled_avg_price>0 — a `partially_filled` snapshot satisfies that with
 *  filled_qty below the requested qty, so the desk row under-recorded and the
 *  remainder rode UNMANAGED (the 06-11 incident). Now: poll to a TERMINAL status;
 *  still working after ~3s → CANCEL the remainder, then read until terminal —
 *  the returned filledQty is FINAL, nothing can fill after the desk books. */
export async function orderAndFill(body: {
  symbol: string; qty: string; side: "buy" | "sell"; type: "market"; time_in_force: "day"; client_order_id: string;
}, api: Api = ACCT1_API): Promise<{ id: string; fill: number; filledQty: number; status: string }> {
  const o = await post(api.paperHost, "/v2/orders", body, api.headers);
  const id = String(o.id ?? "");
  let status = String(o.status ?? "");
  let fill = Number(o.filled_avg_price ?? 0);
  let filledQty = Number(o.filled_qty ?? 0);
  for (let i = 0; i < 13 && id && !TERMINAL_ORDER_STATUS.has(status); i++) {
    if (i === 10) { try { await del(api.paperHost, `/v2/orders/${id}`, api.headers); } catch { /* may have just gone terminal — the reads below settle it */ } }
    await new Promise((r) => setTimeout(r, 300));
    try {
      const g = await get(api.paperHost, `/v2/orders/${id}`, api.headers);
      status = String(g.status ?? status);
      if (Number(g.filled_avg_price) > 0) fill = Number(g.filled_avg_price);
      filledQty = Number(g.filled_qty ?? filledQty);
    } catch { /* keep polling */ }
  }
  return { id, fill, filledQty, status };
}

const TICK = 0.01;
export interface LadderParams { frac: number; rungs: number; rungSec: number; }

/** SPREAD-CAPTURE LADDER (A2). Place a limit between mid and the cross, poll briefly,
 *  cancel + re-price toward the cross across `rungs`, with the FINAL rung a MARKET
 *  backstop so the order ALWAYS completes (never worse than today's plain market
 *  order — the trade can't fail to fill). Returns the real weighted fill + the $
 *  actually CAPTURED vs the live cross reference (ask for a buy, bid for a sell) —
 *  the real-capture measurement the shadow-first discipline needs. A drop-in
 *  superset of orderAndFill's return.
 *
 *  ⚠ This NEVER touches the cost gate (decide.ts computes round-trip at the CROSS
 *  price, independent of how a fill executes) — capturing spread therefore can't
 *  loosen the gate to admit marginal trades (the A1 gate-decoupled invariant).
 *
 *  Every rung keeps the caller's coid prefix (`${slug}-${occ}-…`, suffixed `-r{i}`
 *  / `-m`) so fill-net booking, idempotency, lost-insert recovery, and the pyramid
 *  lot grouping all still see every rung. Captured-$ is signed: a collapsing-premium
 *  stop whose limits don't fill crosses via the market backstop and reports ~0 (or
 *  negative if the bid dropped during the wait) — the adverse-selection cost made
 *  visible, not hidden. */
export async function limitLadderFill(args: {
  symbol: string; side: "buy" | "sell"; qty: number; coidBase: string;
  bid: number; ask: number; ladder: LadderParams;
}, api: Api = ACCT1_API): Promise<{ id: string; fill: number; filledQty: number; status: string; capturedUsd: number; crossRef: number; crossedQty: number }> {
  const { symbol, side, qty, coidBase, bid, ask } = args;
  const rungs = Math.max(1, Math.floor(args.ladder.rungs));
  const frac = Math.max(0, Math.min(1, args.ladder.frac));
  const rungMs = Math.max(250, args.ladder.rungSec * 1000);
  const crossRef = side === "buy" ? ask : bid;
  const mid = (ask + bid) / 2;

  // Unusable NBBO (locked/crossed/zero) → don't ladder; one market order = today's path.
  if (!(ask > bid && bid > 0)) {
    const m = await orderAndFill({ symbol, qty: String(qty), side, type: "market", time_in_force: "day", client_order_id: `${coidBase}-m` }, api);
    return { ...m, capturedUsd: 0, crossRef: crossRef || m.fill, crossedQty: m.filledQty };
  }

  let remaining = qty, accQty = 0, accCost = 0, crossedQty = 0, lastId = "", status = "new";
  for (let i = 0; i < rungs && remaining > 0; i++) {
    const final = i === rungs - 1;
    try {
      if (final) {
        // guaranteed cross — the trade always completes
        const m = await orderAndFill({ symbol, qty: String(remaining), side, type: "market", time_in_force: "day", client_order_id: `${coidBase}-m` }, api);
        lastId = m.id; status = m.status;
        if (m.filledQty > 0 && m.fill > 0) { accQty += m.filledQty; accCost += m.filledQty * m.fill; crossedQty += m.filledQty; remaining -= m.filledQty; }
      } else {
        // ramp aggressiveness frac→~0.95 across the non-final rungs (intermediate limits stay inside the spread)
        const t = rungs > 2 ? i / (rungs - 2) : 0;
        const fr = Math.min(0.95, frac + (1 - frac) * t);
        const raw = side === "buy" ? mid + fr * (ask - mid) : mid - fr * (mid - bid);
        const px = Math.max(TICK, Math.round(raw / TICK) * TICK);
        const o = await post(api.paperHost, "/v2/orders", {
          symbol, qty: String(remaining), side, type: "limit", limit_price: px.toFixed(2),
          time_in_force: "day", client_order_id: `${coidBase}-r${i}`,
        }, api.headers);
        const id = String(o.id ?? ""); lastId = id;
        let st = String(o.status ?? ""), fq = Number(o.filled_qty ?? 0), fp = Number(o.filled_avg_price ?? 0);
        const deadline = Date.now() + rungMs;
        while (id && !TERMINAL_ORDER_STATUS.has(st) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 300));
          try { const g = await get(api.paperHost, `/v2/orders/${id}`, api.headers); st = String(g.status ?? st); fq = Number(g.filled_qty ?? fq); if (Number(g.filled_avg_price) > 0) fp = Number(g.filled_avg_price); } catch { /* keep polling */ }
        }
        // cancel any unfilled remainder before re-pricing — never stack two working limits
        if (id && !TERMINAL_ORDER_STATUS.has(st)) {
          try { await del(api.paperHost, `/v2/orders/${id}`, api.headers); } catch { /* may have just filled */ }
          try { const g = await get(api.paperHost, `/v2/orders/${id}`, api.headers); st = String(g.status ?? st); fq = Number(g.filled_qty ?? fq); if (Number(g.filled_avg_price) > 0) fp = Number(g.filled_avg_price); } catch { /* settle */ }
        }
        status = st;
        if (fq > 0 && fp > 0) { accQty += fq; accCost += fq * fp; remaining -= fq; } // captured (priced inside the spread)
      }
    } catch { /* a rung threw — fall through to the next rung / market backstop; never strand the order */ }
  }
  const fill = accQty > 0 ? accCost / accQty : 0;
  const capturedUsd = accQty > 0 ? (side === "buy" ? crossRef - fill : fill - crossRef) * accQty * 100 : 0;
  return { id: lastId, fill, filledQty: accQty, status, capturedUsd, crossRef, crossedQty };
}

// ---- underlying bars (data host) — seed the rolling window on startup -------
export async function backfillBars(symbol: string, lookbackDays: number): Promise<Bar[]> {
  const start = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000).toISOString();
  const out: Bar[] = [];
  let token: string | null = null;
  do {
    const q = `/v2/stocks/${symbol}/bars?timeframe=1Min&feed=${config.stockFeed}` +
      `&start=${encodeURIComponent(start)}&limit=10000&adjustment=raw` +
      (token ? `&page_token=${token}` : "");
    const res = await get(config.alpacaDataHost, q, DATA_HEADERS);
    for (const b of (res.bars ?? [])) {
      out.push({
        ts: Date.parse(b.t),
        open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c),
        volume: Number(b.v ?? 0), vwap: Number(b.vw ?? b.c),
      });
    }
    token = res.next_page_token ?? null;
  } while (token);
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ---- option chain snapshot (data host) — NTM 0DTE + 1DTE -------------------
export interface ChainQuote {
  occ: string; strike: number; optType: OptType; expiration: string;
  bid: number; ask: number; mid: number; last: number | null; delta: number | null;
}
const OCC_RE = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;

export async function snapshotChain(symbol: string, spot: number, fromDate: string, toDate: string): Promise<ChainQuote[]> {
  let path = `/v1beta1/options/snapshots/${symbol}?feed=${config.optFeed}&limit=1000` +
    `&expiration_date_gte=${fromDate}&expiration_date_lte=${toDate}`;
  if (spot > 0) {
    path += `&strike_price_gte=${Math.floor(spot - config.strikeWindow)}` +
      `&strike_price_lte=${Math.ceil(spot + config.strikeWindow)}`;
  }
  const res = await get(config.alpacaDataHost, path, DATA_HEADERS);
  const raw = res?.snapshots ?? {};
  const out: ChainQuote[] = [];
  for (const [sym, s] of Object.entries<any>(raw)) {
    const m = sym.match(OCC_RE);
    if (!m) continue;
    const [, , yymmdd, cp, strk] = m;
    const bid = Number(s.latestQuote?.bp ?? 0);
    const ask = Number(s.latestQuote?.ap ?? 0);
    out.push({
      occ: sym,
      strike: Number(strk) / 1000,
      optType: cp === "C" ? "call" : "put",
      expiration: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
      bid, ask,
      mid: ask > 0 && bid > 0 ? (ask + bid) / 2 : ask || bid,
      last: s.latestTrade?.p != null ? Number(s.latestTrade.p) : null,
      delta: s.greeks?.delta != null ? Number(s.greeks.delta) : null,
    });
  }
  return out;
}

/** Phase 1G-B: targeted multi-contract snapshots. Unlike snapshotChain this
 *  does not lose a held contract when its strike drifts outside the NTM window.
 *  Alpaca documents a maximum of 100 requested symbols per call; batching and
 *  the 500-contract hard cap are pure/tested at the provider boundary. */
export async function snapshotOptionsTargeted(symbols: readonly string[]): Promise<Map<string, TargetedOptionQuote>> {
  const batches = targetedOptionBatches(symbols);
  if (batches == null) throw new Error(`targeted option snapshot hard cap exceeded (${symbols.length})`);
  const out = new Map<string, TargetedOptionQuote>();
  for (const batch of batches) {
    if (!batch.length) continue;
    const path = `/v1beta1/options/snapshots?symbols=${encodeURIComponent(batch.join(","))}`
      + `&feed=${config.optFeed}&limit=${batch.length}`;
    const normalized = normalizeTargetedOptionSnapshots(
      await get(config.alpacaDataHost, path, DATA_HEADERS),
      config.optFeed,
    );
    for (const [symbol, quote] of normalized) out.set(symbol, quote);
  }
  return out;
}

// ---- helpers ---------------------------------------------------------------
export function occSymbol(symbol: string, etDate: string, strike: number, type: OptType): string {
  const [y, m, d] = etDate.split("-");
  return `${symbol}${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
export function etParts(ms: number): { min: number; date: string } {
  let y = "", mo = "", d = "", h = 0, mi = 0;
  for (const p of ET_FMT.formatToParts(new Date(ms))) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") mo = p.value;
    else if (p.type === "day") d = p.value;
    else if (p.type === "hour") h = Number(p.value) % 24;
    else if (p.type === "minute") mi = Number(p.value);
  }
  return { min: h * 60 + mi, date: `${y}-${mo}-${d}` };
}
