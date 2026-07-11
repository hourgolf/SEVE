// ============================================================================
//  verify-quotes-archive — golden check for the IRREPLACEABLE option_quotes
//  archive (data/quotes-archive/<YYYY-MM-DD>.json.gz, written by export-quotes).
//
//  Unlike bars, pruned option_quotes are NOT reconstructable (7d retention,
//  11_retention.sql; no historical NBBO on our Alpaca plan). export-quotes writes
//  each day's gz with NO post-write integrity check and marks it archived forever
//  (its idempotency skip means a non-last partial/corrupt day is never re-done) —
//  so a truncated gz is discovered only when a consumer gunzips it, often after the
//  DB source is already 7d-pruned. This is that missing verification seam.
//
//  Per recently-banked day it checks (READ-ONLY):
//   1. INTEGRITY: the gz decompresses + parses (a truncated write throws LOUD).
//   2. NON-TRIVIAL: a real session has thousands of quote rows — a near-empty
//      file is a partial capture.
//   3. DAY-BOUNDARY: every row's ET capture date matches the file's date (the
//      per-day bucketing export-quotes guarantees — a mismatch means corruption).
//   4. DB PARITY (best-effort, while the 7d window still overlaps): the archived
//      row count must not fall materially short of what the DB still holds for that
//      ET day — catches a partial export that banked only part of a session.
//
//  The single LATEST archived day is treated as possibly-partial (export re-does it
//  each run): integrity + boundary are still checked, but the non-empty floor and
//  DB-parity are reported, not failed.
//
//  Off-hours friendly; needs the anon key (.env.local) only for the DB-parity leg —
//  without it, checks 1-3 still run.
//
//    npx tsx scripts/verify-quotes-archive.ts            (last 8 banked days)
//    npx tsx scripts/verify-quotes-archive.ts -- --days 12
// ============================================================================

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

function loadEnv() { try { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* */ } }
loadEnv();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const DIR = "data/quotes-archive";
const MIN_ROWS = 100;      // a real session is thousands of rows; below this = near-empty/partial
const PARITY_FLOOR = 0.98; // archive must hold ≥ 98% of the rows the DB still has for the ET day
const di = process.argv.indexOf("--days");
const DAYS = di >= 0 && process.argv[di + 1] ? Math.max(1, Number(process.argv[di + 1])) : 8;

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDate = (iso: string) => ET.format(new Date(iso));

// UTC offset (ms) that America/New_York is ahead of UTC at a given instant (negative — ET is behind).
function etOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  let hour = Number(p.hour); if (hour === 24) hour = 0;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second)) - utcMs;
}
// [start, end) UTC ISO bounds of an ET calendar day (DST-correct via the offset at ET-midnight).
function etDayRangeUtc(dateET: string): { start: string; end: string } {
  const [y, m, d] = dateET.split("-").map(Number);
  const naiveMidUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const startMs = naiveMidUtc - etOffsetMs(naiveMidUtc); // true ET-midnight as a UTC instant
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 86_400_000).toISOString() };
}

async function main() {
  if (!existsSync(DIR)) { console.error(`\n  ✗ ${DIR} does not exist — nothing archived to verify.\n`); process.exit(1); }
  const days = readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).map((f) => f.slice(0, 10)).sort();
  if (!days.length) { console.log(`\n  ⚠ no quotes archived in ${DIR} yet — nothing to verify.\n`); return; }
  const latest = days[days.length - 1];
  const check = days.slice(-DAYS);

  const sb = URL_ && KEY_ ? createClient(URL_, KEY_, { auth: { persistSession: false } }) : null;
  console.log(`\nverify-quotes-archive → ${DIR}/ · checking ${check.length} recent day(s) (of ${days.length} banked)`);
  if (!sb) console.log(`  (no anon key in .env.local — DB-parity leg skipped; integrity/boundary/non-empty still run)`);
  console.log("");

  let fail = 0;
  for (const date of check) {
    const isLatest = date === latest;
    let rows: Array<{ captured_at: string }>;
    try {
      rows = JSON.parse(gunzipSync(readFileSync(`${DIR}/${date}.json.gz`)).toString()) as Array<{ captured_at: string }>;
    } catch (e) {
      console.log(`  ${date} FAIL ✗  gz decompress/parse error — ${(e as Error).message}`);
      fail++; continue;
    }
    const n = rows.length;
    let badDay = 0;
    for (const r of rows) if (!r.captured_at || etDate(r.captured_at) !== date) badDay++;

    // DB parity — best-effort, and only for a settled (non-latest) day the DB still overlaps.
    let dbNote = "";
    let parityFail = false;
    if (sb && !isLatest) {
      const { start, end } = etDayRangeUtc(date);
      const { count, error } = await sb.from("option_quotes").select("*", { count: "exact", head: true }).gte("captured_at", start).lt("captured_at", end);
      if (error) dbNote = ` · db parity skipped (${error.message.slice(0, 40)})`;
      else if (count == null || count === 0) dbNote = ` · no DB overlap (pruned)`;
      else { parityFail = n < Math.floor(count * PARITY_FLOOR); dbNote = ` · db ${count.toLocaleString()} (${((n / count) * 100).toFixed(1)}% archived)${parityFail ? " ⚠SHORT" : ""}`; }
    }

    const emptyFail = !isLatest && n < MIN_ROWS;
    const boundaryFail = badDay > 0;
    const ok = !emptyFail && !boundaryFail && !parityFail;
    if (!ok) fail++;
    console.log(`  ${date} ${ok ? "PASS ✓" : "FAIL ✗"}  ${n.toLocaleString().padStart(8)} rows${boundaryFail ? ` · ${badDay} off-day rows!` : ""}${emptyFail ? " · near-EMPTY!" : ""}${dbNote}${isLatest ? "  (latest — partial-tolerant)" : ""}`);
  }

  if (fail) { console.error(`\n  ${fail} day(s) FAILED — the irreplaceable NBBO tape may be corrupt/partial. Re-export with --force while the DB still holds the day.\n`); process.exit(1); }
  console.log(`\n  golden PASS — every checked day decompresses, is non-trivial, day-clean, and ties to the DB where it still overlaps.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
