import assert from "node:assert/strict";
import { isDeskOperator } from "./operator";

const cases: Array<[string, Parameters<typeof isDeskOperator>[0], boolean]> = [
  ["missing user", null, false],
  ["missing metadata", {}, false],
  ["user metadata cannot substitute", { app_metadata: { role: "operator" } }, false],
  ["wrong SEVE role", { app_metadata: { seve_role: "viewer" } }, false],
  ["operator app metadata", { app_metadata: { seve_role: "operator" } }, true],
];

for (const [name, user, expected] of cases) {
  assert.equal(isDeskOperator(user), expected, name);
}

console.log(`operator-selftest: ${cases.length}/${cases.length} checks passed ✓`);
