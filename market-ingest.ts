// ============================================================================
//  supabase/functions/market-ingest/index.ts   (v3 — multi-underlying)
//  Phase 1 — observation. Pulls each underlying's spot + near-the-money 0DTE/1DTE
//  option chain from Alpaca and writes them to the desk DB. No trades placed here.
//
//  Multi-underlying (2026-06-04; IWM added to the default 2026-07-01): loops over
//  UNDERLYINGS (env, default "SPY,QQQ,IWM" — matches the worker's SYMBOLS default so
//  the dashboard tape covers every traded index) so adding/removing a ticker is a
//  SECRET change, not a re-paste. Each ticker is ingested in its OWN try/catch — one
//  hiccup can NEVER break the others. Strike window narrowed (8 -> 6) to keep storage
//  lean. Set `UNDERLYINGS=SPY,QQQ` to drop IWM, or `UNDERLYINGS=SPY` for SPY-only.
//
//  Secrets:  ALPACA_KEY / ALPACA_SECRET (SUPABASE_* injected automatically).
//  Optional: STOCK_FEED=sip OPT_FEED=opra (real-time on Algo Trader Plus),
//            UNDERLYINGS=SPY,QQQ, STRIKE_WINDOW=6.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { marketIngestWindow } from "./lib/market/marketIngestWindow.ts";

const ALPACA_KEY    = Deno.env.get("ALPACA_KEY");
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET");
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DATA = "https://data.alpaca.markets";
// Feeds are ENV-DRIVEN so the real-time flip is a SECRET change, not a code re-paste
// (and instantly reversible). Free tier defaults: stock=iex, options=indicative
// (~15-min DELAYED). On Alpaca Algo Trader Plus, set the secrets:
//   supabase secrets set STOCK_FEED=sip OPT_FEED=opra
// → next cron tick serves real-time SIP bars + real-time OPRA NBBO.
const STOCK_FEED    = Deno.env.get("STOCK_FEED") ?? "iex";        // "sip"  on Algo Trader Plus (real-time)
const OPT_FEED      = Deno.env.get("OPT_FEED")   ?? "indicative"; // "opra" on Algo Trader Plus (real-time NBBO)
// Underlyings to ingest (env-driven; the system only uses ATM ± a few strikes).
const UNDERLYINGS   = (Deno.env.get("UNDERLYINGS") ?? "SPY,QQQ,IWM").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const STRIKE_WINDOW = Number(Deno.env.get("STRIKE_WINDOW") ?? 6); // keep strikes within +/- this many $ of spot

const H = {
  "APCA-API-KEY-ID": ALPACA_KEY ?? "",
  "APCA-API-SECRET-KEY": ALPACA_SECRET ?? "",
  "accept": "application/json",
};

async function getJson(url: string) {
  const r = await fetch(url, { headers: H });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} from ${url.split("?")[0]} -> ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

const OCC = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;

// Ingest one underlying: latest bar (-> underlying_bars) + near-the-money 0DTE/1DTE
// chain (-> option_quotes). Returns the spot + contract count. Throws on its own
// failures so the caller can isolate per-ticker.
// deno-lint-ignore no-explicit-any
async function ingestOne(sb: any, sym: string, today: string, oneDTE: string): Promise<{ spot?: number; contracts: number }> {
  // ---- 1) underlying: latest minute bar + last trade ----
  const [barRes, tradeRes] = await Promise.all([
    getJson(`${DATA}/v2/stocks/${sym}/bars/latest?feed=${STOCK_FEED}`),
    getJson(`${DATA}/v2/stocks/${sym}/trades/latest?feed=${STOCK_FEED}`),
  ]);
  const spot: number | undefined = tradeRes?.trade?.p ?? barRes?.bar?.c;

  if (barRes?.bar) {
    const b = barRes.bar;
    const { error } = await sb.from("underlying_bars").upsert(
      { symbol: sym, ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, vwap: b.vw },
      { onConflict: "symbol,ts" },
    );
    if (error) throw new Error("underlying_bars upsert: " + error.message);
  }

  // ---- 2) option chain: 0DTE (today) + 1DTE (next session), near the money ----
  let url = `${DATA}/v1beta1/options/snapshots/${sym}?feed=${OPT_FEED}&limit=1000`
          + `&expiration_date_gte=${today}&expiration_date_lte=${oneDTE}`;
  if (spot) {
    url += `&strike_price_gte=${Math.floor(spot - STRIKE_WINDOW)}`
         + `&strike_price_lte=${Math.ceil(spot + STRIKE_WINDOW)}`;
  }
  const chain = await getJson(url);
  const raw = chain?.snapshots ?? {};

  const rows = Object.entries(raw)
    .map(([occSym, s]: [string, any]) => {
      const m = occSym.match(OCC);
      if (!m) return null;
      const [, , yymmdd, cp, strk] = m;
      const g = s.greeks ?? {};
      return {
        occ_symbol: occSym,
        underlying: sym,
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

  if (rows.length) {
    const { error } = await sb.from("option_quotes").insert(rows as any[]);
    if (error) throw new Error("option_quotes insert: " + error.message);
  }
  return { spot, contracts: rows.length };
}

Deno.serve(async () => {
  const sb = createClient(SB_URL, SB_SERVICE);
  try {
    if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error("ALPACA_KEY / ALPACA_SECRET secret not set");
    const now = new Date();
    const window = marketIngestWindow(now.getTime());
    if (!window.shouldIngest) {
      console.log(`market-ingest: skipped ${window.dateEt} ${window.minuteEt}m ET (${window.skipReason})`);
      return Response.json({
        ok: true,
        skipped: true,
        dateEt: window.dateEt,
        minuteEt: window.minuteEt,
        reason: window.skipReason,
      });
    }
    const today = window.dateEt;
    const oneDTE = window.nextSessionDateEt!;
    console.log("market-ingest: starting", UNDERLYINGS.join(","), today, oneDTE);

    const parts: string[] = [];
    const errs: string[] = [];
    // Each ticker isolated: one failing must NOT stop the others (SPY is the live trader's tape).
    for (const sym of UNDERLYINGS) {
      try {
        const r = await ingestOne(sb, sym, today, oneDTE);
        parts.push(`${sym} ${r.spot ?? "?"} · ${r.contracts}c`);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`${sym} ingest failed:`, msg);
        errs.push(`${sym}: ${msg}`);
      }
    }

    if (!parts.length) throw new Error(`all underlyings failed — ${errs.join(" | ")}`);
    const message = `market-ingest: ${parts.join("  ·  ")} (${today}/${oneDTE})`
                  + (errs.length ? `  [errors: ${errs.join(" | ")}]` : "");
    await sb.from("events").insert({ level: errs.length ? "WARN" : "INFO", message });
    console.log("market-ingest: done —", message);
    return Response.json({ ok: true, ingested: parts, errors: errs });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("market-ingest failed:", msg);
    await sb.from("events").insert({ level: "WARN", message: `market-ingest failed: ${msg}` });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
