// ============================================================================
//  export-bars — W1 of the ingest wind-down: archive underlying_bars locally.
//
//  Dumps the 1-min tape per ET day to data/bars-archive/<SYM>/<YYYY-MM-DD>.json
//  (verbatim rows: ts,open,high,low,close,volume,vwap — exactly what the DB
//  serves), so the research spine (engine/realsource.ts) can read history from
//  disk and the DB can hold only a rolling window (32_bars_retention.sql).
//
//  · Idempotent: existing day files are skipped, EXCEPT the last archived day
//    per symbol (re-exported in case it was partial). --force rewrites all.
//  · gitignored like data/databento* — local research data, ~1MB/month/symbol.
//  · Worst case the archive is reconstructable from Alpaca (scripts/
//    backfill-bars.ts) — bars are free history, unlike option NBBO.
//
//    npm run export-bars                       (all symbols, full history)
//    npm run export-bars -- --underlying QQQ --from 2026-03-01 --force
// ============================================================================

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { pageAll } from "../engine/pageAll";

function loadEnv() { try { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FORCE = process.argv.includes("--force");
const FROM = arg("from", "2000-01-01");
const TO = arg("to", "2099-01-01");
const ONLY = arg("underlying", "").toUpperCase();

export interface ArchivedBar { ts: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; vwap: number | null }

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET.format(new Date(iso));

async function symbols(): Promise<string[]> {
  if (ONLY) return [ONLY];
  // distinct symbols from the daily view. It is one row per symbol per session (32_bars_retention.sql:
  // the live 60d rollup ∪ the never-pruned daily_bars_hist), so it ALREADY exceeds PostgREST's ~1000-row
  // cap — an un-ranged select was silently truncated, and whether every LIVE symbol survived the dedup
  // hung on unspecified executor ordering. Page to exhaustion under a TOTAL order ((symbol, ts) is unique
  // per row) so no traded symbol can be dropped from the nightly TIER-1 archive.
  const rows = await pageAll<{ symbol: string }>((from) => sb
    .from("underlying_bars_daily")
    .select("symbol")
    .order("symbol", { ascending: true })
    .order("ts", { ascending: true }));
  return [...new Set(rows.map((r) => r.symbol))].sort();
}

async function exportSymbol(sym: string): Promise<void> {
  const dir = `data/bars-archive/${sym}`;
  mkdirSync(dir, { recursive: true });
  const existing = new Set(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, 10)));
  // always re-export the LAST archived day (it may have been partial when written)
  const last = [...existing].sort().pop();
  if (last) existing.delete(last);

  let rows = 0, files = 0, skipped = 0;
  let byDay = new Map<string, ArchivedBar[]>();
  const flush = (uptoExclusive: string | null) => {
    for (const [date, bars] of [...byDay.entries()].sort()) {
      if (uptoExclusive && date >= uptoExclusive) continue; // day may still be streaming in
      if (date < FROM || date > TO) { byDay.delete(date); continue; }
      if (!FORCE && existing.has(date)) { skipped++; byDay.delete(date); continue; }
      writeFileSync(`${dir}/${date}.json`, JSON.stringify(bars));
      files++; rows += bars.length;
      byDay.delete(date);
    }
  };

  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("underlying_bars")
      .select("ts,open,high,low,close,volume,vwap")
      .eq("symbol", sym)
      .order("ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`underlying_bars ${sym}: ${error.message}`);
    const batch = (data ?? []) as ArchivedBar[];
    let lastDate: string | null = null;
    for (const r of batch) {
      const d = etDate(r.ts);
      lastDate = d;
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
    }
    // a day is complete once the scan has moved past it
    flush(lastDate);
    if (batch.length < PAGE) { flush(null); break; }
  }
  console.log(`  ${sym}: wrote ${files} day files (${rows.toLocaleString()} rows) · ${skipped} already archived`);
}

async function main() {
  console.log(`\nexport-bars → data/bars-archive/ (verbatim 1-min rows, per ET day)`);
  for (const sym of await symbols()) await exportSymbol(sym);
  console.log(`done.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
