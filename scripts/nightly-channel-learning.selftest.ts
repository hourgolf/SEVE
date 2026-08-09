import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./nightly-channel-learning.ts", import.meta.url), "utf8");
assert.match(source, /buildEvidenceReconciliation/);
assert.match(source, /buildChannelExperimentPacket/);
assert.match(source, /buildExecutionCapacityReadiness/);
assert.doesNotMatch(source, /createServerSupabaseClient|\.from\(|insert\(|upsert\(|fetch\(/);
assert.match(source, /productionWrites: 0/);
assert.match(source, /authority: "none"/);
assert.match(source, /packet\.md/);
assert.match(source, /dashboard-briefs\.json/);
console.log("nightly-channel-learning-selftest: PASS");
