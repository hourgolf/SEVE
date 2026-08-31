import { createHash } from "node:crypto";

export const LEGACY_VIRTUAL_TRADE_REPAIR_VERSION = "legacy-virtual-trade-repair-v1";

export interface CanonicalVirtualTradePayload {
  signalId: string;
  slug: string;
  occ: string;
  signalAt: string;
  blocked: string;
  entryPx: number | null;
  exitReason: string;
  exitPx: number | null;
  exitAt: string | null;
  pnlPerContract: number | null;
  stopPct: number;
  tpPct: number;
  nQuotes: number;
  mfePct: number | null;
  givebackPct: number | null;
}

export interface VirtualTradeRepairProvenance {
  channel_spec_version_id: string | null;
  release_manifest_id: string | null;
  configuration_epoch_id: string | null;
  native_manager_policy_version: string | null;
  research_publisher_version: string | null;
}

export interface LegacyVirtualTradeRepairManifest {
  version: typeof LEGACY_VIRTUAL_TRADE_REPAIR_VERSION;
  session: string;
  signalIds: string[];
  localPayloadSha256: string;
  remotePayloadSha256: string;
  repairPayloadSha256: string;
  sourceProvenanceSha256: string;
  changedFields: Record<string, string[]>;
  allowedTables: ["virtual_trades"];
  eventInserts: 0;
  orderAuthority: false;
  configurationAuthority: false;
}

export const stableResearchJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableResearchJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableResearchJson(row[key])}`).join(",")}}`;
};

export const researchSha256 = (value: unknown): string => `sha256:${createHash("sha256")
  .update(stableResearchJson(value)).digest("hex")}`;

export const isStrictlyLegacyProvenance = (row: VirtualTradeRepairProvenance): boolean =>
  row.channel_spec_version_id == null
  && row.release_manifest_id == null
  && row.configuration_epoch_id == null
  && row.native_manager_policy_version == null
  && row.research_publisher_version == null;

export const changedPayloadFields = (
  local: CanonicalVirtualTradePayload,
  remote: CanonicalVirtualTradePayload,
): string[] => Object.keys(local).filter((field) =>
  stableResearchJson(local[field as keyof CanonicalVirtualTradePayload])
    !== stableResearchJson(remote[field as keyof CanonicalVirtualTradePayload]));

// Match the exact raw database values read before approval, not rounded or
// timestamp-normalized equivalents. Every payload and provenance column is a
// compare-and-set precondition; another legacy writer must not be overwritten.
export function legacyRepairPreconditions(row: Record<string, unknown>): Array<{
  column: string; value: string | number | null;
}> {
  const columns = ["signal_id", "slug", "occ", "signal_at", "blocked", "entry_px", "exit_reason",
    "exit_px", "exit_at", "pnl_per_contract", "stop_pct", "tp_pct", "n_quotes", "mfe_pct", "giveback_pct",
    "channel_spec_version_id", "release_manifest_id", "configuration_epoch_id",
    "native_manager_policy_version", "research_publisher_version"];
  return columns.map((column) => {
    const value = row[column];
    if (value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`repair precondition missing/invalid: ${column}`);
    }
    return { column, value: value as string | number | null };
  });
}

export function buildLegacyVirtualTradeRepairManifest(input: {
  session: string;
  local: CanonicalVirtualTradePayload[];
  remote: CanonicalVirtualTradePayload[];
  repairPayloads: Record<string, unknown>[];
  sourceProvenance: Record<string, unknown>[];
}): LegacyVirtualTradeRepairManifest {
  const local = [...input.local].sort((left, right) => left.signalId.localeCompare(right.signalId));
  const remote = [...input.remote].sort((left, right) => left.signalId.localeCompare(right.signalId));
  const signalIds = local.map((row) => row.signalId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.session) || signalIds.length === 0
    || new Set(signalIds).size !== signalIds.length
    || remote.length !== local.length
    || remote.some((row, index) => row.signalId !== signalIds[index])) {
    throw new Error("repair manifest requires one unique local and remote row per signal");
  }
  const changedFields = Object.fromEntries(local.map((row, index) => [
    row.signalId,
    changedPayloadFields(row, remote[index]),
  ]));
  if (Object.values(changedFields).some((fields) => fields.length === 0)) {
    throw new Error("repair manifest cannot include an unchanged row");
  }
  return {
    version: LEGACY_VIRTUAL_TRADE_REPAIR_VERSION,
    session: input.session,
    signalIds,
    localPayloadSha256: researchSha256(local),
    remotePayloadSha256: researchSha256(remote),
    repairPayloadSha256: researchSha256([...input.repairPayloads]
      .sort((left, right) => String(left.signal_id).localeCompare(String(right.signal_id)))),
    sourceProvenanceSha256: researchSha256([...input.sourceProvenance]
      .sort((left, right) => String(left.signal_id).localeCompare(String(right.signal_id)))),
    changedFields,
    allowedTables: ["virtual_trades"],
    eventInserts: 0,
    orderAuthority: false,
    configurationAuthority: false,
  };
}
