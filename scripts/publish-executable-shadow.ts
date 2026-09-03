// Persist one locally-built executable-shadow report into the append-only
// evidence ledger. Default mode verifies only. Publishing requires the explicit
// authority-dark acknowledgement and never changes runtime or order state.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../lib/channels/channelControlPlane";
import type { ExecutableShadowReceipt } from "../lib/research/executableShadowLedger";
import { createServerSupabaseClient } from "./serverSupabase";

const PUBLISHER_VERSION = "executable-shadow-publisher-v1";
const has = (name: string): boolean => process.argv.includes(`--${name}`);
const value = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
};
const envFile = resolve(value("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const reportArg = value("report");
if (!reportArg) throw new Error("--report is required");
const reportFile = resolve(reportArg);
const publish = has("publish");
if (publish && !has("ack-authority-dark")) throw new Error("--publish requires --ack-authority-dark");

const hash = (input: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;
function deterministicUuid(seed: string): string {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const joined = chars.join("");
  return [joined.slice(0, 8), joined.slice(8, 12), joined.slice(12, 16), joined.slice(16, 20), joined.slice(20)].join("-");
}
const object = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};

interface PilotReport {
  schemaVersion: number;
  kind: string;
  generatedAt: string;
  slug: string;
  fromSession: string;
  throughSession: string;
  provenance: { source: string; channelSpecVersionId: string | null; releaseManifestId: string | null; configurationEpochId: string | null; researchRegistrationId: string | null };
  configurationHash: string;
  configurationSnapshot: Record<string, unknown>;
  publicationEligible: boolean;
  publicationBlockers: string[];
  evidenceContract: { exploratoryVirtualPathsIncluded: false; productionWrites: 0; executionAuthority: false; orderAuthority: false };
  quotePolicy: Record<string, unknown>;
  sourceCounts: Record<string, number>;
  runs: Array<{ manager: string; contractSelectionId: string; ledger: { version: string; modes: string[]; receipts: ExecutableShadowReceipt[] } }>;
  contentHash: string;
}

async function pageExisting(sb: ReturnType<typeof createServerSupabaseClient>, runId: string): Promise<Set<string>> {
  const found = new Set<string>();
  for (let from = 0; ; from += 1_000) {
    const read = await sb.from("executable_shadow_receipts").select("opportunity_id,mode").eq("run_id", runId).range(from, from + 999);
    if (read.error) throw new Error(`existing receipt read failed: ${read.error.message}`);
    for (const row of read.data ?? []) found.add(`${row.opportunity_id}\0${row.mode}`);
    if ((read.data ?? []).length < 1_000) return found;
  }
}

async function main(): Promise<void> {
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as PilotReport;
  const semantic = { ...report } as Record<string, unknown>;
  delete semantic.contentHash;
  if (report.schemaVersion !== 1 || report.kind !== "executable-shadow-pilot" || report.contentHash !== hash(semantic)) throw new Error("report identity/content hash is invalid");
  if (!report.publicationEligible || report.publicationBlockers.length) throw new Error(`report is not publication eligible: ${report.publicationBlockers.join("; ")}`);
  if (report.evidenceContract.exploratoryVirtualPathsIncluded !== false || report.evidenceContract.productionWrites !== 0
    || report.evidenceContract.executionAuthority !== false || report.evidenceContract.orderAuthority !== false) throw new Error("report carries an invalid evidence/authority contract");
  const receipts = report.runs.flatMap((run) => run.ledger.receipts);
  const inputHash = hash({
    slug: report.slug,
    fromSession: report.fromSession,
    throughSession: report.throughSession,
    provenance: report.provenance,
    configurationHash: report.configurationHash,
    quotePolicy: report.quotePolicy,
    sourceCounts: report.sourceCounts,
    inputs: receipts.map((row) => ({ opportunityId: row.opportunityId, signalId: row.signalId, contractSelectionSnapshot: row.contractSelectionSnapshot, managerSnapshot: row.managerSnapshot, sourceRefs: row.sourceRefs })),
  });
  const runId = deterministicUuid(`executable-shadow-run:${inputHash}:${report.contentHash}`);
  const sb = createServerSupabaseClient("publish-executable-shadow");
  const provenance = report.provenance;
  let verifiedConfiguration: Record<string, unknown> | null = null;
  if (provenance.source === "research_registration") {
    const read = await sb.from("research_channel_registrations").select("id,channel_id,channel_slug,state,content_hash,candidate_spec")
      .eq("id", provenance.researchRegistrationId).single();
    if (read.error || !read.data || read.data.channel_slug !== report.slug || read.data.state !== "paper-eligible" || read.data.content_hash !== report.configurationHash) {
      throw new Error(`research registration provenance drifted: ${read.error?.message ?? "identity mismatch"}`);
    }
    verifiedConfiguration = object(read.data.candidate_spec);
  } else if (provenance.source === "activated_manifest") {
    const read = await sb.from("channel_spec_versions").select("id,channel_slug,content_hash").eq("id", provenance.channelSpecVersionId).single();
    if (read.error || !read.data || read.data.channel_slug !== report.slug || read.data.content_hash !== report.configurationHash) {
      throw new Error(`active specification provenance drifted: ${read.error?.message ?? "identity mismatch"}`);
    }
    verifiedConfiguration = report.configurationSnapshot;
  } else throw new Error(`unsupported publication source: ${provenance.source}`);
  if (canonicalJson(verifiedConfiguration) !== canonicalJson(report.configurationSnapshot)) throw new Error("report configuration snapshot disagrees with durable provenance");

  const runRow = {
    id: runId,
    schema_version: 1,
    engine_version: report.runs[0]?.ledger.version ?? "executable-shadow-ledger-v1",
    publisher_version: PUBLISHER_VERSION,
    generated_at: report.generatedAt,
    session_from_et: report.fromSession,
    session_through_et: report.throughSession,
    modes: [...new Set(report.runs.flatMap((run) => run.ledger.modes))],
    quote_policy: report.quotePolicy,
    account_policies: [],
    input_content_hash: inputHash,
    output_content_hash: report.contentHash,
    opportunity_count: receipts.length,
    receipt_count: receipts.length,
    source_refs: [`report:${report.contentHash}`, `configuration:${report.configurationHash}`, `channel:${report.slug}`, `window:${report.fromSession}:${report.throughSession}`],
    production_writes: 0,
    execution_authority: false,
    runtime_mutation_authorized: false,
    order_authority: false,
  };
  console.log(JSON.stringify({ mode: publish ? "publish-authority-dark" : "verify-only", reportFile, runId, inputHash, outputHash: report.contentHash, receipts: receipts.length, provenance }, null, 2));
  if (!publish) return;
  const existingRun = await sb.from("executable_shadow_runs").select("id,input_content_hash,output_content_hash,receipt_count").eq("id", runId).maybeSingle();
  if (existingRun.error) throw new Error(`run existence read failed: ${existingRun.error.message}`);
  if (!existingRun.data) {
    const inserted = await sb.from("executable_shadow_runs").insert(runRow);
    if (inserted.error) throw new Error(`run insert failed: ${inserted.error.message}`);
  } else if (existingRun.data.input_content_hash !== inputHash || existingRun.data.output_content_hash !== report.contentHash || existingRun.data.receipt_count !== receipts.length) {
    throw new Error("existing immutable run identity disagrees with the report");
  }
  const existing = await pageExisting(sb, runId);
  const pending = receipts.filter((row) => !existing.has(`${row.opportunityId}\0${row.mode}`)).map((row) => ({
    id: deterministicUuid(`executable-shadow-receipt:${runId}:${row.opportunityId}:${row.mode}`), schema_version: 1, run_id: runId,
    opportunity_id: row.opportunityId, signal_id: row.signalId, strategist_id: row.channelId, channel_slug: row.channelSlug,
    session_date_et: row.sessionDateEt, account_id: row.accountId, underlying: row.underlying, occ_symbol: row.occSymbol,
    contract_selection_id: row.contractSelectionId, contract_selection_snapshot: row.contractSelectionSnapshot,
    family_id: row.familyId, collision_domain: row.collisionDomain, signal_at: row.signalAt, decision_at: row.decisionAt,
    decision_clock: row.decisionClock, decision_clock_at: row.decisionClockAt, mode: row.mode, disposition: row.disposition,
    disposition_reason: row.reason, priority: row.priority, quantity: row.quantity, max_entries_per_session: row.maxEntriesPerSession,
    max_debit_usd: row.maxDebitUsd, max_stop_exposure_usd: row.maxStopExposureUsd, entry_ordinal: row.entryOrdinal,
    entry_quote_ref: row.entryQuoteId, entry_at: row.entryAt, entry_ask: row.entryAsk, entry_debit_usd: row.entryDebitUsd,
    stop_exposure_usd: row.stopExposureUsd, exit_quote_ref: row.exit?.quoteId ?? null, exit_at: row.exit?.at ?? null,
    exit_bid: row.exit?.bid ?? null, exit_reason: row.exit?.reason ?? null, result_per_contract_usd: row.resultPerContractUsd,
    total_result_usd: row.totalResultUsd, return_pct: row.returnPct, mfe_pct: row.mfePct, mae_pct: row.maePct,
    capture_ratio: row.captureRatio, manager_id: row.managerId, manager_version: row.managerVersion,
    manager_snapshot: row.managerSnapshot, configuration_source: provenance.source,
    channel_spec_version_id: provenance.channelSpecVersionId, release_manifest_id: provenance.releaseManifestId,
    configuration_epoch_id: provenance.configurationEpochId, research_registration_id: provenance.researchRegistrationId,
    configuration_snapshot: report.configurationSnapshot, configuration_content_hash: report.configurationHash,
    source_refs: row.sourceRefs, exploratory_virtual_paths_included: false, execution_authority: false,
    runtime_mutation_authorized: false, order_authority: false,
  }));
  for (let index = 0; index < pending.length; index += 200) {
    const inserted = await sb.from("executable_shadow_receipts").insert(pending.slice(index, index + 200));
    if (inserted.error) throw new Error(`receipt insert failed: ${inserted.error.message}`);
  }
  console.log(JSON.stringify({ receipt: "executable-shadow-published", runId, insertedReceipts: pending.length, totalReceipts: receipts.length, executionAuthority: false, orderAuthority: false }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
