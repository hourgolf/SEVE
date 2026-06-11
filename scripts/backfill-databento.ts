// ============================================================================
//  scripts/backfill-databento.ts   ·   run: npm run backfill:databento -- --from … --to …
//
//  Pulls REAL 1-minute consolidated NBBO (cbbo-1m) for SPY 0DTE options from
//  Databento OPRA into a LOCAL cache (data/databento/<date>.json) — replacing the
//  modeled 3% spread in the backtest with honest bid/ask. Stored locally (NOT
//  Supabase — the free tier is 0.5 GB and this is transient research data).
//
//  Scoped to ATM ±$window strikes per day (same scope as the Alpaca backfill, so
//  the A/B is apples-to-apples) → trivial cost (~$0.0001/symbol-day; full window
//  ≈ $0.20, well inside the $125 credit). Needs DATABENTO_API_KEY in .env.local.
//
//  Each cached record: { occ_symbol, ts(ms), bid, ask, strike, opt_type }.
// ============================================================================

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { archivedDays, readArchivedDay } from "../engine/realsource";

function loadEnv() { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } }
loadEnv();
const KEY = process.env.DATABENTO_API_KEY;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const AUTH = "Basic " + Buffer.from((KEY ?? "") + ":").toString("base64");
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FROM = arg("from", "2026-03-01"), TO = arg("to", "2026-06-01"), WINDOW = Number(arg("window", "6"));
// --underlying SPY|QQQ: which ticker's 0DTE chain to pull. SPY keeps the original
// data/databento dir (backward-compatible); other tickers get a `-<ticker>` suffix so
// caches never collide. The OSI root + underlying_bars filter + OCC prefix all follow.
const UNDERLYING = arg("underlying", "SPY").toUpperCase();
const tickerSuffix = UNDERLYING === "SPY" ? "" : "-" + UNDERLYING.toLowerCase();
// --dte N: also fetch contracts expiring up to N trading days AFTER each session
// (so a position opened today in a 1–2DTE contract can be marked through expiry).
// 0 = 0DTE only (the default single-expiration cache). When >0, defaults the
// output to a SEPARATE dir so the validated 0DTE cache isn't clobbered.
const DTE = Number(arg("dte", "0"));
const OUTDIR = arg("outdir", (DTE > 0 ? "data/databento-mdte" : "data/databento") + tickerSuffix);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function etParts(ms: number): { date: string; min: number } { const p: Record<string, string> = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; let h = Number(p.hour); if (h === 24) h = 0; return { date: `${p.year}-${p.month}-${p.day}`, min: h * 60 + Number(p.minute) }; }
const addDay = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const osi = (expISO: string, strike: number, type: "call" | "put") => { const [y, m, d] = expISO.split("-"); return UNDERLYING.padEnd(6) + y.slice(2) + m + d + (type === "call" ? "C" : "P") + String(Math.round(strike * 1000)).padStart(8, "0"); };

interface DayRange { date: string; lo: number; hi: number }
async function dayRanges(sb: ReturnType<typeof createClient>): Promise<DayRange[]> {
  const acc = new Map<string, { lo: number; hi: number }>();
  const fold = (ts: string, low: unknown, high: unknown) => {
    if (low == null || high == null) return;
    const { date, min } = etParts(Date.parse(ts));
    if (min < 570 || min >= 960) return;
    const c = acc.get(date); const lo = Number(low), hi = Number(high);
    if (!c) acc.set(date, { lo, hi }); else { c.lo = Math.min(c.lo, lo); c.hi = Math.max(c.hi, hi); }
  };
  // W1 ingest wind-down: history comes from the local archive (the DB holds only
  // a rolling window post 32_bars_retention.sql); the last archived day defers
  // to the DB. Without an archive this is the original full-table scan.
  const days = archivedDays(UNDERLYING);
  let floorIso: string | null = null;
  if (days.length > 1) {
    for (const d of days.slice(0, -1)) for (const r of readArchivedDay(UNDERLYING, d)) fold(r.ts, r.low, r.high);
    const lastRows = readArchivedDay(UNDERLYING, days[days.length - 1]);
    if (lastRows.length) floorIso = lastRows[0].ts;
  }
  for (let from = 0; ; from += 1000) {
    let q = sb.from("underlying_bars").select("ts,low,high").eq("symbol", UNDERLYING).order("ts", { ascending: true });
    if (floorIso) q = q.gte("ts", floorIso);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error("underlying_bars: " + error.message);
    const rows = (data ?? []) as { ts: string; low: number; high: number }[];
    for (const r of rows) fold(r.ts, r.low, r.high);
    if (rows.length < 1000) break;
  }
  return [...acc.entries()].map(([date, r]) => ({ date, ...r })).filter((d) => d.date >= FROM && d.date <= TO).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchDay(symbols: string[], day: string): Promise<Record<string, unknown>[]> {
  const q = new URLSearchParams({ dataset: "OPRA.PILLAR", symbols: symbols.join(","), schema: "cbbo-1m", stype_in: "raw_symbol", start: day, end: addDay(day), encoding: "json", pretty_px: "true", map_symbols: "true" });
  const r = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${q}`, { headers: { Authorization: AUTH } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 200)}`);
  const out: Record<string, unknown>[] = [];
  for (const line of t.trim().split("\n")) {
    if (!line) continue;
    const j = JSON.parse(line);
    const lv = j.levels?.[0]; if (!lv || lv.bid_px == null || lv.ask_px == null) continue;        // skip non-quoting snapshots
    const bid = Number(lv.bid_px), ask = Number(lv.ask_px); if (!(ask > 0) || !(bid >= 0) || ask < bid) continue;
    const sym: string = j.symbol; if (!sym) continue;                                              // OSI: "SPY   260529C00758000"
    const yymmdd = sym.slice(6, 12), cp = sym.slice(12, 13), strike = Number(sym.slice(13)) / 1000;
    const occ = UNDERLYING + yymmdd + cp + sym.slice(13);
    out.push({ occ_symbol: occ, ts: Math.round(Number(j.ts_recv) / 1e6), bid, ask, strike, opt_type: cp === "C" ? "call" : "put" });
  }
  return out;
}

async function main() {
  if (!KEY) throw new Error("Set DATABENTO_API_KEY in .env.local");
  if (!SB_URL || !SB_ANON) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY");
  const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
  mkdirSync(OUTDIR, { recursive: true });
  const days = await dayRanges(sb);
  const dteLabel = DTE > 0 ? `0–${DTE}DTE (next ${DTE} expiries)` : "0DTE";
  console.log(`backfill-databento: ${days.length} trading days (${days[0]?.date} → ${days[days.length - 1]?.date}), range ±$${WINDOW}, ${dteLabel} cbbo-1m → ${OUTDIR}/`);
  let grand = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const loK = Math.floor(d.lo) - WINDOW, hiK = Math.ceil(d.hi) + WINDOW;
    // expirations to fetch on this session day: today + the next DTE trading days
    // (the days array IS the trading calendar, so index +dte skips weekends/holidays).
    const exps: string[] = [];
    for (let dte = 0; dte <= DTE; dte++) { const e = days[i + dte]?.date; if (e) exps.push(e); }
    const symbols: string[] = [];
    for (const exp of exps) for (let k = loK; k <= hiK; k++) { symbols.push(osi(exp, k, "call"), osi(exp, k, "put")); }
    try {
      const rows = await fetchDay(symbols, d.date);
      writeFileSync(`${OUTDIR}/${d.date}.json`, JSON.stringify(rows));
      grand += rows.length;
      console.log(`  ${d.date}  strikes ${loK}-${hiK} × exp[${exps.join(",")}] (${symbols.length} syms) → ${rows.length} quote-bars`);
    } catch (e) {
      console.warn(`  ${d.date}: ${(e as Error).message}`);
    }
    await sleep(120);
  }
  console.log(`backfill-databento: done · ${grand} real-NBBO quote-bars cached locally.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
