// SELECT-only postpublication canary. It observes a normal scheduled report;
// it never invokes a producer or writes production data.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assessReportingProducerCanary, type ReportingProducerKind } from "../lib/reporting/producerCanary";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const envFile = resolve(arg("env-file") ?? ".env.local");
if (!existsSync(envFile)) throw new Error(`environment file not found: ${envFile}`);
process.loadEnvFile(envFile);
const daily = arg("daily");
const weekly = arg("weekly");
if ((!daily && !weekly) || (daily && weekly)) throw new Error("provide exactly one of --daily YYYY-MM-DD or --weekly YYYY-MM-DD");
const kind: ReportingProducerKind = daily ? "daily" : "weekly";
const targetDate = daily ?? weekly!;
const out = arg("out") ? resolve(arg("out")!) : null;

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("reporting-producer-canary");
  const table = kind === "daily" ? "daily_reports" : "weekly_reports";
  const dateField = kind === "daily" ? "report_date" : "week_end";
  const [reportRead, historyRead] = await Promise.all([
    sb.from(table).select("*").eq(dateField, targetDate).maybeSingle(),
    sb.from("reporting_publication_versions").select("report_kind,report_date,archived_at,payload")
      .eq("report_kind", kind).eq("report_date", targetDate).order("archived_at", { ascending: true }),
  ]);
  if (reportRead.error) throw new Error(`${table} read failed: ${reportRead.error.message}`);
  if (historyRead.error) throw new Error(`reporting publication history read failed: ${historyRead.error.message}`);
  const result = assessReportingProducerCanary({ kind, targetDate,
    row: reportRead.data as Record<string, unknown> | null,
    publicationVersions: (historyRead.data ?? []) as Array<{ report_kind: string; report_date: string; archived_at: string; payload: Record<string, unknown> }> });
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`); }
  console.log(`reporting-producer-canary: ${result.state.toUpperCase()} · ${kind} ${targetDate} · ${result.checks.filter((check) => check.state === "pass").length}/${result.checks.length} checks`);
  for (const blocker of result.blockers) console.log(`  BLOCK ${blocker}`);
  console.log("  authority: SELECT only · producer invocation 0 · production writes 0");
  if (result.state === "pending") process.exitCode = 2;
  if (result.state === "fail") process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
