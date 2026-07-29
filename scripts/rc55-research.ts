// ============================================================================
// SELECT-only RC5.5 research snapshot and review packet.
//
// This command reads compact durable evidence only. It never reads the options
// quote corpus and owns no mutation, proposal, deployment, activation, or
// order surface.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import type { ProfitabilityLedger } from "../lib/profitability/profitabilityLedger";
import type { ProfitabilityReport } from "../lib/profitability/profitabilityMetrics";
import {
  buildRc55ResearchPacket,
  type Rc55DailyBarRow,
  type Rc55ExactSourceAvailability,
  type Rc55ResearchInput,
  type Rc55VirtualTradeRow,
} from "../lib/research/rc55Research";
import { renderRc55ResearchMarkdown } from "../lib/research/rc55ResearchReport";
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

const OUTPUT_DIR = resolve(arg("out-dir") ?? "data/rc55-research");
const LEDGER_FILE = resolve(arg("ledger-file") ?? "data/profitability-ledger-final/ledger.json");
const SNAPSHOT_FILE = arg("snapshot-file");
const AS_OF_DATE_ET = arg("as-of") ?? "2026-07-28";
const VIRTUAL_START_ISO = "2026-07-01T04:00:00.000Z";
const BAR_START_ISO = "2026-06-01T04:00:00.000Z";
const READ_OPTIONS = {
  pageSize: 250,
  attempts: 3,
  retryDelaysMs: [250, 750],
  timeoutMs: 15_000,
} as const;

interface ProfitabilityArtifact {
  ledger: ProfitabilityLedger;
  report: ProfitabilityReport;
}

interface Rc55Snapshot {
  virtualTrades: Rc55VirtualTradeRow[];
  dailyBars: Rc55DailyBarRow[];
  exactSources: Rc55ExactSourceAvailability[];
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "unknown read error");
  const candidate = error as { code?: unknown; message?: unknown };
  return [candidate.code, candidate.message].filter(Boolean).map(String).join(": ") || "unknown read error";
}

async function probeExactSource(
  sb: ReturnType<typeof createServerSupabaseClient>,
  table: Rc55ExactSourceAvailability["table"],
): Promise<Rc55ExactSourceAvailability> {
  // Use a real bounded GET rather than HEAD. PostgREST may satisfy HEAD from a
  // stale schema cache, which is not proof that the backing relation exists.
  const result = await sb.from(table).select("id", { count: "exact" }).limit(1);
  if (!result.error) {
    return { table, state: "available", rows: result.count ?? 0, detail: "bounded head/count read succeeded" };
  }
  const detail = safeError(result.error);
  const absent = result.error.code === "42P01"
    || /does not exist|schema cache/i.test(result.error.message ?? "");
  return {
    table,
    state: absent ? "absent" : "read_error",
    rows: null,
    detail,
  };
}

async function collectSnapshot(): Promise<{ snapshot: Rc55Snapshot; timingsMs: Record<string, number> }> {
  const sb = createServerSupabaseClient("rc55-research");
  const timingsMs: Record<string, number> = {};
  const timed = async <T>(label: string, read: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const value = await read();
    timingsMs[label] = Date.now() - started;
    return value;
  };
  const virtualTrades = await timed("virtual_trades", () =>
    pageAll<Rc55VirtualTradeRow>((from) => sb
      .from("virtual_trades")
      .select([
        "signal_id", "strategist_id", "slug", "occ", "signal_at", "blocked",
        "entry_px", "exit_reason", "exit_px", "exit_at", "pnl_per_contract",
        "tp_pct", "stop_pct", "n_quotes", "mfe_pct", "giveback_pct",
      ].join(","))
      .gte("signal_at", VIRTUAL_START_ISO)
      .lte("signal_at", `${AS_OF_DATE_ET}T23:59:59.999-04:00`)
      .order("signal_at", { ascending: true })
      .order("signal_id", { ascending: true }), {
      ...READ_OPTIONS,
      max: 10_000,
    }));
  const dailyBars = await timed("underlying_bars_daily", () =>
    pageAll<Rc55DailyBarRow>((from) => sb
      .from("underlying_bars_daily")
      .select("symbol,ts,open,high,low,close,volume,vwap")
      .in("symbol", ["SPY", "QQQ", "IWM"])
      .gte("ts", BAR_START_ISO)
      .lte("ts", `${AS_OF_DATE_ET}T23:59:59.999Z`)
      .order("ts", { ascending: true })
      .order("symbol", { ascending: true }), {
      ...READ_OPTIONS,
      max: 1_000,
    }));
  const exactSources = await timed("exact_source_probes", () => Promise.all([
    probeExactSource(sb, "vb_candidate_receipts"),
    probeExactSource(sb, "vb_exact_path_receipts"),
    probeExactSource(sb, "vb_exact_manager_path_receipts"),
  ]));
  return { snapshot: { virtualTrades, dailyBars, exactSources }, timingsMs };
}

async function main(): Promise<void> {
  if (!existsSync(LEDGER_FILE)) throw new Error(`profitability artifact not found: ${LEDGER_FILE}`);
  const artifact = JSON.parse(readFileSync(LEDGER_FILE, "utf8")) as ProfitabilityArtifact;
  let snapshot: Rc55Snapshot;
  let timingsMs: Record<string, number>;
  let posture: "select_only_local_snapshot" | "local_snapshot_replay";
  if (SNAPSHOT_FILE) {
    const path = resolve(SNAPSHOT_FILE);
    const started = Date.now();
    snapshot = JSON.parse(readFileSync(path, "utf8")) as Rc55Snapshot;
    timingsMs = { localSnapshotReplay: Date.now() - started };
    posture = "local_snapshot_replay";
    console.log(`rc55-research: local snapshot replay · ${path}`);
  } else {
    console.log("rc55-research: SELECT-only compact evidence snapshot");
    const collected = await collectSnapshot();
    snapshot = collected.snapshot;
    timingsMs = collected.timingsMs;
    posture = "select_only_local_snapshot";
  }
  const input: Rc55ResearchInput = {
    ledger: artifact.ledger,
    profitabilityReport: artifact.report,
    ...snapshot,
    asOfDateEt: AS_OF_DATE_ET,
  };
  const packet = buildRc55ResearchPacket(input);
  const generatedAt = new Date().toISOString();
  const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
  const packetJson = `${JSON.stringify(packet, null, 2)}\n`;
  const markdown = renderRc55ResearchMarkdown(packet, generatedAt);
  const receipt = {
    schemaVersion: 1,
    generatedAt,
    asOfDateEt: AS_OF_DATE_ET,
    posture,
    ledgerFile: LEDGER_FILE,
    timingsMs,
    evidence: packet.evidence,
    snapshotSha256: sha256(snapshotJson),
    packetSha256: sha256(packetJson),
    reportSha256: sha256(markdown),
    excludedSources: ["option_quotes", "option_quote_archive", "option_bars"],
    productionWrites: 0,
    optionQuoteRowsRead: 0,
    strategicValuesSelected: false,
    proposalCreated: false,
    activationAuthorized: false,
    orderAuthority: false,
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "snapshot.json"), snapshotJson);
  writeFileSync(resolve(OUTPUT_DIR, "packet.json"), packetJson);
  writeFileSync(resolve(OUTPUT_DIR, "report.md"), markdown);
  writeFileSync(resolve(OUTPUT_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`  broad logical trades: ${packet.evidence.broadClosedTrades}`);
  console.log(`  exact RC5.4 trades: ${packet.evidence.exactRc54Trades}`);
  console.log(`  virtual paths: ${packet.evidence.virtualRows} · scored ${packet.evidence.virtualScoredRows} · sessions ${packet.evidence.virtualSessions}`);
  console.log(`  VB: ${packet.evidence.vbRows} · other dark: ${packet.evidence.otherDarkRows}`);
  console.log(`  exact sources: ${packet.evidence.exactSources.map((source) => `${source.table}=${source.state}`).join(" · ")}`);
  console.log(`  output: ${OUTPUT_DIR}`);
  console.log(`  receipt: ${receipt.packetSha256}`);
  console.log("rc55-research: PASS · review-only packet generated; no strategic values selected");
}

void main().catch((error) => {
  console.error(`rc55-research failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
