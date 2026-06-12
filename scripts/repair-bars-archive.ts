// ============================================================================
//  repair-bars-archive — fill a HOLE in data/bars-archive/<SYM>/ straight from
//  Alpaca historical bars (post-W1 the archive is the home for history; the DB
//  holds only a rolling 60d window, so old bars must NOT route through it).
//
//  Found 2026-06-11: the entire 2024-09 month was missing for SPY (one month of
//  the original 07_backfill_bars pg_net run failed silently; it sat outside all
//  5 regime windows so no probe tripped on it until the FOMC calendar probe
//  needed 2024-09-18). Writes per-ET-day JSON in the exporter's exact shape
//  (ts,open,high,low,close,volume,vwap); skips existing files unless --force.
//
//    npm run repair-bars-archive -- --underlying SPY --from 2024-09-01 --to 2024-09-30
// ============================================================================

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";

function loadEnv() { try { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const KEY = process.env.ALPACA_KEY, SEC = process.env.ALPACA_SECRET;
if (!KEY || !SEC) { console.error("ALPACA_KEY/ALPACA_SECRET missing"); process.exit(1); }

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SYM = arg("underlying", "SPY").toUpperCase();
const FROM = arg("from", ""), TO = arg("to", "");
const FORCE = process.argv.includes("--force");
if (!FROM || !TO) { console.error("--from and --to required (YYYY-MM-DD)"); process.exit(1); }

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const H = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SEC };

interface AlpBar { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }

async function main() {
  const dir = `data/bars-archive/${SYM}`;
  mkdirSync(dir, { recursive: true });
  const byDay = new Map<string, Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number; vwap: number | null }>>();
  let token: string | null = null, total = 0;
  do {
    const q = `https://data.alpaca.markets/v2/stocks/${SYM}/bars?timeframe=1Min&feed=sip&adjustment=raw&limit=10000` +
      `&start=${FROM}T00:00:00Z&end=${TO}T23:59:59Z` + (token ? `&page_token=${token}` : "");
    const r = await fetch(q, { headers: H });
    if (!r.ok) throw new Error(`alpaca ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json() as { bars?: AlpBar[]; next_page_token?: string | null };
    for (const b of j.bars ?? []) {
      const d = ET.format(new Date(b.t));
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push({ ts: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, vwap: b.vw ?? null });
      total++;
    }
    token = j.next_page_token ?? null;
  } while (token);

  let wrote = 0, skipped = 0;
  for (const [d, rows] of [...byDay.entries()].sort()) {
    const path = `${dir}/${d}.json`;
    if (!FORCE && existsSync(path)) { skipped++; continue; }
    rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    writeFileSync(path, JSON.stringify(rows));
    wrote++;
  }
  console.log(`repair-bars-archive: ${SYM} ${FROM}→${TO} · fetched ${total.toLocaleString()} bars · wrote ${wrote} day files · ${skipped} already present`);
}

main().catch((e) => { console.error(e); process.exit(1); });
