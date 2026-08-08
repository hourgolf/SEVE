// Independent SELECT-only verification for one bounded gate-shadow rebuild.
// It compares every persisted virtual_trades payload with the isolated local
// ledger and writes only a local receipt.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pageAll } from "../engine/pageAll";
import { etDayRangeUtc } from "../lib/research/afterCloseResearch";
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

interface LocalRow {
  signalId: string;
  slug: string;
  occ: string;
  createdAt: string;
  blocked: string;
  entryAsk: number;
  exitReason: string;
  exitPx: number | null;
  exitAt: string | null;
  pnlPerContract: number | null;
  stopPct: number;
  tpPct: number;
  nQuotes: number;
  mfePct: number | null;
  giveback: number | null;
}

interface RemoteRow {
  signal_id: string;
  slug: string;
  occ: string;
  signal_at: string;
  blocked: string;
  entry_px: number | string | null;
  exit_reason: string;
  exit_px: number | string | null;
  exit_at: string | null;
  pnl_per_contract: number | string | null;
  stop_pct: number | string;
  tp_pct: number | string;
  n_quotes: number | string;
  mfe_pct: number | string | null;
  giveback_pct: number | string | null;
}

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

const number = (value: number | string | null): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const canonical = (row: LocalRow | RemoteRow) => "signalId" in row ? {
  signalId: row.signalId,
  slug: row.slug,
  occ: row.occ,
  signalAt: row.createdAt,
  blocked: row.blocked,
  entryPx: row.entryAsk > 0 ? row.entryAsk : null,
  exitReason: row.exitReason,
  exitPx: row.exitPx,
  exitAt: row.exitAt,
  pnlPerContract: row.pnlPerContract,
  stopPct: row.stopPct,
  tpPct: row.tpPct,
  nQuotes: row.nQuotes,
  mfePct: row.mfePct,
  givebackPct: row.giveback,
} : {
  signalId: row.signal_id,
  slug: row.slug,
  occ: row.occ,
  signalAt: row.signal_at,
  blocked: row.blocked,
  entryPx: number(row.entry_px),
  exitReason: row.exit_reason,
  exitPx: number(row.exit_px),
  exitAt: row.exit_at,
  pnlPerContract: number(row.pnl_per_contract),
  stopPct: number(row.stop_pct),
  tpPct: number(row.tp_pct),
  nQuotes: number(row.n_quotes),
  mfePct: number(row.mfe_pct),
  givebackPct: number(row.giveback_pct),
};

const sha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(JSON.stringify(value)).digest("hex")}`;

async function main(): Promise<void> {
  if (!existsSync(LEDGER_FILE) || !existsSync(RECEIPT_FILE)) {
    throw new Error("isolated rebuild ledger and receipt are required");
  }
  const ledger = JSON.parse(readFileSync(LEDGER_FILE, "utf8")) as LocalRow[];
  const receipt = JSON.parse(readFileSync(RECEIPT_FILE, "utf8")) as RebuildReceipt;
  const range = etDayRangeUtc(SESSION);
  const local = ledger.filter((row) => row.createdAt >= range.start && row.createdAt < range.end)
    .map(canonical).sort((left, right) => left.signalId.localeCompare(right.signalId));
  const sb = createServerSupabaseClient("verify-shadow-rebuild-select-only");
  const remoteRows = await pageAll<RemoteRow>((from) => sb.from("virtual_trades")
    .select("signal_id,slug,occ,signal_at,blocked,entry_px,exit_reason,exit_px,exit_at,pnl_per_contract,stop_pct,tp_pct,n_quotes,mfe_pct,giveback_pct")
    .gte("signal_at", range.start).lt("signal_at", range.end)
    .order("signal_at", { ascending: true }).order("signal_id", { ascending: true }), { max: 50_000 });
  const remote = remoteRows.map(canonical)
    .sort((left, right) => left.signalId.localeCompare(right.signalId));
  const localById = new Map(local.map((row) => [row.signalId, row]));
  const remoteById = new Map(remote.map((row) => [row.signalId, row]));
  const duplicateLocalIds = local.length - localById.size;
  const duplicateRemoteIds = remote.length - remoteById.size;
  const missingRemoteIds = [...localById.keys()].filter((id) => !remoteById.has(id)).sort();
  const extraRemoteIds = [...remoteById.keys()].filter((id) => !localById.has(id)).sort();
  const payloadMismatches = [...localById.entries()].flatMap(([id, localRow]) => {
    const remoteRow = remoteById.get(id);
    if (!remoteRow || JSON.stringify(localRow) === JSON.stringify(remoteRow)) return [];
    const fields = Object.keys(localRow).filter((field) =>
      JSON.stringify(localRow[field as keyof typeof localRow])
        !== JSON.stringify(remoteRow[field as keyof typeof remoteRow]));
    return [{ signalId: id, fields }];
  });
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
    && missingRemoteIds.length === 0 && extraRemoteIds.length === 0
    && payloadMismatches.length === 0 && receiptIssues.length === 0;
  const verification = {
    version: "gate-shadow-independent-verification-v1",
    generatedAt: new Date().toISOString(),
    session: SESSION,
    range,
    localRows: local.length,
    remoteRows: remote.length,
    localPayloadSha256: sha256(local),
    remotePayloadSha256: sha256(remote),
    duplicateLocalIds,
    duplicateRemoteIds,
    missingRemoteIds,
    extraRemoteIds,
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
  console.log(`verify-shadow-rebuild: PASS · ${local.length} local = ${remote.length} remote payloads`);
  console.log(`  ${verification.localPayloadSha256}`);
  console.log(`  ${VERIFICATION_FILE}`);
}

void main().catch((error) => {
  console.error(`verify-shadow-rebuild failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
