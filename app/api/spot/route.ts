// Live underlying price proxy — keeps the chart LED ticking between the 1-minute
// ingest snapshots. Server-side so the Alpaca keys never reach the browser and
// there's no CORS. Algo Trader Plus → SIP last trade (real-time, updates every few
// seconds); set a Vercel STOCK_FEED=iex var to revert. Degrades to { price: null }
// on missing keys / a feed error, so the client falls back to the 1/min Supabase spot.
//
// Multi-instrument (QQQ rollout, step 4): ?symbol=SPY|QQQ picks the ticker. The
// symbol is allowlisted (no arbitrary upstream fetch) and the cache is per-symbol.

import { NextResponse } from "next/server";
import { requireDeskOperator } from "@/lib/auth/serverOperator";

export const dynamic = "force-dynamic";

const FEED = process.env.STOCK_FEED ?? "sip";
// Allowlist — only tickers the desk actually ingests. Guards the upstream URL.
const ALLOWED = new Set(["SPY", "QQQ"]);
const tradeUrl = (sym: string) =>
  `https://data.alpaca.markets/v2/stocks/${sym}/trades/latest?feed=${FEED}`;

// Tiny server-side cache PER SYMBOL so multiple tabs/clients don't hammer Alpaca's
// rate limit — at most one upstream fetch per symbol per TTL window.
const cache = new Map<string, { price: number; ts: string | null; at: number }>();
const TTL_MS = 2000;

export async function GET(req: Request) {
  const operator = await requireDeskOperator(req);
  if (!operator.ok) return operator.response;

  const raw = new URL(req.url).searchParams.get("symbol") ?? "SPY";
  const symbol = raw.toUpperCase();
  if (!ALLOWED.has(symbol)) {
    return NextResponse.json({ price: null, reason: "bad-symbol" });
  }

  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  if (!key || !secret) {
    return NextResponse.json({ price: null, reason: "no-keys" });
  }

  const now = Date.now();
  const hit = cache.get(symbol);
  if (hit && now - hit.at < TTL_MS) {
    return NextResponse.json({ price: hit.price, ts: hit.ts, symbol, cached: true });
  }

  try {
    const res = await fetch(tradeUrl(symbol), {
      headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ price: null, reason: `alpaca-${res.status}` });
    }
    const j = (await res.json()) as { trade?: { p?: number; t?: string } };
    const price = typeof j?.trade?.p === "number" ? j.trade!.p : null;
    const ts = j?.trade?.t ?? null;
    if (price != null) {
      cache.set(symbol, { price, ts, at: now });
      return NextResponse.json({ price, ts, symbol });
    }
    return NextResponse.json({ price: null, reason: "no-trade" });
  } catch {
    return NextResponse.json({ price: null, reason: "fetch-failed" });
  }
}
