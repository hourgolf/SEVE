import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./nightly-dark-exact-learning.ts", import.meta.url), "utf8");

const freeze = source.indexOf('run("scripts/freeze-dark-candidates.ts"');
const score = source.indexOf('run("scripts/dark-candidate-t1.ts"');
const publish = source.indexOf('run("scripts/publish-dark-exact-receipts.ts"');
assert.ok(freeze >= 0 && freeze < score && score < publish, "freeze, score, publish must stay ordered");
assert.match(source, /--max-provider-cost-usd/);
assert.match(source, /published_verified/);
assert.match(source, /verifiedCandidates !== publication\.planned\.candidates/);
assert.match(source, /verifiedPaths !== publication\.planned\.exactPaths/);
assert.match(source, /verifiedManagers !== publication\.planned\.managerPaths/);
assert.match(source, /eventInserts !== 0/);
assert.match(source, /if \(explicitEnvFile\)/, "an explicitly requested environment file must remain fail-closed");
assert.match(source, /else if \(existsSync\(ENV_FILE\)\)/, "the implicit local environment file must be optional on hosted runners");
assert.match(source, /explicitEnvFile \|\| existsSync\(ENV_FILE\)/, "child publication must not receive a nonexistent implicit env file");
assert.doesNotMatch(source, /from ["']\.\.\/worker|alpaca|placeOrder|submitOrder/);

console.log("nightly-dark-exact-learning-selftest: PASS");
