import { strict as assert } from "node:assert";
import { buildQuoteArchiveArtifact } from "./quoteArchiveModel";
import { evaluateQuoteArchiveParity, type QuoteArchiveParityInput } from "./quoteArchiveParityModel";
import type { QuoteArchiveReceiptRow } from "./quoteArchiveReceiptStore";

const rows = [
  { id: "a", underlying: "SPY", occ_symbol: "SPY260728C00741000", captured_at: "2026-07-28T12:55:00.000Z", bid: 0.5, ask: 0.6 },
  { id: "b", underlying: "QQQ", occ_symbol: "QQQ260728P00676000", captured_at: "2026-07-28T20:15:00.000Z", bid: 0.8, ask: 0.9 },
];
const artifact = buildQuoteArchiveArtifact({
  sessionDateEt: "2026-07-28",
  rows,
  prefix: "quote-archive",
  completedAt: "2026-07-28T20:20:00.000Z",
});
const receipt: QuoteArchiveReceiptRow = {
  session_date_et: artifact.manifest.sessionDateEt,
  schema_version: artifact.manifest.schemaVersion,
  archive_version: artifact.manifest.archiveVersion,
  object_key: artifact.manifest.objectKey,
  manifest_key: artifact.manifest.manifestKey,
  row_count: artifact.manifest.rowCount,
  underlyings: artifact.manifest.underlyings,
  rows_by_underlying: artifact.manifest.rowsByUnderlying,
  first_captured_at: artifact.manifest.firstCapturedAt,
  last_captured_at: artifact.manifest.lastCapturedAt,
  content_sha256: artifact.manifest.contentSha256,
  compressed_sha256: artifact.manifest.compressedSha256,
  manifest_sha256: artifact.manifestSha256,
  compressed_bytes: artifact.manifest.compressedBytes,
  source: artifact.manifest.source,
  completed_at: artifact.manifest.completedAt,
  verified_at: "2026-07-28T20:21:00.000Z",
};
const base: QuoteArchiveParityInput = {
  sessionDateEt: "2026-07-28",
  windowStartAt: "2026-07-28T12:55:00.000Z",
  windowEndAt: "2026-07-28T20:15:59.999Z",
  hotRows: rows,
  compressedObject: artifact.compressed,
  manifestBody: artifact.manifestBody,
  objectHead: {
    contentLength: artifact.compressed.byteLength,
    metadata: {
      sha256: artifact.manifest.compressedSha256,
      contentsha256: artifact.manifest.contentSha256,
      rows: String(artifact.manifest.rowCount),
    },
  },
  manifestHead: {
    contentLength: artifact.manifestBody.byteLength,
    metadata: { sha256: artifact.manifestSha256 },
  },
  receipt,
};

const pass = evaluateQuoteArchiveParity(base);
assert.equal(pass.ok, true);
assert.equal(pass.retentionEligible, true);
assert.equal(pass.hotRowCount, 2);
assert.equal(pass.coldRowCount, 2);
assert.equal(
  evaluateQuoteArchiveParity({
    ...base,
    receipt: {
      ...receipt,
      first_captured_at: "2026-07-28T12:55:00+00:00",
      last_captured_at: "2026-07-28T20:15:00+00:00",
      completed_at: "2026-07-28T20:20:00+00:00",
    },
  }).ok,
  true,
);

assert.match(
  evaluateQuoteArchiveParity({ ...base, receipt: null }).issues.join(" "),
  /receipt is missing/,
);
assert.match(
  evaluateQuoteArchiveParity({ ...base, hotRows: [...rows, { ...rows[0], id: "c" }] }).issues.join(" "),
  /hot row count|hot and cold/,
);
assert.match(
  evaluateQuoteArchiveParity({ ...base, hotRows: [...rows, { ...rows[0] }] }).issues.join(" "),
  /duplicate/,
);
assert.match(
  evaluateQuoteArchiveParity({
    ...base,
    hotRows: [...rows, { ...rows[0], id: "c", captured_at: "2026-07-28T20:16:00.000Z" }],
  }).issues.join(" "),
  /outside the bounded ingest window/,
);
assert.match(
  evaluateQuoteArchiveParity({
    ...base,
    objectHead: { ...base.objectHead, metadata: { ...base.objectHead.metadata, sha256: "0".repeat(64) } },
  }).issues.join(" "),
  /HEAD evidence mismatch/,
);
assert.match(
  evaluateQuoteArchiveParity({
    ...base,
    compressedObject: Buffer.from(artifact.compressed).subarray(0, artifact.compressed.length - 1),
  }).issues.join(" "),
  /decode failed|checksum mismatch|size mismatch/,
);
assert.match(
  evaluateQuoteArchiveParity({
    ...base,
    receipt: { ...receipt, rows_by_underlying: { QQQ: 2 } },
  }).issues.join(" "),
  /manifest and receipt disagree|per-underlying counts/,
);
assert.match(
  evaluateQuoteArchiveParity({
    ...base,
    receipt: { ...receipt, verified_at: "2026-07-28T20:19:00.000Z" },
  }).issues.join(" "),
  /verification clock/,
);

console.log("quote-archive-parity-selftest: 10/10 passed");
