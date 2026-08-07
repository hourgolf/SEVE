import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./decision-atlas.ts", import.meta.url), "utf8");
const library = readFileSync(new URL("../lib/research/decisionAtlas.ts", import.meta.url), "utf8");
const report = readFileSync(new URL("../lib/research/decisionAtlasReport.ts", import.meta.url), "utf8");
const actionable = readFileSync(new URL("./decision-atlas-actionable-review.ts", import.meta.url), "utf8");
const packets = readFileSync(new URL("./decision-atlas-change-packets.ts", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };

assert.equal(pkg.scripts["decision-atlas"], "tsx scripts/decision-atlas.ts");
assert.equal(pkg.scripts["decision-atlas-actionable-review"], "tsx scripts/decision-atlas-actionable-review.ts");
assert.equal(pkg.scripts["decision-atlas-change-packets"], "tsx scripts/decision-atlas-change-packets.ts");
assert.equal(pkg.scripts["decision-atlas-selftest"], "tsx lib/research/decisionAtlas.selftest.ts && tsx lib/research/decisionAtlasAdapter.selftest.ts && tsx scripts/decision-atlas.selftest.ts");
assert.match(runner, /allowedMethods:\s*\["SELECT", "GET"\]/);
assert.match(runner, /productionWrites:\s*0/);
assert.match(runner, /schemaVersion:\s*3/);
assert.match(runner, /scheduleActivationAuthorized:\s*false/);
assert.match(runner, /activeChannelSpecDatabaseIdsByVersionKey/,
  "nightly snapshot must preserve the active database spec identity per channel");
assert.match(runner, /read-only-select-audit/,
  "a final Atlas may overlay only a frozen zero-write catch-up manifest");
assert.match(runner, /virtual catch-up manifest is stale/,
  "local catch-up evidence must fail closed if remote truth has changed");
assert.match(runner, /localVirtualCatchup: catchup\.metadata/,
  "the receipt must disclose local catch-up rows and hashes");
assert.doesNotMatch(runner, /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/);
assert.doesNotMatch(runner, /\.rpc\(/);
assert.match(library, /logicalOpportunityId/);
assert.match(library, /cross-account same-OCC overlap is allowed/i);
assert.match(library, /additionalDisplacedOtherOpportunitiesVsOneContract/,
  "capacity replay must distinguish baseline suppression from displacement caused by added size");
assert.match(library, /decisionGroups/,
  "Atlas output must separate actionable, experiment, and insufficient-evidence channels");
assert.match(library, /decision-atlas-v3/);
assert.match(library, /scoredOpportunities/,
  "decision maturity must use scored logical outcomes rather than all observed signals");
assert.match(report, /no order, configuration, roster, or deployment authority/i);
assert.match(report, /default groups answer what can support a proposal now/i);
assert.match(report, /Typical session/i);
assert.match(report, /\["single_variable_experiment", "Single-variable experiments"\]/);
assert.match(report, /<details><summary><strong>\$\{title\}/,
  "long research queues must remain behind progressive disclosure");
assert.match(report, /Actionable now” means enough evidence to draft a proposal/,
  "actionable research must not imply production authority");
assert.match(report, /PROPOSALS ONLY · NOTHING APPLIED/i);
assert.match(report, /Moving from two to four contracts changes replayed portfolio result/i,
  "pending size proposals must compare the proposed size with the current two-contract baseline");
assert.match(actionable, /proposal_baseline_excluded/,
  "promotion replay must compare candidate admission against a zero-candidate portfolio baseline");
assert.match(actionable, /crossAccountSameOccPermitted:\s*true/,
  "cross-account same-OCC positions must remain permitted");
assert.match(actionable, /productionWrites:\s*0/);
assert.match(actionable, /configurationAuthority:\s*false/);
assert.match(actionable, /activationAuthorized:\s*false/);
assert.match(actionable, /alternativeArms:\s*1/,
  "bounded retunes must compare the baseline with one alternative rather than a parameter grid");
assert.doesNotMatch(actionable, /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/);
assert.doesNotMatch(actionable, /\.rpc\(/);
assert.match(packets, /simulatedFlatBoundary:\s*true/,
  "structural sizing preparation must disclose its simulated flat boundary");
assert.match(packets, /prepared_but_blocked/,
  "promotion packet must fail closed when the research registration is incomplete");
assert.match(packets, /const reviewFile = resolve/,
  "change packets must derive their candidates from the frozen actionable review");
assert.match(packets, /sizingPackets: sizePackets/,
  "sizing proposals must remain independently reversible");
assert.doesNotMatch(packets, /const PAUSES =|const PRESERVE_PAUSED =/,
  "retirement packets must not use a stale hardcoded channel list");
assert.match(packets, /productionWrites:\s*0/);
assert.match(packets, /activationAuthorized:\s*false/);
assert.doesNotMatch(packets, /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/);
assert.doesNotMatch(packets, /\.rpc\(/);

console.log("decision-atlas runner selftest: PASS");
