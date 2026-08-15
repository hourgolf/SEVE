import { createHash } from "node:crypto";

export interface LocalGateShadowRow {
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

export interface RemoteGateShadowRow {
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

export interface CanonicalGateShadowRow {
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
  stopPct: number | null;
  tpPct: number | null;
  nQuotes: number | null;
  mfePct: number | null;
  givebackPct: number | null;
}

const numeric = (value: number | string | null): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const instant = (value: string | null): string | null => {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
};

export function canonicalLocalGateShadowRow(row: LocalGateShadowRow): CanonicalGateShadowRow {
  return {
    signalId: row.signalId,
    slug: row.slug,
    occ: row.occ,
    signalAt: instant(row.createdAt) ?? row.createdAt,
    blocked: row.blocked,
    entryPx: row.entryAsk > 0 ? row.entryAsk : null,
    exitReason: row.exitReason,
    exitPx: numeric(row.exitPx),
    exitAt: instant(row.exitAt),
    pnlPerContract: numeric(row.pnlPerContract),
    stopPct: numeric(row.stopPct),
    tpPct: numeric(row.tpPct),
    nQuotes: numeric(row.nQuotes),
    mfePct: numeric(row.mfePct),
    givebackPct: numeric(row.giveback),
  };
}

export function canonicalRemoteGateShadowRow(row: RemoteGateShadowRow): CanonicalGateShadowRow {
  return {
    signalId: row.signal_id,
    slug: row.slug,
    occ: row.occ,
    signalAt: instant(row.signal_at) ?? row.signal_at,
    blocked: row.blocked,
    entryPx: numeric(row.entry_px),
    exitReason: row.exit_reason,
    exitPx: numeric(row.exit_px),
    exitAt: instant(row.exit_at),
    pnlPerContract: numeric(row.pnl_per_contract),
    stopPct: numeric(row.stop_pct),
    tpPct: numeric(row.tp_pct),
    nQuotes: numeric(row.n_quotes),
    mfePct: numeric(row.mfe_pct),
    givebackPct: numeric(row.giveback_pct),
  };
}

export function gateShadowPayloadSha256(rows: CanonicalGateShadowRow[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;
}

export function compareGateShadowRows(
  localRows: LocalGateShadowRow[],
  remoteRows: RemoteGateShadowRow[],
) {
  const local = localRows.map(canonicalLocalGateShadowRow)
    .sort((left, right) => left.signalId.localeCompare(right.signalId));
  const remote = remoteRows.map(canonicalRemoteGateShadowRow)
    .sort((left, right) => left.signalId.localeCompare(right.signalId));
  const localById = new Map(local.map((row) => [row.signalId, row]));
  const remoteById = new Map(remote.map((row) => [row.signalId, row]));
  const scopedRemote = [...localById.keys()].flatMap((id) => {
    const row = remoteById.get(id);
    return row ? [row] : [];
  }).sort((left, right) => left.signalId.localeCompare(right.signalId));
  const missingRemoteIds = [...localById.keys()].filter((id) => !remoteById.has(id)).sort();
  // virtual_trades is an append-only, multi-publisher research ledger. Rows not
  // named by this run's manifest are retained and reported, never silently
  // treated as part of this rebuild or deleted as "extras".
  const unscopedRemoteIds = [...remoteById.keys()].filter((id) => !localById.has(id)).sort();
  const payloadMismatches = [...localById.entries()].flatMap(([id, localRow]) => {
    const remoteRow = remoteById.get(id);
    if (!remoteRow || JSON.stringify(localRow) === JSON.stringify(remoteRow)) return [];
    const fields = Object.keys(localRow).filter((field) =>
      JSON.stringify(localRow[field as keyof CanonicalGateShadowRow])
        !== JSON.stringify(remoteRow[field as keyof CanonicalGateShadowRow]));
    return [{ signalId: id, fields }];
  });
  return {
    local,
    remote,
    scopedRemote,
    duplicateLocalIds: local.length - localById.size,
    duplicateRemoteIds: remote.length - remoteById.size,
    missingRemoteIds,
    unscopedRemoteIds,
    payloadMismatches,
  };
}
