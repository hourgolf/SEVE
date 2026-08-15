// Bounded repair for legacy, configuration-unstamped virtual_trades payloads.
//
// The independent verifier names the exact mismatched signal ids. This script
// binds to that verifier by SHA-256, refuses missing/duplicate/stamped rows,
// updates only those legacy payloads, and verifies every readback. Unscoped
// rows from other historical publishers are preserved and reported.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { etDayRangeUtc } from "../lib/research/afterCloseResearch";
import {
  canonicalLocalGateShadowRow,
  canonicalRemoteGateShadowRow,
  gateShadowPayloadSha256,
  type LocalGateShadowRow,
  type RemoteGateShadowRow,
} from "../lib/research/gateShadowVerification";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string, fallback = ""): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
};
const PUBLISH = process.argv.includes("--publish");
const SESSION = arg("session");
if (!/^\d{4}-\d{2}-\d{2}$/.test(SESSION)) throw new Error("--session YYYY-MM-DD is required");
const outputDir = resolve(arg("output-dir", `data/after-close-recovery/${SESSION}`));
const ledgerFile = resolve(arg("ledger", join(outputDir, "gate-shadow.json")));
const verificationFile = resolve(arg("verification", join(outputDir, "gate-shadow-verification.json")));
const receiptFile = resolve(arg("receipt", join(outputDir, "gate-shadow-reconciliation-receipt.json")));
const envFile = resolve(arg("env-file", process.env.SEVE_ENV_FILE ?? ".env.local"));
const expectedVerificationSha256 = arg("expected-verification-sha256").replace(/^sha256:/, "");
if (!existsSync(ledgerFile) || !existsSync(verificationFile)) {
  throw new Error("local rebuild ledger and independent verification are required");
}
if (!/^[0-9a-f]{64}$/.test(expectedVerificationSha256)) {
  throw new Error("--expected-verification-sha256 is required");
}
if (existsSync(envFile)) process.loadEnvFile(envFile);

const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const verificationBytes = readFileSync(verificationFile);
if (sha256(verificationBytes) !== expectedVerificationSha256) {
  throw new Error("verification receipt hash mismatch");
}

interface Verification {
  version: string;
  session: string;
  localPayloadSha256: string;
  duplicateLocalIds: number;
  duplicateRemoteIds: number;
  missingRemoteIds: string[];
  unscopedRemoteIds?: string[];
  extraRemoteIds?: string[];
  payloadMismatches: Array<{ signalId: string; fields: string[] }>;
  receiptIssues: string[];
  passed: boolean;
}

interface StoredRow extends RemoteGateShadowRow {
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
  native_manager_policy_version: string | null;
  research_publisher_version: string | null;
}

const verification = JSON.parse(verificationBytes.toString("utf8")) as Verification;
if (verification.version !== "gate-shadow-independent-verification-v1" || verification.session !== SESSION) {
  throw new Error("verification receipt scope mismatch");
}
if (verification.passed || verification.duplicateLocalIds || verification.duplicateRemoteIds
    || verification.missingRemoteIds.length || verification.receiptIssues.length
    || !verification.payloadMismatches.length) {
  throw new Error("verification is not an eligible payload-mismatch-only repair");
}

const range = etDayRangeUtc(SESSION);
const ledger = (JSON.parse(readFileSync(ledgerFile, "utf8")) as LocalGateShadowRow[])
  .filter((row) => row.createdAt >= range.start && row.createdAt < range.end);
const canonicalLocal = ledger.map(canonicalLocalGateShadowRow)
  .sort((left, right) => left.signalId.localeCompare(right.signalId));
if (gateShadowPayloadSha256(canonicalLocal) !== verification.localPayloadSha256) {
  throw new Error("local ledger no longer matches the independent verification");
}
const localById = new Map(ledger.map((row) => [row.signalId, row]));
const repairIds = verification.payloadMismatches.map((row) => row.signalId).sort();
if (new Set(repairIds).size !== repairIds.length || repairIds.some((id) => !localById.has(id))) {
  throw new Error("repair manifest contains duplicate or unknown signal ids");
}

const payload = (row: LocalGateShadowRow) => ({
  signal_id: row.signalId,
  slug: row.slug,
  occ: row.occ,
  signal_at: row.createdAt,
  blocked: row.blocked,
  entry_px: row.entryAsk > 0 ? row.entryAsk : null,
  exit_reason: row.exitReason,
  exit_px: row.exitPx,
  exit_at: row.exitAt,
  pnl_per_contract: row.pnlPerContract,
  stop_pct: row.stopPct,
  tp_pct: row.tpPct,
  n_quotes: row.nQuotes,
  mfe_pct: row.mfePct,
  giveback_pct: row.giveback,
});

async function main(): Promise<void> {
  const sb = createServerSupabaseClient("reconcile-shadow-rebuild");
  const before = await sb.from("virtual_trades")
    .select("signal_id,slug,occ,signal_at,blocked,entry_px,exit_reason,exit_px,exit_at,pnl_per_contract,stop_pct,tp_pct,n_quotes,mfe_pct,giveback_pct,channel_spec_version_id,release_manifest_id,configuration_epoch_id,native_manager_policy_version,research_publisher_version")
    .in("signal_id", repairIds).order("signal_id");
  if (before.error) throw new Error(`repair preflight failed: ${before.error.message}`);
  const stored = (before.data ?? []) as StoredRow[];
  if (stored.length !== repairIds.length) throw new Error("repair preflight row count mismatch");
  const stamped = stored.filter((row) => row.channel_spec_version_id || row.release_manifest_id
    || row.configuration_epoch_id || row.native_manager_policy_version || row.research_publisher_version);
  if (stamped.length) throw new Error(`refusing to rewrite ${stamped.length} provenance-stamped row(s)`);

  const rows = repairIds.map((id) => payload(localById.get(id)!));
  if (PUBLISH) {
    // UPDATE-only is deliberate: an upsert can attempt an insert before
    // conflict resolution and either trip insert-only constraints or create a
    // row if the target disappears. The preflight proved every id exists; the
    // readback below proves every exact update landed.
    for (const row of rows) {
      const { signal_id: signalId, ...changes } = row;
      const write = await sb.from("virtual_trades").update(changes).eq("signal_id", signalId);
      if (write.error) throw new Error(`bounded legacy repair failed (${signalId}): ${write.error.message}`);
    }
  }

  const after = await sb.from("virtual_trades")
    .select("signal_id,slug,occ,signal_at,blocked,entry_px,exit_reason,exit_px,exit_at,pnl_per_contract,stop_pct,tp_pct,n_quotes,mfe_pct,giveback_pct")
    .in("signal_id", repairIds).order("signal_id");
  if (after.error) throw new Error(`repair readback failed: ${after.error.message}`);
  const expected = rows.map((row) => canonicalRemoteGateShadowRow(row as RemoteGateShadowRow));
  const observed = ((after.data ?? []) as RemoteGateShadowRow[]).map(canonicalRemoteGateShadowRow);
  const verified = expected.filter((row, index) => JSON.stringify(row) === JSON.stringify(observed[index])).length;
  if (PUBLISH && verified !== rows.length) throw new Error(`repair readback mismatch: ${verified}/${rows.length}`);

  const receipt = {
    version: "gate-shadow-bounded-reconciliation-v1",
    generatedAt: new Date().toISOString(),
    session: SESSION,
    mode: PUBLISH ? "published_verified" : "dry_run",
    verificationFileSha256: `sha256:${expectedVerificationSha256}`,
    localPayloadSha256: verification.localPayloadSha256,
    plannedLegacyRepairs: repairIds.length,
    repairedSignalIds: PUBLISH ? repairIds : [],
    verifiedReadbacks: PUBLISH ? verified : 0,
    mismatchFields: verification.payloadMismatches,
    unscopedRemoteIds: verification.unscopedRemoteIds ?? verification.extraRemoteIds ?? [],
    unscopedRemoteDisposition: "preserved_outside_manifest_scope",
    allowedTables: ["virtual_trades"],
    eventInserts: 0,
    deletes: 0,
    inserts: 0,
    provenanceRowsChanged: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
  mkdirSync(dirname(receiptFile), { recursive: true });
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`reconcile-shadow-rebuild: PASS · ${receipt.mode} · ${repairIds.length} legacy row(s)`);
  console.log(`  ${receiptFile}`);
}

main().catch((error) => {
  console.error(`reconcile-shadow-rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
