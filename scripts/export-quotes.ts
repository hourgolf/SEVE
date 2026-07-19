// ============================================================================
//  export-quotes — W3 of the ingest wind-down: archive option_quotes locally
//  BEFORE the 7-day retention cron prunes them (11_retention.sql).
//
//  Why: option_quotes is the desk's dominant table (~94MB/7d) and its ONLY copy
//  of the live NBBO tape — the day-report's peaks/giveback, the mfe-drift
//  monitor, and every fill forensic (the Nakamoto check was only possible
//  because the tape still existed) all die at the retention horizon. This dumps
//  verbatim rows per ET day to data/quotes-archive/<YYYY-MM-DD>.json.gz
//  (gzipped — quotes are ~10-15MB/day raw, ~2-3MB gz).
//
//  · Idempotent like export-bars: existing days skipped, the LAST archived day
//    re-exported (it may have been partial); --force rewrites all.
//  · gitignored — local research data. ⚠ UNLIKE bars, pruned quotes are NOT
//    reconstructable (Alpaca keeps no historical NBBO on our plan; Databento
//    re-buys cost real $) — so the WEEKLY RITUAL MATTERS: run this alongside
//    export-bars at least every ~5 days (retention is 7).
//
//    npm run export-quotes                      (full window now in the DB)
//    npm run export-quotes -- --from 2026-06-08 --force
// ============================================================================

import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createServerSupabaseClient } from "./serverSupabase";

function loadEnv() { try { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const sb = createServerSupabaseClient("export-quotes");

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FORCE = process.argv.includes("--force");
const FROM = arg("from", "2000-01-01");
const TO = arg("to", "2099-01-01");

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET.format(new Date(iso));
const DIR = "data/quotes-archive";

async function main() {
  console.log(`\nexport-quotes → ${DIR}/ (verbatim option_quotes rows, per ET day, gzipped)`);
  mkdirSync(DIR, { recursive: true });
  const existing = new Set(readdirSync(DIR).filter((f) => f.endsWith(".json.gz")).map((f) => f.slice(0, 10)));
  const last = [...existing].sort().pop();
  if (last) existing.delete(last); // the last archived day may have been partial — re-export

  let rows = 0, files = 0, skipped = 0, bytes = 0;
  const byDay = new Map<string, unknown[]>();

  // KEYSET pagination on the pkey (id) — OFFSET pagination dies on this table
  // (~600k rows: PostgREST re-scans from row 0 per page → statement timeout at
  // ~300k). .gt(id) is index-backed and constant-time per page; the whole window
  // (~7d) fits comfortably in memory, so days flush once at the end.
  const PAGE = 1000;
  let lastId: string | number | null = null;
  let scanned = 0;
  for (;;) {
    let q = sb.from("option_quotes").select("*").order("id", { ascending: true }).limit(PAGE);
    if (lastId != null) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`option_quotes: ${error.message}`);
    const batch = (data ?? []) as Array<{ id: string | number; captured_at: string }>;
    for (const r of batch) (byDay.get(etDate(r.captured_at)) ?? byDay.set(etDate(r.captured_at), []).get(etDate(r.captured_at))!).push(r);
    scanned += batch.length;
    if (scanned % 100_000 < PAGE && scanned >= PAGE) console.log(`  …${scanned.toLocaleString()} rows scanned`);
    if (!batch.length || batch.length < PAGE) break;
    lastId = batch[batch.length - 1].id;
  }

  for (const [date, qs] of [...byDay.entries()].sort()) {
    if (date < FROM || date > TO) continue;
    if (!FORCE && existing.has(date)) { skipped++; continue; }
    const gz = gzipSync(Buffer.from(JSON.stringify(qs)));
    writeFileSync(`${DIR}/${date}.json.gz`, gz);
    files++; rows += qs.length; bytes += gz.length;
  }
  console.log(`  wrote ${files} day files (${rows.toLocaleString()} rows, ${(bytes / 1e6).toFixed(1)}MB gz) · ${skipped} already archived`);
  console.log(`  ⚠ ritual: run weekly with export-bars — retention prunes quotes at 7d and they are NOT reconstructable.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
