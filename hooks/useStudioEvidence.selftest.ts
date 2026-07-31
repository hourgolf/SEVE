import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useStudioEvidence.ts", import.meta.url), "utf8");

assert.match(source, /from\("execution_observations"\)/);
assert.match(source, /attributePositionsByImmutableExecutionAccount/);
assert.match(source, /configuredPaperAccountIds/);
assert.doesNotMatch(source, /strategists\.account_id/);
assert.doesNotMatch(source, /\.eq\("strategists\.account_id"/);

console.log("studio-evidence-read-selftest: immutable account attribution passed");
