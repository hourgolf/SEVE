import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./research-council.ts", import.meta.url), "utf8");
const nightly = readFileSync(new URL("./nightly-decision-atlas.ts", import.meta.url), "utf8");
assert.match(source, /buildResearchCouncil/);
assert.match(source, /productionWrites: 0/);
assert.match(source, /orderAuthority: false/);
assert.match(source, /configurationAuthority: false/);
assert.doesNotMatch(source, /serverSupabase|fetch\(|upsert\(|insert\(/);
assert.match(nightly, /scripts\/research-council\.ts/);
console.log("research-council script selftest: PASS");
