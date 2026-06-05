// ============================================================================
//  scripts/backfill-options.ts   ·   run: npm run backfill:options
//
//  Backfills REAL historical 0DTE option bars (trade OHLC) from Alpaca into
//  the option_bars table, so the backtest can fill at real prices instead of
//  Black-Scholes guesses. Per trading day it reads that day's range (from
//  underlying_bars for --underlying), enumerates the near-the-money strikes,
//  expiry = that day (0DTE), fetches Alpaca option bars in batches, and upserts.
//  --underlying SPY (default) | QQQ — both are $1-strike, same OCC layout.
//
//  REQUIRES these in your shell env (NOT committed):
//    SUPABASE_URL                (or NEXT_PUBLIC_SUPABASE_URL from .env.local)
//    SUPABASE_SERVICE_ROLE_KEY   (writes bypass RLS — keep secret)
//    ALPACA_KEY  ALPACA_SECRET   (your Alpaca data creds)
//
//  Example:
//    SUPABASE_SERVICE_ROLE_KEY=... ALPACA_KEY=... ALPACA_SECRET=... \
//      npm run backfill:options
//  Optional flags:  --window 6   (strikes ± this many $ beyond the day range)
//                   --from 2026-03-01  --to 2026-05-29
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
}
loadEnvLocal();

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
// Prefer the service-role key; fall back to the anon key (needs a temporary
// INSERT/UPDATE policy on option_bars — see the SQL we run alongside).
const SB_WRITE =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const DATA = "https://data.alpaca.markets";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const UNDERLYING = arg("underlying", "SPY").toUpperCase(); // SPY (default) | QQQ
const STRIKE_WINDOW = Number(arg("window", "4")); // extra $ beyond the day's range
const OPT_TF = arg("tf", "1"); // option-bar timeframe (e.g. "1" or "15" min) — use 15 for long backfills to save storage
const FROM = arg("from", "");
const TO = arg("to", "");
const BATCH = 40; // symbols per Alpaca request
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ET wall-clock parts (DST-correct).
const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
function etParts(ms: number): { date: string; min: number } {
  const p: Record<string, string> = {};
  for (const part of etFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  let h = Number(p.hour);
  if (h === 24) h = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + Number(p.minute) };
}

const occSymbol = (expISO: string, strike: number, type: "call" | "put") => {
  const [y, m, d] = expISO.split("-");
  const k = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${UNDERLYING}${y.slice(2)}${m}${d}${type === "call" ? "C" : "P"}${k}`;
};
// Parse an OCC symbol back to its parts — root is the (variable-length) ticker.
const OCC_RE = new RegExp(`^${UNDERLYING}(\\d{6})([CP])(\\d{8})$`);

const H = {
  "APCA-API-KEY-ID": ALPACA_KEY ?? "",
  "APCA-API-SECRET-KEY": ALPACA_SECRET ?? "",
  accept: "application/json",
};

interface DayRange { date: string; lo: number; hi: number }

async function dayRanges(sb: ReturnType<typeof createClient>): Promise<DayRange[]> {
  // page all RTH bars, reduce to per-ET-day low/high
  const acc = new Map<string, { lo: number; hi: number }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("underlying_bars")
      .select("ts,low,high")
      .eq("symbol", UNDERLYING)
      .order("ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("underlying_bars: " + error.message);
    const rows = (data ?? []) as { ts: string; low: number; high: number }[];
    for (const r of rows) {
      const { date, min } = etParts(Date.parse(r.ts));
      if (min < 570 || min >= 960) continue; // RTH only
      const cur = acc.get(date);
      const lo = Number(r.low), hi = Number(r.high);
      if (!cur) acc.set(date, { lo, hi });
      else { cur.lo = Math.min(cur.lo, lo); cur.hi = Math.max(cur.hi, hi); }
    }
    if (rows.length < PAGE) break;
  }
  return [...acc.entries()]
    .map(([date, r]) => ({ date, ...r }))
    .filter((d) => (!FROM || d.date >= FROM) && (!TO || d.date <= TO))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchOptionBars(symbols: string[], day: string) {
  const rows: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const q = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe: `${OPT_TF}Min`,
      start: day,
      end: day,
      limit: "10000",
      sort: "asc",
    });
    if (pageToken) q.set("page_token", pageToken);
    const r = await fetch(`${DATA}/v1beta1/options/bars?${q}`, { headers: H });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} options/bars -> ${txt.slice(0, 160)}`);
    const j = JSON.parse(txt);
    const bars: Record<string, any[]> = j.bars ?? {};
    for (const [sym, arr] of Object.entries(bars)) {
      const mm = sym.match(OCC_RE);
      if (!mm) continue;
      const [, yymmdd, cp, strk] = mm;
      const expiration = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
      const strike = Number(strk) / 1000;
      const opt_type = cp === "C" ? "call" : "put";
      for (const b of arr) {
        rows.push({
          occ_symbol: sym, ts: b.t, expiration, strike, opt_type,
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, trade_count: b.n,
        });
      }
    }
    pageToken = j.next_page_token ?? undefined;
    pages++;
  } while (pageToken && pages < 50);
  return rows;
}

async function main() {
  if (!SB_URL || !SB_WRITE) throw new Error("Set SUPABASE_URL + a write key (service-role or anon)");
  if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error("Set ALPACA_KEY + ALPACA_SECRET");
  const sb = createClient(SB_URL, SB_WRITE, { auth: { persistSession: false } });

  const days = await dayRanges(sb);
  console.log(`backfill-options [${UNDERLYING}]: ${days.length} trading days (${days[0]?.date} → ${days[days.length - 1]?.date}), strike window ±$${STRIKE_WINDOW}`);

  let grandTotal = 0;
  for (const d of days) {
    const loK = Math.floor(d.lo) - STRIKE_WINDOW;
    const hiK = Math.ceil(d.hi) + STRIKE_WINDOW;
    const symbols: string[] = [];
    for (let k = loK; k <= hiK; k++) {
      symbols.push(occSymbol(d.date, k, "call"), occSymbol(d.date, k, "put"));
    }
    let dayRows = 0;
    try {
      for (let i = 0; i < symbols.length; i += BATCH) {
        const rows = await fetchOptionBars(symbols.slice(i, i + BATCH), d.date);
        for (let j = 0; j < rows.length; j += 500) {
          const { error } = await sb
            .from("option_bars")
            .upsert(rows.slice(j, j + 500), { onConflict: "occ_symbol,ts" });
          if (error) throw new Error("option_bars upsert: " + error.message);
        }
        dayRows += rows.length;
        await sleep(120); // gentle on the rate limit
      }
    } catch (e) {
      console.warn(`  ${d.date}: ${(e as Error).message}`);
    }
    grandTotal += dayRows;
    console.log(`  ${d.date}  strikes ${loK}-${hiK}  → ${dayRows} bars`);
  }
  console.log(`backfill-options: done · ${grandTotal} option bars total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
