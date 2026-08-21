import assert from "node:assert/strict";
import { parseDirtyAuthorityPaths } from "./preopenSourcePurity.js";

assert.deepEqual(parseDirtyAuthorityPaths(""), []);
assert.deepEqual(parseDirtyAuthorityPaths([
  " M worker/src/rc54ReleasePolicy.ts",
  " M app/page.tsx",
  "?? scripts/ops/rc54ReadinessAdapter.ts",
  "",
].join("\n")), [
  "scripts/ops/rc54ReadinessAdapter.ts",
  "worker/src/rc54ReleasePolicy.ts",
]);
assert.deepEqual(parseDirtyAuthorityPaths(
  "R  old.ts -> worker/src/day1ReleasePolicy.ts\n",
), ["worker/src/day1ReleasePolicy.ts"]);

console.log("preopen-source-purity-selftest: PASS");
