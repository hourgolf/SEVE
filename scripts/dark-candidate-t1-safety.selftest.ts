import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./dark-candidate-t1.ts", import.meta.url), "utf8");

assert.match(source, /--download requires a positive --max-provider-cost-usd safety ceiling/);
assert.match(source, /PROVIDER_ESTIMATE_CONCURRENCY = 4/);
assert.match(source, /PROVIDER_DOWNLOAD_CONCURRENCY = 4/);
assert.match(source, /PROVIDER_PATH_TIMEOUT_MS = 600_000/);
assert.match(source, /await mapLimit\(freeze\.contractRequests, PROVIDER_ESTIMATE_CONCURRENCY, estimate\)/);
assert.match(source, /await mapLimit\(freeze\.contractRequests, PROVIDER_DOWNLOAD_CONCURRENCY/);
assert.match(source, /estimatedCostUsd > MAX_PROVIDER_COST_USD/);
assert.ok(
  source.indexOf("estimatedCostUsd > MAX_PROVIDER_COST_USD") < source.indexOf("const candidatesByContract"),
  "the cost ceiling must fail closed before any provider path download",
);
assert.doesNotMatch(source, /from ["']\.\.\/worker|alpaca|placeOrder|submitOrder/,
  "the exact scorer must remain outside trading surfaces");

console.log("dark-candidate-t1-safety-selftest: PASS");
