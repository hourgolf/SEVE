// GENERATED DEPLOYMENT ARTIFACT — DO NOT EDIT.
// Source: market-ingest.ts + its local dependency graph.
// Regenerate: npm run market-ingest-edge:build

// market-ingest.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

// engine/market-calendar.ts
var MARKET_HOLIDAYS = /* @__PURE__ */ new Set([
  // 2024
  "2024-01-01",
  "2024-01-15",
  "2024-02-19",
  "2024-03-29",
  "2024-05-27",
  "2024-06-19",
  "2024-07-04",
  "2024-09-02",
  "2024-11-28",
  "2024-12-25",
  // 2025  (incl. 01-09 Carter National Day of Mourning)
  "2025-01-01",
  "2025-01-09",
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  // 2026
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  // 2027 (forward — standard set; Jul 5 = Jul 4 Sun→Mon, Dec 24 = Dec 25 Sat→Fri)
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24"
]);
function addDays(dateET, n) {
  const [y, m, d] = dateET.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 864e5);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function dowUTC(dateET) {
  const [y, m, d] = dateET.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
var EARLY_CLOSES = /* @__PURE__ */ new Set([
  "2024-07-03",
  "2024-11-29",
  "2024-12-24",
  "2025-07-03",
  "2025-11-28",
  "2025-12-24",
  "2026-11-27",
  "2026-12-24",
  "2027-11-26"
]);
var FULL_CLOSE_MIN = 960;
var EARLY_CLOSE_MIN = 780;
function sessionCloseMin(dateET) {
  return EARLY_CLOSES.has(dateET) ? EARLY_CLOSE_MIN : FULL_CLOSE_MIN;
}
function isMarketHoliday(dateET) {
  return MARKET_HOLIDAYS.has(dateET);
}
function isWeekend(dateET) {
  const d = dowUTC(dateET);
  return d === 0 || d === 6;
}
var PREOPEN_START_MIN = 535;
var SUPPORTED_FROM = "2024-01-01";
var SUPPORTED_TO = "2027-12-31";
function calendarCoverageKnown(dateET) {
  return dateET >= SUPPORTED_FROM && dateET <= SUPPORTED_TO;
}
function isTradingDay(dateET) {
  return !isWeekend(dateET) && !isMarketHoliday(dateET);
}
function nextTradingDay(dateET) {
  let d = addDays(dateET, 1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d = addDays(d, 1);
  return d;
}

// lib/market/marketIngestWindow.ts
var MARKET_INGEST_TAIL_MIN = 15;
var ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});
function easternSessionParts(epochMs) {
  let year = "";
  let month = "";
  let day = "";
  let hour = 0;
  let minute = 0;
  for (const part of ET_PARTS.formatToParts(new Date(epochMs))) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
    else if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  return {
    dateEt: `${year}-${month}-${day}`,
    minuteEt: hour * 60 + minute
  };
}
function marketIngestWindow(epochMs) {
  const { dateEt, minuteEt } = easternSessionParts(epochMs);
  const closeMinuteEt = sessionCloseMin(dateEt);
  const base = {
    dateEt,
    minuteEt,
    closeMinuteEt,
    nextSessionDateEt: null
  };
  if (!calendarCoverageKnown(dateEt)) {
    return { ...base, shouldIngest: false, skipReason: "calendar_unknown" };
  }
  if (!isTradingDay(dateEt)) {
    return { ...base, shouldIngest: false, skipReason: "market_closed" };
  }
  if (minuteEt < PREOPEN_START_MIN) {
    return { ...base, shouldIngest: false, skipReason: "before_preopen" };
  }
  if (minuteEt > closeMinuteEt + MARKET_INGEST_TAIL_MIN) {
    return { ...base, shouldIngest: false, skipReason: "after_capture_tail" };
  }
  return {
    ...base,
    shouldIngest: true,
    nextSessionDateEt: nextTradingDay(dateEt),
    skipReason: null
  };
}

// market-ingest.ts
var ALPACA_KEY = Deno.env.get("ALPACA_KEY");
var ALPACA_SECRET = Deno.env.get("ALPACA_SECRET");
var SB_URL = Deno.env.get("SUPABASE_URL");
var SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var DATA = "https://data.alpaca.markets";
var STOCK_FEED = Deno.env.get("STOCK_FEED") ?? "iex";
var OPT_FEED = Deno.env.get("OPT_FEED") ?? "indicative";
var UNDERLYINGS = (Deno.env.get("UNDERLYINGS") ?? "SPY,QQQ,IWM").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
var STRIKE_WINDOW = Number(Deno.env.get("STRIKE_WINDOW") ?? 6);
var H = {
  "APCA-API-KEY-ID": ALPACA_KEY ?? "",
  "APCA-API-SECRET-KEY": ALPACA_SECRET ?? "",
  "accept": "application/json"
};
async function getJson(url) {
  const requestStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  const r = await fetch(url, { headers: H });
  const body = await r.text();
  const requestCompletedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (!r.ok) throw new Error(`${r.status} from ${url.split("?")[0]} -> ${body.slice(0, 200)}`);
  return { json: JSON.parse(body), requestStartedAt, requestCompletedAt };
}
var OCC = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
async function ingestOne(sb, sym, today, oneDTE) {
  const [barFetch, tradeFetch] = await Promise.all([
    getJson(`${DATA}/v2/stocks/${sym}/bars/latest?feed=${STOCK_FEED}`),
    getJson(`${DATA}/v2/stocks/${sym}/trades/latest?feed=${STOCK_FEED}`)
  ]);
  const barRes = barFetch.json;
  const tradeRes = tradeFetch.json;
  const spot = tradeRes?.trade?.p ?? barRes?.bar?.c;
  const underlyingSource = tradeRes?.trade?.p != null ? "latest_trade" : barRes?.bar?.c != null ? "latest_bar" : null;
  const underlyingProviderAt = tradeRes?.trade?.p != null ? tradeRes?.trade?.t ?? null : barRes?.bar?.t ?? null;
  const underlyingObservedAt = tradeRes?.trade?.p != null ? tradeFetch.requestCompletedAt : barRes?.bar?.c != null ? barFetch.requestCompletedAt : null;
  if (barRes?.bar) {
    const b = barRes.bar;
    const { error } = await sb.from("underlying_bars").upsert(
      { symbol: sym, ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, vwap: b.vw },
      { onConflict: "symbol,ts" }
    );
    if (error) throw new Error("underlying_bars upsert: " + error.message);
  }
  let url = `${DATA}/v1beta1/options/snapshots/${sym}?feed=${OPT_FEED}&limit=1000&expiration_date_gte=${today}&expiration_date_lte=${oneDTE}`;
  if (spot) {
    url += `&strike_price_gte=${Math.floor(spot - STRIKE_WINDOW)}&strike_price_lte=${Math.ceil(spot + STRIKE_WINDOW)}`;
  }
  const chainFetch = await getJson(url);
  const chain = chainFetch.json;
  const raw = chain?.snapshots ?? {};
  const rows = Object.entries(raw).map(([occSym, s]) => {
    const m = occSym.match(OCC);
    if (!m) return null;
    const [, , yymmdd, cp, strk] = m;
    const g = s.greeks ?? {};
    const hasGreeks = [
      g.delta,
      g.gamma,
      g.theta,
      g.vega,
      g.rho,
      s.impliedVolatility
    ].some((value) => value != null);
    return {
      occ_symbol: occSym,
      underlying: sym,
      expiration: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
      strike: Number(strk) / 1e3,
      opt_type: cp === "C" ? "call" : "put",
      underlying_price: spot ?? null,
      bid: s.latestQuote?.bp ?? null,
      ask: s.latestQuote?.ap ?? null,
      bid_size: s.latestQuote?.bs ?? null,
      ask_size: s.latestQuote?.as ?? null,
      last: s.latestTrade?.p ?? null,
      iv: s.impliedVolatility ?? null,
      delta: g.delta ?? null,
      gamma: g.gamma ?? null,
      theta: g.theta ?? null,
      vega: g.vega ?? null,
      rho: g.rho ?? null,
      provider: "alpaca",
      option_feed: OPT_FEED,
      request_started_at: chainFetch.requestStartedAt,
      request_completed_at: chainFetch.requestCompletedAt,
      observed_at: chainFetch.requestCompletedAt,
      provider_quote_at: s.latestQuote?.t ?? null,
      provider_trade_at: s.latestTrade?.t ?? null,
      quote_conditions: s.latestQuote?.c ?? null,
      trade_conditions: s.latestTrade?.c ?? null,
      underlying_feed: STOCK_FEED,
      underlying_source: underlyingSource,
      underlying_provider_at: underlyingProviderAt,
      underlying_observed_at: underlyingObservedAt,
      // Alpaca snapshot Greeks do not carry an independent provider timestamp.
      // Keep that unknown explicit instead of borrowing the quote or receipt clock.
      greeks_provider_at: null,
      greeks_observed_at: hasGreeks ? chainFetch.requestCompletedAt : null,
      greeks_provenance: hasGreeks ? "alpaca_snapshot_unstamped" : null,
      // The snapshot endpoint does not prove contract metadata. A later metadata
      // join may populate these fields; the collector must not assume 100 here.
      contract_multiplier: null,
      contract_metadata_source: null
    };
  }).filter(Boolean);
  if (rows.length) {
    const { error } = await sb.from("option_quotes").insert(rows);
    if (error) throw new Error("option_quotes insert: " + error.message);
  }
  return { spot, contracts: rows.length };
}
Deno.serve(async () => {
  const sb = createClient(SB_URL, SB_SERVICE);
  try {
    if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error("ALPACA_KEY / ALPACA_SECRET secret not set");
    const now = /* @__PURE__ */ new Date();
    const window = marketIngestWindow(now.getTime());
    if (!window.shouldIngest) {
      console.log(`market-ingest: skipped ${window.dateEt} ${window.minuteEt}m ET (${window.skipReason})`);
      return Response.json({
        ok: true,
        skipped: true,
        dateEt: window.dateEt,
        minuteEt: window.minuteEt,
        reason: window.skipReason
      });
    }
    const today = window.dateEt;
    const oneDTE = window.nextSessionDateEt;
    console.log("market-ingest: starting", UNDERLYINGS.join(","), today, oneDTE);
    const parts = [];
    const errs = [];
    for (const sym of UNDERLYINGS) {
      try {
        const r = await ingestOne(sb, sym, today, oneDTE);
        parts.push(`${sym} ${r.spot ?? "?"} \xB7 ${r.contracts}c`);
      } catch (e) {
        const msg = e.message;
        console.error(`${sym} ingest failed:`, msg);
        errs.push(`${sym}: ${msg}`);
      }
    }
    if (!parts.length) throw new Error(`all underlyings failed \u2014 ${errs.join(" | ")}`);
    const message = `market-ingest: ${parts.join("  \xB7  ")} (${today}/${oneDTE})` + (errs.length ? `  [errors: ${errs.join(" | ")}]` : "");
    await sb.from("events").insert({ level: errs.length ? "WARN" : "INFO", message });
    console.log("market-ingest: done \u2014", message);
    return Response.json({ ok: true, ingested: parts, errors: errs });
  } catch (e) {
    const msg = e.message;
    console.error("market-ingest failed:", msg);
    await sb.from("events").insert({ level: "WARN", message: `market-ingest failed: ${msg}` });
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});
