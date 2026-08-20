import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./entry-atlas.ts", import.meta.url), "utf8");
assert.match(source, /snapshot\.json/);
assert.match(source, /atlas\.json/);
assert.match(source, /entry-atlas\.json/);
assert.match(source, /entry-atlas\.md/);
assert.match(source, /receipt\.json/);
assert.match(source, /productionReads: 0/);
assert.match(source, /productionWrites: 0/);
assert.match(source, /eventInserts: 0/);
assert.match(source, /authority: "none"/);
assert.doesNotMatch(source, /createServerSupabaseClient|\.from\(|insert\(|upsert\(|fetch\(/);
console.log("entry-atlas-runner-selftest: PASS");
