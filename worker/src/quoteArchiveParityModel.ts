import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  buildQuoteArchiveArtifact,
  quoteArchiveHeadMatches,
  type QuoteArchiveArtifact,
} from "./quoteArchiveModel.js";
import type { QuoteArchiveReceiptRow } from "./quoteArchiveReceiptStore.js";

export interface ArchiveObjectHead {
  contentLength?: number;
  metadata?: Record<string, string | undefined>;
}

export interface QuoteArchiveParityInput {
  sessionDateEt: string;
  windowStartAt: string;
  windowEndAt: string;
  hotRows: readonly Record<string, unknown>[];
  compressedObject: Uint8Array;
  manifestBody: Uint8Array;
  objectHead: ArchiveObjectHead;
  manifestHead: ArchiveObjectHead;
  receipt: QuoteArchiveReceiptRow | null;
}

export interface QuoteArchiveParityResult {
  ok: boolean;
  retentionEligible: boolean;
  issues: string[];
  hotRowCount: number;
  coldRowCount: number;
  contentSha256: string | null;
}

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sameJson = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);
const sameInstant = (a: string, b: string): boolean => {
  const aa = Date.parse(a);
  const bb = Date.parse(b);
  return Number.isFinite(aa) && Number.isFinite(bb) && aa === bb;
};
const at = (row: Record<string, unknown>): string =>
  typeof row.captured_at === "string" ? row.captured_at : "";

function duplicateIds(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : String(row.id ?? "");
    if (!id) {
      duplicates.add("<missing>");
      continue;
    }
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function manifestMatchesReceipt(
  manifest: QuoteArchiveArtifact["manifest"],
  receipt: QuoteArchiveReceiptRow,
): boolean {
  return manifest.schemaVersion === receipt.schema_version
    && manifest.archiveVersion === receipt.archive_version
    && manifest.source === receipt.source
    && manifest.sessionDateEt === receipt.session_date_et
    && manifest.objectKey === receipt.object_key
    && manifest.manifestKey === receipt.manifest_key
    && manifest.rowCount === receipt.row_count
    && sameJson(manifest.underlyings, receipt.underlyings)
    && sameJson(manifest.rowsByUnderlying, receipt.rows_by_underlying)
    && sameInstant(manifest.firstCapturedAt, receipt.first_captured_at)
    && sameInstant(manifest.lastCapturedAt, receipt.last_captured_at)
    && manifest.contentSha256 === receipt.content_sha256
    && manifest.compressedSha256 === receipt.compressed_sha256
    && manifest.compressedBytes === receipt.compressed_bytes
    && sameInstant(manifest.completedAt, receipt.completed_at);
}

/**
 * Pure fail-closed retention gate. It proves the bounded hot source, immutable
 * compressed object, manifest, HEAD metadata, and compact receipt describe the
 * same canonical rows. It has no database, storage, deletion, broker, order,
 * or configuration capability.
 */
export function evaluateQuoteArchiveParity(input: QuoteArchiveParityInput): QuoteArchiveParityResult {
  const issues: string[] = [];
  const startMs = Date.parse(input.windowStartAt);
  const endMs = Date.parse(input.windowEndAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    issues.push("archive parity window is invalid");
  }
  if (!input.receipt) {
    return {
      ok: false,
      retentionEligible: false,
      issues: [...issues, "verified quote archive receipt is missing"],
      hotRowCount: input.hotRows.length,
      coldRowCount: 0,
      contentSha256: null,
    };
  }
  const receipt = input.receipt;
  if (receipt.session_date_et !== input.sessionDateEt) issues.push("receipt session identity mismatch");
  if (receipt.archive_version !== "r2-option-quotes-v1" || receipt.schema_version !== 1) {
    issues.push("receipt archive contract mismatch");
  }
  if (receipt.source !== "supabase.option_quotes") issues.push("receipt source mismatch");
  const completedMs = Date.parse(receipt.completed_at);
  const verifiedMs = Date.parse(receipt.verified_at);
  if (!Number.isFinite(completedMs) || !Number.isFinite(verifiedMs) || verifiedMs < completedMs) {
    issues.push("receipt verification clock is invalid");
  }

  const hotDuplicates = duplicateIds(input.hotRows);
  if (hotDuplicates.length) issues.push(`hot quote rows contain duplicate or missing ids: ${hotDuplicates.slice(0, 3).join(",")}`);
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    const outside = input.hotRows.filter((row) => {
      const capturedMs = Date.parse(at(row));
      return !Number.isFinite(capturedMs) || capturedMs < startMs || capturedMs > endMs;
    });
    if (outside.length) issues.push(`${outside.length} hot quote rows fall outside the bounded ingest window`);
  }

  let coldRows: Record<string, unknown>[] = [];
  let coldRaw: Buffer | null = null;
  try {
    coldRaw = gunzipSync(input.compressedObject);
    const parsed = JSON.parse(coldRaw.toString("utf8"));
    if (!Array.isArray(parsed)) throw new Error("cold archive body is not a row array");
    coldRows = parsed as Record<string, unknown>[];
  } catch (error) {
    issues.push(`cold archive decode failed: ${(error as Error).message}`);
  }

  const coldDuplicates = duplicateIds(coldRows);
  if (coldDuplicates.length) issues.push(`cold quote rows contain duplicate or missing ids: ${coldDuplicates.slice(0, 3).join(",")}`);

  let manifest: QuoteArchiveArtifact["manifest"] | null = null;
  try {
    manifest = JSON.parse(Buffer.from(input.manifestBody).toString("utf8")) as QuoteArchiveArtifact["manifest"];
  } catch (error) {
    issues.push(`quote archive manifest decode failed: ${(error as Error).message}`);
  }

  const compressedSha256 = sha256(input.compressedObject);
  if (compressedSha256 !== receipt.compressed_sha256) issues.push("compressed object checksum mismatch");
  if (input.compressedObject.byteLength !== receipt.compressed_bytes) issues.push("compressed object size mismatch");
  if (!quoteArchiveHeadMatches({
    contentLength: input.objectHead.contentLength,
    metadata: input.objectHead.metadata,
    expectedBytes: receipt.compressed_bytes,
    expectedSha256: receipt.compressed_sha256,
  }) || input.objectHead.metadata?.contentsha256 !== receipt.content_sha256
      || input.objectHead.metadata?.rows !== String(receipt.row_count)) {
    issues.push("compressed object HEAD evidence mismatch");
  }

  const manifestSha256 = sha256(input.manifestBody);
  if (manifestSha256 !== receipt.manifest_sha256) issues.push("manifest checksum mismatch");
  if (!quoteArchiveHeadMatches({
    contentLength: input.manifestHead.contentLength,
    metadata: input.manifestHead.metadata,
    expectedBytes: input.manifestBody.byteLength,
    expectedSha256: receipt.manifest_sha256,
  })) issues.push("manifest HEAD evidence mismatch");
  if (manifest && !manifestMatchesReceipt(manifest, receipt)) issues.push("manifest and receipt disagree");

  let hotArtifact: QuoteArchiveArtifact | null = null;
  let coldArtifact: QuoteArchiveArtifact | null = null;
  try {
    hotArtifact = buildQuoteArchiveArtifact({
      sessionDateEt: input.sessionDateEt,
      rows: input.hotRows,
      prefix: "parity",
      completedAt: receipt.completed_at,
    });
  } catch (error) {
    issues.push(`hot quote canonicalization failed: ${(error as Error).message}`);
  }
  try {
    coldArtifact = buildQuoteArchiveArtifact({
      sessionDateEt: input.sessionDateEt,
      rows: coldRows,
      prefix: "parity",
      completedAt: receipt.completed_at,
    });
  } catch (error) {
    issues.push(`cold quote canonicalization failed: ${(error as Error).message}`);
  }

  if (hotArtifact) {
    if (hotArtifact.manifest.rowCount !== receipt.row_count) issues.push("hot row count and receipt disagree");
    if (!sameJson(hotArtifact.manifest.rowsByUnderlying, receipt.rows_by_underlying)) {
      issues.push("hot per-underlying counts and receipt disagree");
    }
    if (!sameInstant(hotArtifact.manifest.firstCapturedAt, receipt.first_captured_at)
        || !sameInstant(hotArtifact.manifest.lastCapturedAt, receipt.last_captured_at)) {
      issues.push("hot capture bounds and receipt disagree");
    }
    if (hotArtifact.manifest.contentSha256 !== receipt.content_sha256) issues.push("hot content checksum mismatch");
  }
  if (coldArtifact && coldRaw) {
    if (!coldArtifact.raw.equals(coldRaw)) issues.push("cold archive body is not canonical");
    if (coldArtifact.manifest.contentSha256 !== receipt.content_sha256) issues.push("cold content checksum mismatch");
  }
  if (hotArtifact && coldArtifact
      && hotArtifact.manifest.contentSha256 !== coldArtifact.manifest.contentSha256) {
    issues.push("hot and cold quote rows differ");
  }

  const ok = issues.length === 0;
  return {
    ok,
    retentionEligible: ok,
    issues,
    hotRowCount: input.hotRows.length,
    coldRowCount: coldRows.length,
    contentSha256: hotArtifact?.manifest.contentSha256 ?? null,
  };
}
