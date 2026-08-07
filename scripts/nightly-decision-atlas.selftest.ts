import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./nightly-decision-atlas.ts", import.meta.url), "utf8");
assert.match(source, /profitability-ledger\.ts/);
assert.match(source, /decision-atlas\.ts/);
assert.match(source, /weekly-readout\.ts/);
assert.doesNotMatch(source, /capture-forward|launchctl|cron|\.from\(|insert\(|upsert\(/);
assert.match(source, /intentionally unscheduled/);
assert.match(source, /--virtual-catchup-file/);
assert.match(source, /--virtual-catchup-manifest/);
assert.match(source, /must be supplied together/);
console.log("nightly-decision-atlas-selftest: PASS");
