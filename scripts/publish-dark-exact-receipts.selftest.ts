import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./publish-dark-exact-receipts.ts", import.meta.url), "utf8");
assert.match(source, /if \(PUBLISH\)/, "writes must remain behind an explicit publish flag");
assert.deepEqual([...source.matchAll(/\.from\("([^"]+)"\)/g)].map((match) => match[1]), [],
  "dynamic table helper must keep the table allowlist centralized");
assert.match(source, /vb_candidate_receipts/);
assert.match(source, /vb_exact_path_receipts/);
assert.match(source, /vb_exact_manager_path_receipts/);
assert.doesNotMatch(source, /\.from\("(?:events|signals|positions|orders|strategists)"\)/);
assert.match(source, /R2 immutable object conflict/);
assert.match(source, /readback mismatch/);
assert.match(source, /complete_with_explicit_censors/);
assert.match(source, /published \+ censors\.length !== expected/);
assert.match(source, /R2_PUBLISH_CONCURRENCY = 8/);
assert.match(source, /mapLimit\(report\.exactPathPayloads, R2_PUBLISH_CONCURRENCY/);
assert.match(source, /new Date\(value\)\.toISOString\(\)/,
  "Postgres timestamptz formatting must normalize without weakening value equality");
assert.match(source, /orderAuthority: false/);
assert.match(source, /configurationAuthority: false/);
console.log("publish-dark-exact-receipts selftest: PASS");
