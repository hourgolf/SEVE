/**
 * Fetch the IEX-feed SPY bars that Nakamoto's bot actually consumes, for the
 * Phase-1 signal reproduction of his "Level Reversal + Breakout" export.
 * (His code fetches DataFeed.IEX everywhere — reproduce on IEX, judge on SIP.)
 *
 * Caches to data/handoff-verify/iex/ (gitignored):
 *   spy_1m_<day>.csv   — trade days, full session 04:00–16:00 ET (poll-mode spot + forming bars)
 *   spy_5m.csv         — 2026-05-20..06-09 full sessions (scanner bars incl premarket
 *                        MACD warmup + intraday-level 5-day lookbacks)
 *   spy_1d.csv         — 2025-11-20..2026-06-09 dailies (180d level discovery + grid anchor)
 *
 * Run: set -a && source .env.local && set +a && npx tsx engine/nakamoto/fetch-iex.ts
 */
import { mkdirSync, writeFileSync } from "fs";

const KEY = process.env.ALPACA_KEY!;
const SECRET = process.env.ALPACA_SECRET!;
if (!KEY || !SECRET) throw new Error("ALPACA_KEY/ALPACA_SECRET missing (source .env.local)");

const HDRS = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET };
const BASE = "https://data.alpaca.markets/v2/stocks/SPY/bars";
const OUT = "data/handoff-verify/iex";

type Raw = { t: string; o: number; h: number; l: number; c: number; v: number; n: number; vw: number };

async function fetchBars(timeframe: string, start: string, end: string): Promise<Raw[]> {
  const rows: Raw[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(BASE);
    u.searchParams.set("timeframe", timeframe);
    u.searchParams.set("start", start);
    u.searchParams.set("end", end);
    u.searchParams.set("feed", "iex");
    u.searchParams.set("adjustment", "raw");
    u.searchParams.set("limit", "10000");
    if (pageToken) u.searchParams.set("page_token", pageToken);
    const res = await fetch(u, { headers: HDRS });
    if (!res.ok) throw new Error(`${timeframe} ${start}: HTTP ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { bars?: Raw[]; next_page_token?: string };
    rows.push(...(j.bars ?? []));
    pageToken = j.next_page_token ?? undefined;
  } while (pageToken);
  return rows;
}

function toCsv(rows: Raw[]): string {
  const header = "timestamp,open,high,low,close,volume,trade_count,vwap";
  return [header, ...rows.map(r => [r.t, r.o, r.h, r.l, r.c, r.v, r.n, r.vw].join(","))].join("\n");
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // 1m for the four trade-log days, premarket included (04:00 ET = 08:00 UTC in June)
  for (const day of ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"]) {
    const rows = await fetchBars("1Min", `${day}T08:00:00Z`, `${day}T20:00:00Z`);
    writeFileSync(`${OUT}/spy_1m_${day}.csv`, toCsv(rows));
    console.log(`1m ${day}: ${rows.length} bars`);
  }

  // 5m continuous range covering intraday-level lookbacks + premarket warmup
  const fiveM = await fetchBars("5Min", "2026-05-20T08:00:00Z", "2026-06-09T20:00:00Z");
  writeFileSync(`${OUT}/spy_5m.csv`, toCsv(fiveM));
  console.log(`5m 2026-05-20..06-09: ${fiveM.length} bars`);

  // dailies for the 180-day level discovery window
  const daily = await fetchBars("1Day", "2025-11-20T00:00:00Z", "2026-06-09T23:59:00Z");
  writeFileSync(`${OUT}/spy_1d.csv`, toCsv(daily));
  console.log(`1d 2025-11-20..2026-06-09: ${daily.length} bars`);
}

main().catch(e => { console.error(e); process.exit(1); });
