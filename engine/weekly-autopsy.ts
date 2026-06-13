// ============================================================================
//  npm run weekly-autopsy  [-- --weekEnd YYYY-MM-DD] [--regen] [--json]
//
//  THIN CLIENT (2026-06-13) — RETIRED the local re-implementation. The weekly
//  autopsy is now generated SOLELY by the `weekly-autopsy` edge function (the
//  canonical, doctrine + roster + temporal-guard + unified-naming path the
//  dashboard reads). This CLI used to be a parallel ~300-line aggregator that
//  drifted out of sync; it's been replaced with a read of the stored report so
//  there's ONE source of truth and no future drift.
//
//    npm run weekly-autopsy                          # print the latest weekly report
//    npm run weekly-autopsy -- --weekEnd 2026-06-12  # a specific week (Friday ET)
//    npm run weekly-autopsy -- --weekEnd 2026-06-12 --regen   # ask the edge fn to (re)build
//    npm run weekly-autopsy -- --json                # raw {digest,narrative} JSON
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() { try { for (const line of readFileSync(".env.local", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch { /* ignore */ } }
loadEnv();
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : ""; };
const REGEN = process.argv.includes("--regen"), JSON_OUT = process.argv.includes("--json");

async function main() {
  const weekEnd = arg("weekEnd");
  if (REGEN) {
    const r = await fetch(`${URL}/functions/v1/weekly-autopsy`, { method: "POST", headers: { authorization: `Bearer ${ANON}`, "content-type": "application/json" }, body: JSON.stringify(weekEnd ? { weekEnd } : {}) });
    console.error(`  regen → ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const cols = "week_start,week_end,markdown,digest,narrative";
  const q = weekEnd
    ? sb.from("weekly_reports").select(cols).eq("week_end", weekEnd).limit(1)
    : sb.from("weekly_reports").select(cols).order("week_end", { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  const row = (data ?? [])[0] as { week_start: string; week_end: string; markdown: string | null; digest: unknown; narrative: unknown } | undefined;
  if (!row) { console.error(`no weekly report for ${weekEnd || "any week"} — (re)generate it with:  npm run weekly-autopsy${weekEnd ? ` -- --weekEnd ${weekEnd}` : ""} --regen  (note: the cron only runs Fri after close)`); process.exit(1); }
  if (JSON_OUT) { console.log(JSON.stringify({ weekStart: row.week_start, weekEnd: row.week_end, digest: row.digest, narrative: row.narrative }, null, 2)); return; }
  console.log(row.markdown ?? "(no markdown stored for this report)");
}
main().catch((e) => { console.error(e); process.exit(1); });
