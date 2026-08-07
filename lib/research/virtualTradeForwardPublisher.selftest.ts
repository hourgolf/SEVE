import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../scripts/gate-shadow.ts", import.meta.url), "utf8");
assert.match(source, /STAMP_PROVENANCE = process\.argv\.includes\("--stamp-provenance"\)/);
assert.match(source, /STAMP_PROVENANCE && \(!SESSION \|\| !VIRTUAL_TRADES_ONLY \|\| authorizedCatchupIds\)/,
  "forward stamping must be bounded, virtual-only, and separate from historical recovery");
assert.match(source, /STAMP_PROVENANCE \? \["channel_spec_version_id", "release_manifest_id", "configuration_epoch_id"\]/,
  "source identity must come from immutable signal columns");
assert.match(source, /cfgFor = \(signal: any\): Cfg => STAMP_PROVENANCE[\s\S]*forwardFor\(signal\)\.policy\.scoredStopPct/,
  "forward scoring must use the source-time policy, not current strategist settings");
assert.match(source, /STAMP_PROVENANCE[\s\S]*\.insert\(payload\)[\s\S]*\.upsert\(payload/,
  "forward publication inserts only; the legacy lane retains idempotent upsert behavior");
assert.match(source, /existing virtual_trades provenance conflicts with source signal/);
assert.match(source, /legacyExisting[\s\S]*!STAMP_PROVENANCE \|\| !existingForward/,
  "historical unstamped rows must be skipped rather than backfilled");
assert.match(source, /publishedPayloadSha256 !== publishedReadbackSha256/,
  "full forward payload hashes must match readback hashes");
assert.match(source, /provenanceStamped: STAMP_PROVENANCE/);
assert.match(source, /eventInserts,[\s\S]*allowedTables: VIRTUAL_TRADES_ONLY/);
console.log("virtual-trade-forward-publisher-selftest: PASS");
