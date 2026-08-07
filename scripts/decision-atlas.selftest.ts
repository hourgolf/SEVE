import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./decision-atlas.ts", import.meta.url), "utf8");
const library = readFileSync(new URL("../lib/research/decisionAtlas.ts", import.meta.url), "utf8");
const report = readFileSync(new URL("../lib/research/decisionAtlasReport.ts", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };

assert.equal(pkg.scripts["decision-atlas"], "tsx scripts/decision-atlas.ts");
assert.equal(pkg.scripts["decision-atlas-selftest"], "tsx lib/research/decisionAtlas.selftest.ts && tsx lib/research/decisionAtlasAdapter.selftest.ts && tsx scripts/decision-atlas.selftest.ts");
assert.match(runner, /allowedMethods:\s*\["SELECT", "GET"\]/);
assert.match(runner, /productionWrites:\s*0/);
assert.match(runner, /scheduleActivationAuthorized:\s*false/);
assert.match(runner, /activeChannelSpecDatabaseIdsByVersionKey/,
  "nightly snapshot must preserve the active database spec identity per channel");
assert.doesNotMatch(runner, /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/);
assert.doesNotMatch(runner, /\.rpc\(/);
assert.match(library, /logicalOpportunityId/);
assert.match(library, /cross-account same-OCC overlap is allowed/i);
assert.match(library, /additionalDisplacedOtherOpportunitiesVsOneContract/,
  "capacity replay must distinguish baseline suppression from displacement caused by added size");
assert.match(report, /no order, configuration, roster, or deployment authority/i);
assert.match(report, /Default table answers what is working/i);
assert.match(report, /PROPOSALS ONLY · NOTHING APPLIED/i);
assert.match(report, /Moving from two to four contracts changes replayed portfolio result/i,
  "pending size proposals must compare the proposed size with the current two-contract baseline");

console.log("decision-atlas runner selftest: PASS");
