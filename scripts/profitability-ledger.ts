// ============================================================================
// SELECT-only canonical profitability snapshot and report.
//
// Market-hours posture:
// - no option quote reads
// - no writes/RPCs/functions
// - bounded sequential reads of durable evidence tables
// - local, gitignored artifacts only
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import {
  buildProfitabilityLedger,
  type ProfitabilityAccountRow,
  type ProfitabilityExecutionQualityRow,
  type ProfitabilityExecutionRouteRow,
  type ProfitabilityLedgerInput,
  type ProfitabilityManagerShadowRow,
  type ProfitabilityOutcomeRow,
  type ProfitabilityPositionRow,
} from "../lib/profitability/profitabilityLedger";
import { buildProfitabilityReport } from "../lib/profitability/profitabilityMetrics";
import { renderProfitabilityMarkdown } from "../lib/profitability/profitabilityReport";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const envFile = arg("env-file") ?? process.env.SEVE_ENV_FILE ?? null;
if (envFile) {
  const path = resolve(envFile);
  if (!existsSync(path)) throw new Error(`environment file not found: ${path}`);
  process.loadEnvFile(path);
} else if (existsSync(resolve(".env.local"))) {
  process.loadEnvFile(resolve(".env.local"));
}

const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/profitability-ledger");
const AS_OF_DATE_ET = arg("as-of");
const SNAPSHOT_FILE = arg("snapshot-file");
const READ_OPTIONS = {
  pageSize: 250,
  attempts: 3,
  retryDelaysMs: [250, 750],
  timeoutMs: 15_000,
} as const;

interface StrategistRow {
  id: string;
  slug: string;
}

interface PositionDbRow extends Omit<ProfitabilityPositionRow, "channel_slug"> {}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function timed<T>(
  label: string,
  read: () => Promise<T>,
  timings: Record<string, number>,
): Promise<T> {
  const started = Date.now();
  const value = await read();
  timings[label] = Date.now() - started;
  return value;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readRoutes(
  sb: ReturnType<typeof createServerSupabaseClient>,
  column: "position_id" | "opportunity_id",
  ids: readonly string[],
): Promise<ProfitabilityExecutionRouteRow[]> {
  const rows: ProfitabilityExecutionRouteRow[] = [];
  for (const batch of chunks([...new Set(ids)].sort(), 75)) {
    if (!batch.length) continue;
    rows.push(...await pageAll<ProfitabilityExecutionRouteRow>((from) => sb
      .from("execution_observations")
      .select("id,position_id,opportunity_id,account_id,event_at")
      .in(column, batch)
      .not("account_id", "is", null)
      .order("event_at", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 50_000,
    }));
  }
  return rows;
}

async function main(): Promise<void> {
  const timings: Record<string, number> = {};
  let input: ProfitabilityLedgerInput;
  let posture: "select_only_local_snapshot" | "local_snapshot_replay";
  if (SNAPSHOT_FILE) {
    const snapshotPath = resolve(SNAPSHOT_FILE);
    const started = Date.now();
    input = JSON.parse(readFileSync(snapshotPath, "utf8")) as ProfitabilityLedgerInput;
    timings.localSnapshotReplay = Date.now() - started;
    posture = "local_snapshot_replay";
    console.log(`profitability-ledger: local snapshot replay · ${snapshotPath}`);
  } else {
    const sb = createServerSupabaseClient("profitability-ledger");
    posture = "select_only_local_snapshot";
    console.log("profitability-ledger: SELECT-only durable evidence snapshot");

    const accounts = await timed("accounts", async () =>
    pageAll<ProfitabilityAccountRow>((from) => sb
      .from("accounts")
      .select("id,name,mode")
      .eq("mode", "paper")
      .order("name", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 1_000,
    }), timings);

    const strategists = await timed("strategists", async () =>
    pageAll<StrategistRow>((from) => sb
      .from("strategists")
      .select("id,slug")
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 5_000,
    }), timings);
  const slugByStrategist = new Map(strategists.map((row) => [row.id, row.slug]));

    const positionRows = await timed("positions", async () =>
    pageAll<PositionDbRow>((from) => sb
      .from("positions")
      .select([
        "id", "strategist_id", "underlying", "occ_symbol", "status", "qty",
        "avg_entry_price", "realized_pnl", "opened_at", "closed_at", "close_reason",
        "peak_mark", "trough_mark", "runner_of", "entry_reason", "entry_features",
        "channel_spec_version_id", "release_manifest_id", "configuration_epoch_id",
      ].join(","))
      .order("opened_at", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 10_000,
    }), timings);
    const positions: ProfitabilityPositionRow[] = positionRows.map((row) => ({
      ...row,
      channel_slug: slugByStrategist.get(row.strategist_id) ?? `unknown:${row.strategist_id}`,
    }));

    const outcomes = await timed("position_outcome_events", async () =>
    pageAll<ProfitabilityOutcomeRow>((from) => sb
      .from("position_outcome_events")
      .select("id,event_kind,event_at,position_id,parent_position_id,opportunity_id")
      .order("event_at", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 20_000,
    }), timings);

    const executionQuality = await timed("execution_quality_receipts", async () =>
    pageAll<ProfitabilityExecutionQualityRow>((from) => sb
      .from("execution_quality_receipts")
      .select("id,position_id,account_id,trigger_kind,fill_observed_at,leakage_usd")
      .order("fill_observed_at", { ascending: true })
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 10_000,
    }), timings);

    const managerShadow = await timed("manager_shadow_runs", async () =>
    pageAll<ProfitabilityManagerShadowRow>((from) => sb
      .from("manager_shadow_runs")
      .select([
        "id", "position_id", "manager_id", "manager_policy_version",
        "shadow_book_version", "status", "terminal_at", "terminal_pnl",
        "actual_realized_pnl", "censored_at", "censor_code",
      ].join(","))
      .order("id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 50_000,
    }), timings);

    const equityDaily = await timed("equity_daily", async () =>
    pageAll<{ et_date: string; nav: number | string }>((from) => sb
      .from("equity_daily")
      .select("et_date,nav")
      .order("et_date", { ascending: true }), {
      ...READ_OPTIONS,
      max: 1_000,
    }), timings);

    const positionIds = positions.map((row) => row.id);
    const opportunityIds = [
      ...outcomes.flatMap((row) => row.opportunity_id ? [row.opportunity_id] : []),
      ...positions.flatMap((row) => {
        const opportunity = row.entry_features?.opportunity_id;
        return typeof opportunity === "string" ? [opportunity] : [];
      }),
    ];
    const executionRoutes = await timed("immutable_execution_routes", async () => {
      const rows = [
        ...await readRoutes(sb, "position_id", positionIds),
        ...await readRoutes(sb, "opportunity_id", opportunityIds),
      ];
      return [...new Map(rows.map((row) => [row.id, row])).values()]
        .sort((left, right) =>
          Date.parse(left.event_at) - Date.parse(right.event_at)
          || left.id.localeCompare(right.id));
    }, timings);

    input = {
      accounts,
      positions,
      outcomes,
      executionRoutes,
      executionQuality,
      managerShadow,
      equityDaily,
    };
  }
  const ledger = buildProfitabilityLedger(input);
  const report = buildProfitabilityReport(ledger, AS_OF_DATE_ET ?? undefined);
  const generatedAt = new Date().toISOString();
  const snapshotJson = `${JSON.stringify(input, null, 2)}\n`;
  const ledgerJson = `${JSON.stringify({ ledger, report }, null, 2)}\n`;
  const markdown = renderProfitabilityMarkdown(report, generatedAt);
  const receipt = {
    schemaVersion: 1,
    generatedAt,
    asOfDateEt: report.asOfDateEt,
    posture,
    excludedSources: ["option_quotes", "option_quote_archive", "underlying_bars"],
    timingsMs: timings,
    sourceRows: ledger.evidence.sourceRows,
    logicalTrades: ledger.logicalTrades.length,
    completeClosedTrades: ledger.evidence.completeClosedTrades,
    immutableRouteClosedTrades: ledger.evidence.immutableRouteClosedTrades,
    exactConfigurationClosedTrades: ledger.evidence.exactConfigurationClosedTrades,
    structuralOnlyClosedTrades: ledger.evidence.structuralOnlyClosedTrades,
    censoredTrades: ledger.evidence.censoredTrades,
    openTrades: ledger.evidence.openTrades,
    blockingIssues: ledger.evidence.blockingIssues,
    warnings: ledger.evidence.warnings,
    snapshotSha256: sha256(snapshotJson),
    ledgerSha256: sha256(ledgerJson),
    reportSha256: sha256(markdown),
    productionWrites: 0,
    optionQuoteRowsRead: 0,
    policyChangeAuthorized: false,
    productionChangeAuthorized: false,
    orderAuthority: false,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "snapshot.json"), snapshotJson);
  writeFileSync(resolve(OUTPUT_DIR, "ledger.json"), ledgerJson);
  writeFileSync(resolve(OUTPUT_DIR, "report.md"), markdown);
  writeFileSync(resolve(OUTPUT_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

  console.log(`  source rows: ${JSON.stringify(ledger.evidence.sourceRows)}`);
  console.log(`  logical trades: ${ledger.logicalTrades.length} · complete ${ledger.evidence.completeClosedTrades} · exact ${ledger.evidence.exactConfigurationClosedTrades} · immutable-route ${ledger.evidence.immutableRouteClosedTrades} · structural-only ${ledger.evidence.structuralOnlyClosedTrades} · open ${ledger.evidence.openTrades} · censored ${ledger.evidence.censoredTrades}`);
  console.log(`  broker NAV days: ${ledger.brokerNavDays.length}`);
  console.log(`  manager paths: ${ledger.managerCounterfactualPaths.length}`);
  console.log(`  query timings ms: ${JSON.stringify(timings)}`);
  console.log(`  output: ${OUTPUT_DIR}`);
  console.log(`  receipt: ${receipt.ledgerSha256}`);
  if (ledger.evidence.blockingIssues.length) {
    console.error(`profitability-ledger: FAIL CLOSED · ${ledger.evidence.blockingIssues.length} integrity issue(s)`);
    process.exitCode = 1;
  } else {
    console.log("profitability-ledger: PASS · canonical local report generated");
  }
}

void main().catch((error) => {
  console.error(`profitability-ledger failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
