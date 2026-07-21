// Research-only candidate freezer. Supabase SELECT-only; local files only.
// It cannot write Supabase/R2, place an order, or alter policy/configuration.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  freezeDarkCandidates,
  RESEARCH_BLOCK_REASONS,
  stableResearchJson,
  type DarkExecutionEvidenceRow,
  type DarkSignalEvidenceRow,
} from "../lib/research/darkCandidateFreeze.js";
import { createServerSupabaseClient } from "./serverSupabase.js";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const todayEt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const dateEt = arg("date", todayEt);
const outDir = arg("out", `data/dark-candidate-freezes/${dateEt}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEt)) throw new Error(`invalid --date ${dateEt}`);

function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function etMidnightUtcMs(date: string): number {
  const noon = new Date(`${date}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(noon);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "12") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return Date.parse(`${date}T00:00:00.000Z`) + (12 * 60 - hour * 60 - minute) * 60_000;
}

const startIso = new Date(etMidnightUtcMs(dateEt)).toISOString();
const endIso = new Date(etMidnightUtcMs(addDays(dateEt, 1))).toISOString();
const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const sb = createServerSupabaseClient("freeze-dark-candidates");

async function page<T>(
  read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1_000) return rows;
  }
}

interface SignalDbRow {
  id: string; strategist_id: string; created_at: string; blocked_reason: string | null;
  direction: string | null; rationale: unknown;
}
interface ExecutionDbRow {
  id: string; strategist_id: string; account_id: string; channel_slug: string;
  opportunity_id: string | null; event_kind: string; action: string; event_at: string;
  source_bar_at: string; blocked_reason: string | null; underlying: string;
  occ_symbol: string | null; option_side: string | null; quote_source: string | null;
  quote_age_ms: number | null; ask: number | null;
}

function signalRow(row: SignalDbRow): DarkSignalEvidenceRow {
  return {
    id: row.id, strategistId: row.strategist_id, createdAt: row.created_at,
    blockedReason: row.blocked_reason, direction: row.direction, rationale: row.rationale,
  };
}

function executionRow(row: ExecutionDbRow): DarkExecutionEvidenceRow {
  return {
    id: row.id, strategistId: row.strategist_id, accountId: row.account_id,
    channelSlug: row.channel_slug, opportunityId: row.opportunity_id,
    eventKind: row.event_kind, action: row.action, eventAt: row.event_at,
    sourceBarAt: row.source_bar_at, blockedReason: row.blocked_reason,
    underlying: row.underlying, occSymbol: row.occ_symbol, optionSide: row.option_side,
    quoteSource: row.quote_source, quoteAgeMs: row.quote_age_ms,
    ask: row.ask == null ? null : Number(row.ask),
  };
}

function lines(record: Record<string, number>, empty = "none"): string[] {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([key, value]) => `- \`${key}\`: ${value}`) : [`- ${empty}`];
}

async function main(): Promise<void> {
  const [signals, observations] = await Promise.all([
    page<SignalDbRow>((from, to) => sb.from("signals")
      .select("id,strategist_id,created_at,blocked_reason,direction,rationale")
      .in("blocked_reason", [...RESEARCH_BLOCK_REASONS])
      .gte("created_at", startIso).lt("created_at", endIso)
      .order("created_at").order("id").range(from, to), "signals"),
    page<ExecutionDbRow>((from, to) => sb.from("execution_observations")
      .select("id,strategist_id,account_id,channel_slug,opportunity_id,event_kind,action,event_at,source_bar_at,blocked_reason,underlying,occ_symbol,option_side,quote_source,quote_age_ms,ask")
      .eq("event_kind", "decision").eq("action", "enter")
      .in("blocked_reason", [...RESEARCH_BLOCK_REASONS])
      .gte("event_at", startIso).lt("event_at", endIso)
      .order("event_at").order("id").range(from, to), "execution observations"),
  ]);
  const freeze = freezeDarkCandidates({
    sessionDateEt: dateEt,
    signals: signals.map(signalRow),
    executionObservations: observations.map(executionRow),
  });
  const freezeText = `${JSON.stringify(freeze, null, 2)}\n`;
  const manifest = {
    schemaVersion: 1,
    sessionDateEt: dateEt,
    dataset: "OPRA.PILLAR",
    schema: "cbbo-1s",
    freezeCanonicalSha256: freeze.canonicalSha256,
    requestCount: freeze.contractRequests.length,
    estimatedMaximumOneSecondRows: freeze.summary.estimatedMaximumOneSecondRows,
    providerCostEstimateUsd: null,
    providerCostFact: "requires provider metadata quote at the T+1 gate; no dollar amount is invented locally",
    exactPathAvailable: false,
    externalWrites: false,
    orderPathAuthorized: false,
    requests: freeze.contractRequests,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const report = [
    `# Dark candidate freeze — ${dateEt}`,
    "",
    "Status: SELECT-only production evidence read; local artifacts only. No Supabase/R2 write, migration, policy/configuration change, deployment, or order action.",
    "",
    "## Result",
    "",
    `- source signals: ${signals.length}`,
    `- source execution observations: ${observations.length}`,
    `- validated raw decisions: ${freeze.summary.validRawDecisions}`,
    `- censored signals: ${freeze.summary.censoredSignals}`,
    `- deduplicated exact contracts: ${freeze.summary.exactContracts}`,
    `- maximum requested one-second rows: ${freeze.summary.estimatedMaximumOneSecondRows}`,
    `- decisions without a positive live snapshot ask: ${freeze.summary.liveAskUnavailableDecisions} (retained; exact Databento ask remains required)`,
    `- canonical freeze SHA-256: \`${freeze.canonicalSha256}\``,
    "",
    "These are raw decision clocks, not independent trades. Manager-specific sequential replay is deferred until the exact CBBO paths exist; this avoids using an approximate exit to preselect re-entry opportunities.",
    "",
    "## Block reasons",
    "",
    ...lines(freeze.summary.byBlockedReason),
    "",
    "## Censors",
    "",
    ...lines(freeze.summary.byCensor),
    "",
    "## Channels",
    "",
    ...lines(freeze.summary.byChannel),
    "",
    "## T+1 continuation",
    "",
    "At the provider gate, quote only the exact manifest below. Stop on refusal or any missing contract/boundary/internal quote continuity. Never substitute snapshots, mids, approximate OCCs, or a different contract.",
    "",
    `Manifest: \`contract-manifest.json\` (${freeze.contractRequests.length} requests).`,
    "",
  ].join("\n");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "freeze.json"), freezeText);
  writeFileSync(join(outDir, "contract-manifest.json"), manifestText);
  writeFileSync(join(outDir, "report.md"), report);
  const receipt = {
    schemaVersion: 1,
    sessionDateEt: dateEt,
    freezeCanonicalSha256: freeze.canonicalSha256,
    freezeFileSha256: sha256(freezeText),
    manifestFileSha256: sha256(manifestText),
    reportFileSha256: sha256(report),
    sourceWindow: { startIso, endExclusiveIso: endIso },
    externalWrites: false,
    orderPathAuthorized: false,
    localOutputDir: outDir,
  };
  writeFileSync(join(outDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`dark-candidate-freeze: ${dateEt}`);
  console.log(`  ${signals.length} signals + ${observations.length} execution observations`);
  console.log(`  ${freeze.summary.validRawDecisions} valid raw decisions · ${freeze.summary.censoredSignals} censored`);
  console.log(`  ${freeze.summary.exactContracts} exact contracts · ≤${freeze.summary.estimatedMaximumOneSecondRows} one-second rows`);
  console.log(`  canonical sha256 ${freeze.canonicalSha256}`);
  console.log(`  external writes false · order path false`);
  console.log(`  wrote ${outDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
