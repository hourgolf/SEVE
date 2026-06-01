// Live SPY price proxy — keeps the LED ticking between the 1-minute ingest
// snapshots. Server-side so the Alpaca keys never reach the browser and there's
// no CORS. Free plan → IEX last trade (updates every few seconds). Degrades to
// { price: null } if the keys aren't set, so the client falls back to the
// 1/min spot from Supabase.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TRADE_URL =
  "https://data.alpaca.markets/v2/stocks/SPY/trades/latest?feed=iex";

// Tiny server-side cache so multiple tabs/clients don't hammer Alpaca's rate
// limit — at most one upstream fetch per TTL window.
let cache: { price: number; ts: string | null; at: number } | null = null;
const TTL_MS = 2000;

export async function GET() {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  if (!key || !secret) {
    return NextResponse.json({ price: null, reason: "no-keys" });
  }

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ price: cache.price, ts: cache.ts, cached: true });
  }

  try {
    const res = await fetch(TRADE_URL, {
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
      cache = { price, ts, at: now };
      return NextResponse.json({ price, ts });
    }
    return NextResponse.json({ price: null, reason: "no-trade" });
  } catch {
    return NextResponse.json({ price: null, reason: "fetch-failed" });
  }
}
