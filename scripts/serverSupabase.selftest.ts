import { readFileSync } from "node:fs";
import { createServerSupabaseClient } from "./serverSupabase";

let checks = 0;
const check = (name: string, condition: boolean): void => {
  checks++;
  if (!condition) throw new Error(`server-supabase-selftest failed: ${name}`);
};

const originalUrl = process.env.SUPABASE_URL;
const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

try {
  delete process.env.SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let refused = false;
  try {
    createServerSupabaseClient("selftest");
  } catch (error) {
    refused = String((error as Error).message).includes("SUPABASE_SERVICE_ROLE_KEY");
  }
  check("missing service role fails closed", refused);

  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-selftest-key";
  check("service role constructs a non-persistent client", !!createServerSupabaseClient("selftest"));
} finally {
  if (originalUrl == null) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalPublicUrl == null) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalPublicUrl;
  if (originalServiceKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
}

const criticalScripts = [
  "scripts/preopen-readiness.ts",
  "scripts/health.ts",
  "scripts/sentinel-query-smoke.ts",
  "scripts/day-report.ts",
  "scripts/benched-sim.ts",
  "scripts/one-account-shadow.ts",
  "scripts/ratchet-shadow.ts",
  "scripts/export-quotes.ts",
  "scripts/export-bars.ts",
  "scripts/reconcile-alpaca.ts",
  "scripts/backfill-forensics.ts",
  "scripts/build-training-store.ts",
  "scripts/stairstep-shadow.ts",
  "scripts/mfe-drift.ts",
  "scripts/evening-digest.ts",
  "scripts/a6-watch.ts",
  "scripts/a6-read.ts",
  "scripts/gate-shadow.ts",
  "scripts/sentinel.ts",
  "engine/realsource.ts",
  "engine/optionsource.ts",
];

for (const file of criticalScripts) {
  const source = readFileSync(file, "utf8");
  check(`${file} uses the server-only client`, source.includes("createServerSupabaseClient"));
  check(`${file} never consumes the anonymous key`, !source.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
}

const weeklyReadout = readFileSync("scripts/weekly-readout.ts", "utf8");
check("weekly readout consumes frozen local artifacts", weeklyReadout.includes("ledgerFile") && weeklyReadout.includes("atlasFile"));
check("weekly readout has no production database client", !weeklyReadout.includes("serverSupabase") && !weeklyReadout.includes(".from("));

for (const file of ["app/page.tsx", "lib/supabaseClient.ts", "hooks/useAuth.tsx"]) {
  const source = readFileSync(file, "utf8");
  check(`${file} never imports the server-only helper`, !source.includes("serverSupabase"));
}

console.log(`server-supabase-selftest: ${checks}/${checks} PASS`);
