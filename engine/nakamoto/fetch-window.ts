/**
 * Bulk IEX bar fetch for Phase-2 backtest windows of the Nakamoto strategy.
 * His bot consumes IEX-feed bars (LOOP_FACTS §3) — entries are simulated on the
 * same feed; only the option fills come from Databento NBBO.
 *
 * Writes (idempotent — existing files are skipped):
 *   data/handoff-verify/iex/spy_1d_all.csv     dailies 2023-09-01..2026-06-09 (levels lookback)
 *   data/handoff-verify/iex/spy_1m_<day>.csv   per session day in [--from, --to]
 *   data/handoff-verify/iex/spy_5mw_<day>.csv  per day in [--from − 20d, --to] (intraday levels)
 *
 * Run: npm run nakamoto-fetch-window -- --from 2024-05-01 --to 2024-08-31
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";

const KEY = process.env.ALPACA_KEY!;
const SECRET = process.env.ALPACA_SECRET!;
if (!KEY || !SECRET) throw new Error("ALPACA_KEY/ALPACA_SECRET missing (source .env.local)");

const HDRS = { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET };
const BASE = "https://data.alpaca.markets/v2/stocks/SPY/bars";
const OUT = "data/handoff-verify/iex";

type Raw = { t: string; o: number; h: number; l: number; c: number; v: number; n: number; vw: number };

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`--${name} required`);
  return process.argv[i + 1];
}

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

const HEADER = "timestamp,open,high,low,close,volume,trade_count,vwap";
const toLine = (r: Raw) => [r.t, r.o, r.h, r.l, r.c, r.v, r.n, r.vw].join(",");

/** Split a multi-day fetch into per-day CSVs keyed by the bar's UTC date
 * (== ET session date for all 04:00–20:00 ET bars). Skips existing files. */
function writePerDay(rows: Raw[], prefix: string): number {
  const byDay = new Map<string, Raw[]>();
  for (const r of rows) {
    const d = r.t.slice(0, 10);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
  }
  let written = 0;
  for (const [d, dayRows] of byDay) {
    const p = `${OUT}/${prefix}_${d}.csv`;
    if (existsSync(p)) continue;
    writeFileSync(p, [HEADER, ...dayRows.map(toLine)].join("\n"));
    written++;
  }
  return written;
}

function minusDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const from = arg("from");
  const to = arg("to");

  const dPath = `${OUT}/spy_1d_all.csv`;
  if (!existsSync(dPath)) {
    const daily = await fetchBars("1Day", "2023-09-01T00:00:00Z", "2026-06-09T23:59:00Z");
    writeFileSync(dPath, [HEADER, ...daily.map(toLine)].join("\n"));
    console.log(`1d all: ${daily.length} bars`);
  }

  const from5 = minusDays(from, 20);
  const five = await fetchBars("5Min", `${from5}T00:00:00Z`, `${to}T23:59:00Z`);
  console.log(`5m ${from5}..${to}: ${five.length} bars → ${writePerDay(five, "spy_5mw")} new files`);

  const one = await fetchBars("1Min", `${from}T00:00:00Z`, `${to}T23:59:00Z`);
  console.log(`1m ${from}..${to}: ${one.length} bars → ${writePerDay(one, "spy_1m")} new files`);
}

main().catch(e => { console.error(e); process.exit(1); });
