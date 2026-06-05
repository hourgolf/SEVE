// ============================================================================
//  scripts/backfill-bars.ts   ·   run: npm run backfill:bars
//
//  Backfills historical 1-min STOCK bars for any ticker from Alpaca into
//  underlying_bars — a deterministic Node alternative to the pg_net flow in
//  07/20_backfill_*.sql (no async fire→wait→ingest dance). Paginates the full
//  range, upserts in chunks (symbol, ts dedupes).
//
//  REQUIRES in your shell env or .env.local (NOT committed):
//    NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY  (anon → needs a temp INSERT/UPDATE
//                                            policy on underlying_bars; or set
//                                            SUPABASE_SERVICE_ROLE_KEY to bypass RLS)
//    ALPACA_KEY  ALPACA_SECRET
//
//  Example:
//    npm run backfill:bars -- --underlying QQQ --from 2026-01-02 --to 2026-06-04
//  Flags:  --underlying SPY  --from YYYY-MM-DD  --to YYYY-MM-DD  --feed iex
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
const SB_WRITE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ALPACA_KEY = process.env.ALPACA_KEY;
const ALPACA_SECRET = process.env.ALPACA_SECRET;
const DATA = "https://data.alpaca.markets";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const UNDERLYING = arg("underlying", "SPY").toUpperCase();
const FROM = arg("from", "");
const TO = arg("to", "");
const FEED = arg("feed", "iex"); // free historical stock bars
const H = {
  "APCA-API-KEY-ID": ALPACA_KEY ?? "",
  "APCA-API-SECRET-KEY": ALPACA_SECRET ?? "",
  accept: "application/json",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bar { t: string; o: number; h: number; l: number; c: number; v: number; vw: number }

async function fetchBars(): Promise<Bar[]> {
  const out: Bar[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const q = new URLSearchParams({
      timeframe: "1Min", start: FROM, end: `${TO}T23:59:59Z`,
      feed: FEED, limit: "10000", adjustment: "raw", sort: "asc",
    });
    if (pageToken) q.set("page_token", pageToken);
    const r = await fetch(`${DATA}/v2/stocks/${UNDERLYING}/bars?${q}`, { headers: H });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${r.status} stocks/bars -> ${txt.slice(0, 200)}`);
    const j = JSON.parse(txt);
    for (const b of (j.bars ?? []) as Bar[]) out.push(b);
    pageToken = j.next_page_token ?? undefined;
    pages++;
    if (pageToken) await sleep(120);
  } while (pageToken && pages < 200);
  return out;
}

async function main() {
  if (!SB_URL || !SB_WRITE) throw new Error("Set SUPABASE_URL + a write key (service-role or anon)");
  if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error("Set ALPACA_KEY + ALPACA_SECRET");
  if (!FROM || !TO) throw new Error("Set --from and --to (YYYY-MM-DD)");
  const sb = createClient(SB_URL, SB_WRITE, { auth: { persistSession: false } });

  console.log(`backfill-bars [${UNDERLYING}] ${FROM} → ${TO} (feed=${FEED}) …`);
  const bars = await fetchBars();
  console.log(`  fetched ${bars.length} 1-min bars from Alpaca`);
  if (!bars.length) { console.log("  nothing to write."); return; }

  const rows = bars.map((b) => ({
    symbol: UNDERLYING, ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c,
    volume: b.v, vwap: b.vw ?? b.c,
  }));
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("underlying_bars").upsert(rows.slice(i, i + 500), { onConflict: "symbol,ts" });
    if (error) throw new Error("underlying_bars upsert: " + error.message);
    written += Math.min(500, rows.length - i);
  }
  console.log(`backfill-bars: done · upserted ${written} ${UNDERLYING} bars`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
