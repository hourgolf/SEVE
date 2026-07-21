import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const QUOTE_ARCHIVE_SCHEMA_VERSION = 1 as const;
export const QUOTE_ARCHIVE_VERSION = "r2-option-quotes-v1" as const;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface QuoteArchiveArtifact {
  raw: Buffer;
  compressed: Buffer;
  manifestBody: Buffer;
  manifest: {
    schemaVersion: typeof QUOTE_ARCHIVE_SCHEMA_VERSION;
    archiveVersion: typeof QUOTE_ARCHIVE_VERSION;
    source: "supabase.option_quotes";
    sessionDateEt: string;
    objectKey: string;
    manifestKey: string;
    rowCount: number;
    underlyings: string[];
    rowsByUnderlying: Record<string, number>;
    firstCapturedAt: string;
    lastCapturedAt: string;
    contentSha256: string;
    compressedSha256: string;
    compressedBytes: number;
    completedAt: string;
  };
  manifestSha256: string;
}

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
const cleanPrefix = (value: string): string => value.replace(/^\/+|\/+$/g, "") || "quote-archive";

function canonical(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("quote archive contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object") throw new Error(`quote archive contains unsupported ${typeof value}`);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
}

const field = (row: Record<string, unknown>, name: string): string => typeof row[name] === "string" ? row[name] : "";

export function buildQuoteArchiveArtifact(input: {
  sessionDateEt: string;
  rows: readonly Record<string, unknown>[];
  prefix: string;
  completedAt: string;
}): QuoteArchiveArtifact {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDateEt)) throw new Error("invalid quote archive session date");
  if (!input.rows.length) throw new Error("cannot archive an empty quote session");
  if (!Number.isFinite(Date.parse(input.completedAt))) throw new Error("invalid quote archive completion clock");

  const rows = input.rows.map((row) => canonical(row) as Record<string, JsonValue>).sort((a, b) => {
    const aa = a as Record<string, unknown>;
    const bb = b as Record<string, unknown>;
    return field(aa, "captured_at").localeCompare(field(bb, "captured_at"))
      || field(aa, "underlying").localeCompare(field(bb, "underlying"))
      || field(aa, "occ_symbol").localeCompare(field(bb, "occ_symbol"))
      || String(aa.id ?? "").localeCompare(String(bb.id ?? ""));
  });
  const captured = rows.map((row) => field(row as Record<string, unknown>, "captured_at"));
  if (captured.some((at) => !at || !Number.isFinite(Date.parse(at)) || at.slice(0, 10) !== input.sessionDateEt)) {
    throw new Error(`quote archive contains a row outside ${input.sessionDateEt}`);
  }
  const underlyings = [...new Set(rows.map((row) => field(row as Record<string, unknown>, "underlying")))].sort();
  if (underlyings.some((symbol) => !symbol)) throw new Error("quote archive contains a row without underlying identity");
  const rowsByUnderlying = Object.fromEntries(underlyings.map((symbol) => [symbol,
    rows.filter((row) => field(row as Record<string, unknown>, "underlying") === symbol).length]));

  const raw = Buffer.from(JSON.stringify(rows), "utf8");
  const compressed = gzipSync(raw, { level: 9 });
  const contentSha256 = sha256(raw);
  const compressedSha256 = sha256(compressed);
  const base = `${cleanPrefix(input.prefix)}/v${QUOTE_ARCHIVE_SCHEMA_VERSION}/date=${input.sessionDateEt}/${compressedSha256}`;
  const objectKey = `${base}.json.gz`;
  const manifestKey = `${base}.manifest.json`;
  const manifest = {
    schemaVersion: QUOTE_ARCHIVE_SCHEMA_VERSION,
    archiveVersion: QUOTE_ARCHIVE_VERSION,
    source: "supabase.option_quotes" as const,
    sessionDateEt: input.sessionDateEt,
    objectKey,
    manifestKey,
    rowCount: rows.length,
    underlyings,
    rowsByUnderlying,
    firstCapturedAt: captured[0],
    lastCapturedAt: captured[captured.length - 1],
    contentSha256,
    compressedSha256,
    compressedBytes: compressed.byteLength,
    completedAt: input.completedAt,
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest), "utf8");
  return { raw, compressed, manifestBody, manifest, manifestSha256: sha256(manifestBody) };
}

export function quoteArchiveHeadMatches(input: {
  contentLength?: number;
  metadata?: Record<string, string | undefined>;
  expectedBytes: number;
  expectedSha256: string;
}): boolean {
  return input.contentLength === input.expectedBytes && input.metadata?.sha256 === input.expectedSha256;
}
