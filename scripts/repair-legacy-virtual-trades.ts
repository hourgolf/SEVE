// Exception-only, manifest-bound repair for exact same-session virtual paths
// that predate forward provenance. It cannot create rows and cannot touch any
// table except virtual_trades. Dry run first; publication requires the exact
// manifest hash and verifies every payload by readback. The source-time policy
// is verified and receipted, while the database's forward-only rule correctly
// keeps the historical row's provenance columns null.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildLegacyVirtualTradeRepairManifest,
  isStrictlyLegacyProvenance,
  legacyRepairPreconditions,
  researchSha256,
  stableResearchJson,
  type CanonicalVirtualTradePayload,
  type LegacyVirtualTradeRepairManifest,
  type VirtualTradeRepairProvenance,
} from "../lib/research/legacyVirtualTradeRepair";
import { etDayRangeUtc } from "../lib/research/afterCloseResearch";
import {
  assertVirtualTradePolicyEconomics,
  deriveVirtualTradeProvenance,
} from "../lib/research/virtualTradeProvenance";
import { createServerSupabaseClient } from "./serverSupabase";

const PUBLISH = process.argv.includes("--publish");
const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : null;
};
const args = (name: string): string[] => process.argv.flatMap((value, index) =>
  value === `--${name}` && process.argv[index + 1] ? [String(process.argv[index + 1])] : []);
const envFile = resolve(arg("env-file") ?? process.env.SEVE_ENV_FILE ?? ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const session = arg("session") ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(session)) throw new Error("--session YYYY-MM-DD is required");
const ledgerArg = arg("ledger-file");
const manifestArg = arg("manifest-file");
const receiptArg = arg("receipt-file");
const signalIds = [...new Set(args("signal-id"))].sort();
if (!ledgerArg || !manifestArg || !receiptArg || signalIds.length === 0) {
  throw new Error("--ledger-file, --manifest-file, --receipt-file, and one or more --signal-id are required");
}
const ledgerFile = resolve(ledgerArg);
const manifestFile = resolve(manifestArg);
const receiptFile = resolve(receiptArg);
if (!existsSync(ledgerFile)) throw new Error(`ledger file not found: ${ledgerFile}`);
const expectedManifestSha256 = arg("expected-manifest-sha256");
if (PUBLISH && !/^sha256:[0-9a-f]{64}$/.test(expectedManifestSha256 ?? "")) {
  throw new Error("--publish requires --expected-manifest-sha256");
}

interface LocalLedgerRow {
  signalId: string; slug: string; occ: string; createdAt: string; blocked: string;
  entryAsk: number; exitReason: string; exitPx: number | null; exitAt: string | null;
  pnlPerContract: number | null; stopPct: number; tpPct: number; nQuotes: number;
  mfePct: number | null; giveback: number | null;
}
interface RemoteRow extends VirtualTradeRepairProvenance {
  signal_id: string; slug: string; occ: string; signal_at: string; blocked: string;
  entry_px: number | string | null; exit_reason: string; exit_px: number | string | null;
  exit_at: string | null; pnl_per_contract: number | string | null;
  stop_pct: number | string; tp_pct: number | string; n_quotes: number | string;
  mfe_pct: number | string | null; giveback_pct: number | string | null;
}
interface SourceSignal {
  id: string; rationale: Record<string, unknown> | null;
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
}

const number = (value: number | string | null): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const canonicalLocal = (row: LocalLedgerRow): CanonicalVirtualTradePayload => ({
  signalId: row.signalId, slug: row.slug, occ: row.occ, signalAt: row.createdAt,
  blocked: row.blocked, entryPx: row.entryAsk > 0 ? row.entryAsk : null,
  exitReason: row.exitReason, exitPx: row.exitPx, exitAt: row.exitAt,
  pnlPerContract: row.pnlPerContract, stopPct: row.stopPct, tpPct: row.tpPct,
  nQuotes: row.nQuotes, mfePct: row.mfePct, givebackPct: row.giveback,
});
const canonicalRemote = (row: RemoteRow): CanonicalVirtualTradePayload => ({
  signalId: row.signal_id, slug: row.slug, occ: row.occ, signalAt: row.signal_at,
  blocked: row.blocked, entryPx: number(row.entry_px), exitReason: row.exit_reason,
  exitPx: number(row.exit_px), exitAt: row.exit_at, pnlPerContract: number(row.pnl_per_contract),
  stopPct: Number(row.stop_pct), tpPct: Number(row.tp_pct), nQuotes: Number(row.n_quotes),
  mfePct: number(row.mfe_pct), givebackPct: number(row.giveback_pct),
});
const repairPayload = (row: CanonicalVirtualTradePayload) => ({
  signal_id: row.signalId, slug: row.slug, occ: row.occ, signal_at: row.signalAt,
  blocked: row.blocked, entry_px: row.entryPx, exit_reason: row.exitReason,
  exit_px: row.exitPx, exit_at: row.exitAt, pnl_per_contract: row.pnlPerContract,
  stop_pct: row.stopPct, tp_pct: row.tpPct, n_quotes: row.nQuotes,
  mfe_pct: row.mfePct, giveback_pct: row.givebackPct,
});
const remoteColumns = [
  "signal_id", "slug", "occ", "signal_at", "blocked", "entry_px", "exit_reason", "exit_px", "exit_at",
  "pnl_per_contract", "stop_pct", "tp_pct", "n_quotes", "mfe_pct", "giveback_pct",
  "channel_spec_version_id", "release_manifest_id", "configuration_epoch_id",
  "native_manager_policy_version", "research_publisher_version",
].join(",");

async function main(): Promise<void> {
  const range = etDayRangeUtc(session);
  const ledger = JSON.parse(readFileSync(ledgerFile, "utf8")) as LocalLedgerRow[];
  const local = ledger.filter((row) => signalIds.includes(row.signalId)
    && row.createdAt >= range.start && row.createdAt < range.end).map(canonicalLocal)
    .sort((left, right) => left.signalId.localeCompare(right.signalId));
  if (local.length !== signalIds.length) throw new Error(`ledger contains ${local.length}/${signalIds.length} requested rows`);

  const sb = createServerSupabaseClient("repair-legacy-virtual-trades");
  const remoteRead = await sb.from("virtual_trades").select(remoteColumns).in("signal_id", signalIds).order("signal_id");
  if (remoteRead.error) throw new Error(`virtual_trades read failed: ${remoteRead.error.message}`);
  const remoteRows = (remoteRead.data ?? []) as unknown as RemoteRow[];
  if (remoteRows.length !== signalIds.length || remoteRows.some((row) => !isStrictlyLegacyProvenance(row))) {
    throw new Error("every requested row must exist and retain strictly null legacy provenance");
  }
  const signalRead = await sb.from("signals")
    .select("id,rationale,channel_spec_version_id,release_manifest_id,configuration_epoch_id")
    .in("id", signalIds).order("id");
  if (signalRead.error) throw new Error(`source signal read failed: ${signalRead.error.message}`);
  const sources = new Map(((signalRead.data ?? []) as SourceSignal[]).map((row) => [String(row.id), row]));
  if (sources.size !== signalIds.length) throw new Error(`source signals contain ${sources.size}/${signalIds.length} requested rows`);

  const sourceProvenance: Record<string, unknown>[] = [];
  const payloads = local.map((row) => {
    const source = sources.get(row.signalId);
    if (!source) throw new Error(`source signal missing: ${row.signalId}`);
    const provenance = deriveVirtualTradeProvenance(source);
    assertVirtualTradePolicyEconomics(provenance.policy, row);
    sourceProvenance.push({ signal_id: row.signalId, ...provenance.columns });
    return repairPayload(row);
  });
  const remote = remoteRows.map(canonicalRemote).sort((left, right) => left.signalId.localeCompare(right.signalId));
  const currentManifest = buildLegacyVirtualTradeRepairManifest({
    session, local, remote, repairPayloads: payloads, sourceProvenance,
  });
  const manifestSha256 = researchSha256(currentManifest);

  let upserts = 0;
  let verifiedReadbacks = 0;
  if (!PUBLISH) {
    mkdirSync(dirname(manifestFile), { recursive: true });
    writeFileSync(manifestFile, `${JSON.stringify(currentManifest, null, 2)}\n`);
  } else {
    if (!existsSync(manifestFile)) throw new Error("reviewed manifest file is required for publication");
    const reviewed = JSON.parse(readFileSync(manifestFile, "utf8")) as LegacyVirtualTradeRepairManifest;
    if (researchSha256(reviewed) !== expectedManifestSha256
      || expectedManifestSha256 !== manifestSha256
      || stableResearchJson(reviewed) !== stableResearchJson(currentManifest)) {
      throw new Error("reviewed repair manifest does not match current local, remote, and source evidence");
    }
    // Preserve the exact rollback evidence before any write. This is not an
    // automatic rollback: a partial failure requires a new bounded review.
    const beforeImageFile = `${receiptFile}.before.json`;
    if (existsSync(beforeImageFile)) throw new Error(`use a fresh receipt path; before image exists: ${beforeImageFile}`);
    mkdirSync(dirname(beforeImageFile), { recursive: true });
    writeFileSync(beforeImageFile, `${JSON.stringify({ manifestSha256, remoteRows, payloads }, null, 2)}\n`, { flag: "wx" });
    // All rows and source policies were validated before the first write. Each
    // update additionally matches every original value, including nulls, so a
    // concurrent legacy or provenance-stamped writer cannot be overwritten.
    // The immutable nulls remain null by design; source provenance is hashed
    // in the manifest rather than retroactively written to a legacy row.
    for (const payload of payloads) {
      const before = remoteRows.find((row) => row.signal_id === payload.signal_id)!;
      let query = sb.from("virtual_trades").update(payload);
      for (const { column, value } of legacyRepairPreconditions(before as unknown as Record<string, unknown>)) {
        query = value === null ? query.is(column, null) : query.eq(column, value);
      }
      const write = await query.select("signal_id");
      if (write.error) throw new Error(`virtual_trades repair failed (${payload.signal_id}): ${write.error.message}`);
      if ((write.data ?? []).length !== 1) throw new Error(`virtual_trades repair lost legacy precondition (${payload.signal_id})`);
      upserts += 1;
    }
    const verify = await sb.from("virtual_trades").select(remoteColumns).in("signal_id", signalIds).order("signal_id");
    if (verify.error) throw new Error(`virtual_trades repair readback failed: ${verify.error.message}`);
    const readbacks = (verify.data ?? []) as unknown as RemoteRow[];
    for (const payload of payloads) {
      const found = readbacks.find((row) => row.signal_id === payload.signal_id);
      const expected = local.find((row) => row.signalId === payload.signal_id);
      if (!found || !expected || !isStrictlyLegacyProvenance(found)
        || stableResearchJson(canonicalRemote(found)) !== stableResearchJson(expected)) {
        throw new Error(`virtual_trades repair payload mismatch (${payload.signal_id})`);
      }
      verifiedReadbacks += 1;
    }
  }
  const receipt = {
    version: "legacy-virtual-trade-repair-receipt-v1",
    session,
    mode: PUBLISH ? "published" : "dry_run",
    manifestSha256,
    signalIds,
    plannedRows: signalIds.length,
    remoteUpserts: upserts,
    verifiedReadbacks,
    eventInserts: 0,
    allowedTables: ["virtual_trades"],
    orderAuthority: false,
    configurationAuthority: false,
    preservedLegacyProvenance: true,
    sourcePoliciesVerified: signalIds.length,
  };
  mkdirSync(dirname(receiptFile), { recursive: true });
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`repair-legacy-virtual-trades: PASS · ${receipt.mode} · ${signalIds.length} exact rows`);
  console.log(`  ${manifestSha256}`);
  console.log(`  upserts ${upserts} · verified ${verifiedReadbacks} · events 0`);
}

void main().catch((error) => {
  console.error(`repair-legacy-virtual-trades failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
