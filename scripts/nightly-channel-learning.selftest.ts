import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./nightly-channel-learning.ts", import.meta.url), "utf8");
assert.match(source, /buildEvidenceReconciliation/);
assert.match(source, /independentShadowVerifications/,
  "nightly learning must ingest the independent payload verifier, not infer parity from row counts");
assert.match(source, /evidenceStates:/,
  "portfolio recommendations must inherit channel evidence health");
assert.match(source, /shadowVerificationSha256/,
  "the learning receipt must bind the independent verifier bytes");
assert.match(source, /buildChannelExperimentPacket/);
assert.match(source, /buildExecutionCapacityReadiness/);
assert.match(source, /buildExecutionResilienceReport/);
assert.match(source, /buildPortfolioCapacityDecisionPacket/);
assert.match(source, /buildChannelLifecycleDecisionPacket/);
assert.match(source, /buildOperatorExperimentPacket/);
assert.doesNotMatch(source, /buildNextSevenActionProgram/,
  "the superseded fixed-control program must not be rebuilt nightly");
assert.match(source, /trail-file/);
assert.doesNotMatch(source, /createServerSupabaseClient|\.from\(|insert\(|upsert\(|fetch\(/);
assert.match(source, /productionWrites: 0/);
assert.match(source, /authority: "none"/);
assert.match(source, /packet\.md/);
assert.match(source, /dashboard-briefs\.json/);
assert.match(source, /research-books\.json/);
assert.match(source, /buildChannelResearchBooks/);
assert.match(source, /\.slice\(0, 3\)/);
assert.match(source, /execution-resilience\.json/);
assert.match(source, /portfolio-capacity\.json/);
assert.match(source, /lifecycle\.json/);
assert.match(source, /operator-packet\.json/);
assert.match(source, /operator-packet\.md/);
assert.match(source, /next-seven-actions\.json/);
assert.match(source, /next-seven-actions\.md/);
assert.match(source, /trailsSha256: hash\(source\.trails\)/);
assert.match(source, /nextSevenActionsSha256: hash\(retiredSevenActionProgram\)/);
assert.match(source, /fixed August seven-action narrative was superseded/);
console.log("nightly-channel-learning-selftest: PASS");
