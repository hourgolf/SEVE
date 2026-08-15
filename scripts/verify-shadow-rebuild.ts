// Independent SELECT-only verification for one bounded gate-shadow rebuild.
// It compares every persisted virtual_trades payload with the isolated local
// ledger and writes only a local receipt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import { etDayRangeUtc } from "../lib/research/afterCloseResearch";
import {
  compareGateShadowRows,
  gateShadowPayloadSha256,
  type LocalGateShadowRow,
  type RemoteGateShadowRow,
} from "../lib/research/gateShadowVerification";
import { createServerSupabaseClient } from "./serverSupabase";

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};
const envFile = resolve(arg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const SESSION = arg("session") ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(SESSION)) {
  throw new Error("--session YYYY-MM-DD is required");
}
const OUTPUT_DIR = resolve(arg("output-dir") ?? `data/after-close-recovery/${SESSION}`);
const LEDGER_FILE = join(OUTPUT_DIR, "gate-shadow.json");
const RECEIPT_FILE = join(OUTPUT_DIR, "gate-shadow-receipt.json");
const VERIFICATION_FILE = join(OUTPUT_DIR, "gate-shadow-verification.json");

interface RebuildReceipt {
  version: string;
  session: string | null;
  mode: string;
  reconstruction: { paths: number; scored: number; withoutQuotes: number };
  remote: {
    upserts: number;
    upsertSignalIds: string[];
    expected: number;
    verified: number;
    eventInserts: number;
    allowedTables: string[];
  };
}

async function main(): Promise<void> {
  if (!existsSync(LEDGER_FILE) || !existsSync(RECEIPT_FILE)) {
    throw new Error("isolated rebuild ledger and receipt are required");
  }
  const ledger = JSON.parse(readFileSync(LEDGER_FILE, "utf8")) as LocalGateShadowRow[];
  const receipt = JSON.parse(readFileSync(RECEIPT_FILE, "utf8")) as RebuildReceipt;
  const range = etDayRangeUtc(SESSION);
  const localRows = ledger.filter((row) => row.createdAt >= range.start && row.createdAt < range.end);
  const sb = createServerSupabaseClient("verify-shadow-rebuild-select-only");
  const remoteRows = await pageAll<RemoteGateShadowRow>((from) => sb.from("virtual_trades")
    .select("signal_id,slug,occ,signal_at,blocked,entry_px,exit_reason,exit_px,exit_at,pnl_per_contract,stop_pct,tp_pct,n_quotes,mfe_pct,giveback_pct")
    .gte("signal_at", range.start).lt("signal_at", range.end)
    .order("signal_at", { ascending: true }).order("signal_id", { ascending: true }), { max: 50_000 });
  const comparison = compareGateShadowRows(localRows, remoteRows);
  const { local, remote, scopedRemote, duplicateLocalIds, duplicateRemoteIds,
    missingRemoteIds, unscopedRemoteIds, payloadMismatches } = comparison;
  const localById = new Map(local.map((row) => [row.signalId, row]));
  const remoteById = new Map(remote.map((row) => [row.signalId, row]));
  const publishedIds = Array.isArray(receipt.remote.upsertSignalIds)
    ? receipt.remote.upsertSignalIds.map(String) : [];
  const uniquePublishedIds = new Set(publishedIds);
  const publishedPayloadsVerified = [...uniquePublishedIds].filter((id) => {
    const localRow = localById.get(id);
    const remoteRow = remoteById.get(id);
    return localRow != null && remoteRow != null && JSON.stringify(localRow) === JSON.stringify(remoteRow);
  }).length;
  const receiptIssues = [
    receipt.version !== "gate-shadow-rebuild-v1" ? "receipt_version" : null,
    receipt.session !== SESSION ? "receipt_session" : null,
    receipt.mode !== "publish-and-verify" ? "receipt_mode" : null,
    receipt.reconstruction.paths !== local.length ? "receipt_path_count" : null,
    receipt.remote.upserts !== publishedIds.length ? "receipt_upsert_id_count" : null,
    uniquePublishedIds.size !== publishedIds.length ? "receipt_duplicate_upsert_ids" : null,
    receipt.remote.upserts !== publishedPayloadsVerified ? "receipt_upsert_payload_readback" : null,
    receipt.remote.expected !== local.length ? "receipt_expected_count" : null,
    receipt.remote.verified !== local.length ? "receipt_remote_count" : null,
    receipt.remote.eventInserts !== 0 ? "receipt_unexpected_event_writes" : null,
    JSON.stringify(receipt.remote.allowedTables) !== JSON.stringify(["virtual_trades"])
      ? "receipt_write_scope" : null,
  ].filter((value): value is string => value != null);
  const passed = duplicateLocalIds === 0 && duplicateRemoteIds === 0
    && missingRemoteIds.length === 0 && payloadMismatches.length === 0 && receiptIssues.length === 0;
  const verification = {
    version: "gate-shadow-independent-verification-v1",
    generatedAt: new Date().toISOString(),
    session: SESSION,
    range,
    localRows: local.length,
    remoteRows: remote.length,
    scopedRemoteRows: scopedRemote.length,
    localPayloadSha256: gateShadowPayloadSha256(local),
    remotePayloadSha256: gateShadowPayloadSha256(scopedRemote),
    duplicateLocalIds,
    duplicateRemoteIds,
    missingRemoteIds,
    // Backward-compatible field plus the precise name used by current readers.
    extraRemoteIds: unscopedRemoteIds,
    unscopedRemoteIds,
    unscopedRemoteDisposition: "preserved_outside_manifest_scope",
    payloadMismatches,
    publishedRows: receipt.remote.upserts,
    publishedPayloadsVerified,
    receiptIssues,
    guarantees: { remoteSelectOnly: true, productionWrites: 0, orderAuthority: false },
    passed,
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(VERIFICATION_FILE, `${JSON.stringify(verification, null, 2)}\n`);
  if (!passed) throw new Error(`shadow rebuild verification failed; inspect ${VERIFICATION_FILE}`);
  console.log(`verify-shadow-rebuild: PASS · ${local.length} local = ${scopedRemote.length} scoped remote payloads`);
  if (unscopedRemoteIds.length) console.log(`  ${unscopedRemoteIds.length} remote row(s) preserved outside this run's manifest`);
  console.log(`  ${verification.localPayloadSha256}`);
  console.log(`  ${VERIFICATION_FILE}`);
}

void main().catch((error) => {
  console.error(`verify-shadow-rebuild failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
