// ============================================================================
//  Alpaca REST — account/positions/orders (paper host) + bar backfill & option
//  chain snapshot (data host). Mirrors the cron worker's REST surface; the
//  websocket bar stream lives in stream.ts. Bars are mapped to the engine's Bar.
// ============================================================================

import { config } from "./config.js";
import type { Bar, OptType } from "../../engine/types";

const H = {
  "APCA-API-KEY-ID": config.alpacaKey,
  "APCA-API-SECRET-KEY": config.alpacaSecret,
  accept: "application/json",
};

async function get(host: string, path: string): Promise<any> {
  const r = await fetch(host + path, { headers: H });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} GET ${path.split("?")[0]} → ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : {};
}

// ---- paper account / positions / orders ------------------------------------
export interface AlpacaAccount { equity: number; cash: number; }
export interface AlpacaPosition { symbol: string; qty: number; avg_entry_price: number; current_price: number; unrealized_pl: number; }

export async function getAccount(): Promise<AlpacaAccount> {
  const a = await get(config.alpacaPaperHost, "/v2/account");
  return { equity: Number(a.equity), cash: Number(a.cash) };
}
export async function getPositions(): Promise<AlpacaPosition[]> {
  const ps = await get(config.alpacaPaperHost, "/v2/positions");
  return (ps as any[]).map((p) => ({
    symbol: String(p.symbol),
    qty: Number(p.qty),
    avg_entry_price: Number(p.avg_entry_price),
    current_price: Number(p.current_price),
    unrealized_pl: Number(p.unrealized_pl),
  }));
}
export interface MarketClock { is_open: boolean; next_open: string; next_close: string; timestamp: string; }
export async function getClock(): Promise<MarketClock> {
  return get(config.alpacaPaperHost, "/v2/clock");
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
    const res = await get(config.alpacaDataHost, q);
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
  const res = await get(config.alpacaDataHost, path);
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
