import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./quote-archive-parity.ts", import.meta.url), "utf8");

assert.match(source, /evaluateQuoteArchiveParity/);
assert.match(source, /GetObjectCommand/);
assert.match(source, /HeadObjectCommand/);
assert.match(source, /from\("option_quotes"\)\.select\("\*"\)/);
assert.match(source, /from\("quote_archive_receipts"\)/);
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|PutObjectCommand|DeleteObjectCommand/);
assert.match(source, /retentionEligible/);

console.log("quote-archive-parity-adapter-selftest: read-only contract passed");
