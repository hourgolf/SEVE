// shadow-cron — the Railway cron entrypoint that keeps the §03 shadow panel + the cloud
// ledgers current post-close, MAC-INDEPENDENT. Runs the EXISTING day-report for the last N
// ET days (catch-up covers a missed run) — reusing the exact code, no second implementation,
// no drift. No local-disk archival: the ledgers + the panel live in Supabase now
// (53_forensics_ledgers.sql). Env comes from the Railway service (no --env-file); the spawned
// day-report inherits it.
//
//   Railway cron service — start command:  npm run shadow-cron
//   schedule (UTC):  30 21 * * 1-5   (≈16:30 ET, post-close in BOTH DST seasons)
//   env: copy the worker's (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//        APP_URL, PUSH_SECRET, ALPACA_KEY[_2/_3], ALPACA_SECRET[_2/_3])
//   local test:  tsx --env-file=.env.local scripts/shadow-cron.ts
import { spawnSync } from "child_process";

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const DAYS = Math.max(1, Number(process.env.SHADOW_CRON_DAYS ?? 3));
const now = Date.now();
const tsx = "node_modules/.bin/tsx"; // the repo's tsx (the worker runs via tsx too) — no --env-file (Railway env)

let fail = 0;
for (let i = 0; i < DAYS; i++) {
  const d = ET.format(new Date(now - i * 86_400_000)); // today → back, ET
  console.log(`\n▶ shadow-cron: day-report ${d}`);
  const r = spawnSync(tsx, ["scripts/day-report.ts", "--date", d], { stdio: "inherit", env: process.env });
  if (r.status !== 0 || r.error) { fail++; console.error(`✗ day-report ${d} failed (${r.error?.message ?? `exit ${r.status}`})`); }
}
console.log(`\nshadow-cron done · ${DAYS} day(s) · ${fail ? `${fail} failed` : "all ok"}`);
process.exit(fail ? 1 : 0);
