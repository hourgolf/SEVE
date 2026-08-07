import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./priority-a-retune-readiness.ts", import.meta.url), "utf8");
assert.match(source, /\.from\("strategists"\)/);
assert.match(source, /allowedMethods:\s*\["SELECT", "GET"\]/);
assert.match(source, /productionWrites:\s*0/);
assert.match(source, /executionAuthority:\s*false/);
assert.doesNotMatch(source, /\.from\([^\n]+\)\.(?:insert|upsert|update|delete)\(/);
assert.doesNotMatch(source, /\.rpc\(/);
console.log("priority-a retune readiness self-test: PASS");

