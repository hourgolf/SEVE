// ============================================================================
//  supabase/functions/market-ingest/index.ts   (v2 — instrumented)
//  Phase 1 — observation. Pulls SPY spot + the near-the-money 0DTE/1DTE option
//  chain from Alpaca and writes them to the desk DB. No trades placed here.
//  This version logs to the Logs tab AND surfaces DB insert errors (the v1
//  silently ignored them, so it could report success with nothing inserted).
//
//  Secrets:  supabase secrets set ALPACA_KEY=...  ALPACA_SECRET=...
//  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALPACA_KEY    = Deno.env.get("ALPACA_KEY");
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET");
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DATA = "https://data.alpaca.markets";
const STOCK_FEED    = "iex";          // free tier; paid data subscribers -> "sip"
const OPT_FEED      = "indicative";   // free/delayed; OPRA subscribers   -> "opra"
const STRIKE_WINDOW = 8;              // keep strikes within +/- this many $ of spot

const H = {
  "APCA-API-KEY-ID": ALPACA_KEY ?? "",
  "APCA-API-SECRET-KEY": ALPACA_SECRET ?? "",
  "accept": "application/json",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function nextTradingDay(d: Date): Date {
  const n = new Date(d);
  do { n.setUTCDate(n.getUTCDate() + 1); } while (n.getUTCDay() === 0 || n.getUTCDay() === 6);
  return n;
}
async function getJson(url: string) {
  const r = await fetch(url, { headers: H });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} from ${url.split("?")[0]} -> ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

Deno.serve(async () => {
  const sb = createClient(SB_URL, SB_SERVICE);
  try {
    if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error("ALPACA_KEY / ALPACA_SECRET secret not set");
    console.log("market-ingest: starting");
    const now = new Date();

    // ---- 1) underlying: latest minute bar + last trade ----------------------
    const [barRes, tradeRes] = await Promise.all([
      getJson(`${DATA}/v2/stocks/SPY/bars/latest?feed=${STOCK_FEED}`),
      getJson(`${DATA}/v2/stocks/SPY/trades/latest?feed=${STOCK_FEED}`),
    ]);
    const spot: number | undefined = tradeRes?.trade?.p ?? barRes?.bar?.c;
    console.log("spot:", spot);

    if (barRes?.bar) {
      const b = barRes.bar;
      const { error } = await sb.from("underlying_bars").upsert(
        { symbol: "SPY", ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, vwap: b.vw },
        { onConflict: "symbol,ts" },
      );
      if (error) throw new Error("underlying_bars upsert: " + error.message);
    }

    // ---- 2) option chain: 0DTE (today) + 1DTE (next session), near the money -
    const today  = ymd(now);
    const oneDTE = ymd(nextTradingDay(now));
    let url = `${DATA}/v1beta1/options/snapshots/SPY?feed=${OPT_FEED}&limit=1000`
            + `&expiration_date_gte=${today}&expiration_date_lte=${oneDTE}`;
    if (spot) {
      url += `&strike_price_gte=${Math.floor(spot - STRIKE_WINDOW)}`
           + `&strike_price_lte=${Math.ceil(spot + STRIKE_WINDOW)}`;
    }
    console.log("chain url:", url);
    const chain = await getJson(url);

    const raw = chain?.snapshots ?? {};
    const rawKeys = Object.keys(raw);
    console.log("raw contracts from alpaca:", rawKeys.length);
    if (rawKeys[0]) console.log("sample snapshot:", rawKeys[0], JSON.stringify(raw[rawKeys[0]]).slice(0, 400));

    const OCC = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
    const rows = Object.entries(raw)
      .map(([sym, s]: [string, any]) => {
        const m = sym.match(OCC);
        if (!m) return null;
        const [, , yymmdd, cp, strk] = m;
        const g = s.greeks ?? {};
        return {
          occ_symbol: sym,
          underlying: "SPY",
          expiration: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
          strike: Number(strk) / 1000,
          opt_type: cp === "C" ? "call" : "put",
          underlying_price: spot ?? null,
          bid: s.latestQuote?.bp ?? null,
          ask: s.latestQuote?.ap ?? null,
          bid_size: s.latestQuote?.bs ?? null,
          ask_size: s.latestQuote?.as ?? null,
          last: s.latestTrade?.p ?? null,
          iv: s.impliedVolatility ?? null,
          delta: g.delta ?? null, gamma: g.gamma ?? null,
          theta: g.theta ?? null, vega: g.vega ?? null, rho: g.rho ?? null,
        };
      })
      .filter(Boolean);

    console.log("rows to insert:", rows.length);
    if (rows.length) {
      const { error } = await sb.from("option_quotes").insert(rows as any[]);
      if (error) throw new Error("option_quotes insert: " + error.message);
    }

    await sb.from("events").insert({
      level: "INFO",
      message: `market-ingest: SPY ${spot ?? "?"} · ${rows.length} contracts (${today}/${oneDTE})`,
    });
    console.log("market-ingest: done, inserted", rows.length);
    return Response.json({ ok: true, spot, contracts: rows.length });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("market-ingest failed:", msg);
    await sb.from("events").insert({ level: "WARN", message: `market-ingest failed: ${msg}` });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
