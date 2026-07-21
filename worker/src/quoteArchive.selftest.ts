import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildQuoteArchiveArtifact, quoteArchiveHeadMatches } from "./quoteArchiveModel";

const rows = [
  { id: "b", underlying: "QQQ", occ_symbol: "QQQ260720C00600000", captured_at: "2026-07-20T14:31:00.000Z", ask: 1.1, bid: 1 },
  { ask: 0.9, captured_at: "2026-07-20T14:30:00.000Z", occ_symbol: "SPY260720P00750000", underlying: "SPY", id: "a", bid: 0.8 },
];
const artifact = buildQuoteArchiveArtifact({
  sessionDateEt: "2026-07-20",
  rows,
  prefix: "/quote-archive/",
  completedAt: "2026-07-20T20:30:00.000Z",
});
const reordered = buildQuoteArchiveArtifact({
  sessionDateEt: "2026-07-20",
  rows: [...rows].reverse().map((row) => Object.fromEntries(Object.entries(row).reverse())),
  prefix: "quote-archive",
  completedAt: "2026-07-20T20:30:00.000Z",
});

assert.equal(artifact.manifest.rowCount, 2);
assert.deepEqual(artifact.manifest.underlyings, ["QQQ", "SPY"]);
assert.deepEqual(artifact.manifest.rowsByUnderlying, { QQQ: 1, SPY: 1 });
assert.equal(artifact.manifest.firstCapturedAt, "2026-07-20T14:30:00.000Z");
assert.equal(artifact.manifest.lastCapturedAt, "2026-07-20T14:31:00.000Z");
assert.equal(artifact.manifest.contentSha256, reordered.manifest.contentSha256);
assert.equal(artifact.manifest.compressedSha256, reordered.manifest.compressedSha256);
assert.deepEqual(JSON.parse(gunzipSync(artifact.compressed).toString("utf8")), JSON.parse(artifact.raw.toString("utf8")));
assert.match(artifact.manifest.objectKey, new RegExp(`${artifact.manifest.compressedSha256}\\.json\\.gz$`));
assert.equal(quoteArchiveHeadMatches({ contentLength: artifact.compressed.byteLength, metadata: { sha256: artifact.manifest.compressedSha256 }, expectedBytes: artifact.compressed.byteLength, expectedSha256: artifact.manifest.compressedSha256 }), true);
assert.equal(quoteArchiveHeadMatches({ contentLength: artifact.compressed.byteLength - 1, metadata: { sha256: artifact.manifest.compressedSha256 }, expectedBytes: artifact.compressed.byteLength, expectedSha256: artifact.manifest.compressedSha256 }), false);
assert.equal(quoteArchiveHeadMatches({ contentLength: artifact.compressed.byteLength, metadata: { sha256: "0".repeat(64) }, expectedBytes: artifact.compressed.byteLength, expectedSha256: artifact.manifest.compressedSha256 }), false);
assert.throws(() => buildQuoteArchiveArtifact({ sessionDateEt: "2026-07-20", rows: [], prefix: "x", completedAt: new Date().toISOString() }), /empty/);
assert.throws(() => buildQuoteArchiveArtifact({ sessionDateEt: "2026-07-20", rows: [{ ...rows[0], captured_at: "2026-07-19T14:31:00.000Z" }], prefix: "x", completedAt: new Date().toISOString() }), /outside/);
assert.throws(() => buildQuoteArchiveArtifact({ sessionDateEt: "bad", rows, prefix: "x", completedAt: new Date().toISOString() }), /date/);

const configSource = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
assert.match(configSource, /quoteArchiveR2Enabled:\s*flag\("QUOTE_ARCHIVE_R2_ENABLED", false\)/);
const runtimeSource = readFileSync(new URL("./r2QuoteArchive.ts", import.meta.url), "utf8");
assert.doesNotMatch(runtimeSource, /^import .*?(?:alpaca|execute|order|position|strategy)/im);
const archiveSource = readFileSync(new URL("./archive.ts", import.meta.url), "utf8");
assert.match(archiveSource, /if \(config\.quoteArchiveR2Enabled\)/);
const migrationSource = readFileSync(new URL("../../supabase/migrations/20260721040000_quote_archive_receipts.sql", import.meta.url), "utf8");
assert.match(migrationSource, /enable row level security/);
assert.match(migrationSource, /revoke all .* from anon, authenticated/);
assert.match(migrationSource, /\(underlying, captured_at, id\)/);

console.log("quote-archive-selftest: 20/20 passed");
