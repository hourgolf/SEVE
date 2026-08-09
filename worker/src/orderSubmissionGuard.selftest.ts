import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeOrderSubmissionGuard, ORDER_SUBMISSION_GUARD_VERSION } from "./orderSubmissionGuard.js";

const guard = makeOrderSubmissionGuard();
assert.equal(ORDER_SUBMISSION_GUARD_VERSION, "order-submit-once-v1");
assert.equal(guard.claim("alpha-SPY-1"), true);
assert.equal(guard.claim("alpha-SPY-1"), false);
assert.equal(guard.claim(" alpha-SPY-1 "), false);
assert.equal(guard.claim(""), false);
assert.equal(guard.has("alpha-SPY-1"), true);
assert.equal(guard.size(), 1);

const executeSource = readFileSync(new URL("./execute.ts", import.meta.url), "utf8");
const claimAt = executeSource.indexOf("orderSubmissionGuard.claim(coidBase)");
const marketSubmitAt = executeSource.indexOf("alpaca.orderAndFill(", claimAt);
const ladderSubmitAt = executeSource.indexOf("alpaca.limitLadderFill(", claimAt);
assert.ok(claimAt > 0, "execute must claim the deterministic client order id");
assert.ok(marketSubmitAt > claimAt, "market order submission must occur after the claim");
assert.ok(ladderSubmitAt > claimAt, "spread ladder submission must occur after the claim");
assert.doesNotMatch(executeSource, /orderSubmissionGuard\.(release|delete|clear)/,
  "an ambiguous broker response must not release the claim");

console.log("order-submission-guard-selftest: PASS");
