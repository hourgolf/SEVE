import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./useOpsEvidence.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(hook, /pollMs = 120_000, enabled = true/, "OPS evidence should default to a slow cadence");
assert.match(hook, /if \(!enabled\) return;/, "disabled workspaces must perform no OPS reads");
assert.match(hook, /\.limit\(150\)/, "large evidence ledgers should be bounded");
assert.doesNotMatch(hook, /\.limit\(500\)/, "OPS poll must not fetch 500-row ledgers");
assert.match(hook, /\[enabled, pollMs\]/, "workspace activation must restart the effect");
assert.match(page, /useOpsEvidence\(120_000, activeRoom === "ops"\)/, "only OPS should activate deep evidence reads");

console.log("ops-evidence-read-selftest: 6/6 passed");
