// ============================================================================
//  supabase/functions/backfill-bars/index.ts
//  One-off / repeatable historical backfill of SPY 1-minute bars from Alpaca
//  into underlying_bars — so the engine has real history to backtest against
//  (the live market-ingest cron only accumulates going forward).
//
//  Reuses the SAME setup as market-ingest:
//    - ALPACA_KEY / ALPACA_SECRET   → already set as function secrets
//    - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY → injected automatically
//      (service-role bypasses RLS so it can INSERT; never exposed to browsers)
//
//  Deploy:   supabase functions deploy backfill-bars
//  Invoke (POST a date range; defaults to the last 30 days):
//    curl -X POST \
//      "https://<PROJECT_REF>.supabase.co/functions/v1/backfill-bars" \
//      -H "Authorization: Bearer <SUPABASE_ANON_OR_SERVICE_KEY>" \
//      -H "Content-Type: application/json" \
//      -d '{"start":"2026-01-02","end":"2026-05-29"}'
//
//  Re-runnable & idempotent: upserts on (symbol, ts), so overlapping ranges and
//  the live cron's rows just dedupe. Backfill big spans month-by-month to stay
//  well inside the edge-function time budget.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALPACA_KEY = Deno.env.get("ALPACA_KEY");
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET");
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DATA = "https://data.alpaca.markets";
const STOCK_FEED = "iex"; // free tier (matches market-ingest); paid subscribers -> "sip"
const SYMBOL = "SPY";
const MAX_PAGES = 300; // safety bound on pagination

const H = {
  "APCA-API-KEY-ID": ALPACA_KEY ?? "",
  "APCA-API-SECRET-KEY": ALPACA_SECRET ?? "",
  accept: "application/json",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function defaultStart(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return ymd(d);
}

Deno.serve(async (req) => {
  const sb = createClient(SB_URL, SB_SERVICE);
  try {
    if (!ALPACA_KEY || !ALPACA_SECRET) {
      throw new Error("ALPACA_KEY / ALPACA_SECRET secret not set");
    }
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const start: string =
      url.searchParams.get("start") ?? body.start ?? defaultStart();
    const end: string =
      url.searchParams.get("end") ?? body.end ?? ymd(new Date());

    console.log(`backfill-bars: ${SYMBOL} ${start} → ${end} (feed=${STOCK_FEED})`);

    let pageToken: string | undefined;
    let pages = 0;
    let total = 0;

    do {
      const q = new URLSearchParams({
        timeframe: "1Min",
        start,
        end,
        feed: STOCK_FEED,
        limit: "10000",
        adjustment: "raw",
        sort: "asc",
      });
      if (pageToken) q.set("page_token", pageToken);

      const r = await fetch(`${DATA}/v2/stocks/${SYMBOL}/bars?${q}`, { headers: H });
      const txt = await r.text();
      if (!r.ok) throw new Error(`${r.status} from Alpaca bars -> ${txt.slice(0, 200)}`);
      const j = JSON.parse(txt);
      const bars: any[] = j.bars ?? [];

      if (bars.length) {
        const rows = bars.map((b) => ({
          symbol: SYMBOL,
          ts: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
          vwap: b.vw,
        }));
        // batch the upserts so a big page doesn't make one giant request
        for (let i = 0; i < rows.length; i += 1000) {
          const { error } = await sb
            .from("underlying_bars")
            .upsert(rows.slice(i, i + 1000), { onConflict: "symbol,ts" });
          if (error) throw new Error("underlying_bars upsert: " + error.message);
        }
        total += rows.length;
      }

      pageToken = j.next_page_token ?? undefined;
      pages++;
    } while (pageToken && pages < MAX_PAGES);

    await sb.from("events").insert({
      level: "INFO",
      message: `backfill-bars: ${SYMBOL} ${start}→${end} · ${total} bars (${pages} page${pages === 1 ? "" : "s"})`,
    });
    console.log(`backfill-bars: done, ${total} bars over ${pages} pages`);
    return Response.json({ ok: true, symbol: SYMBOL, start, end, bars: total, pages });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("backfill-bars failed:", msg);
    await sb.from("events").insert({ level: "WARN", message: `backfill-bars failed: ${msg}` });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
