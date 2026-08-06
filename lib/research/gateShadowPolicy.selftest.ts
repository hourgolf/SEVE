import assert from "node:assert/strict";
import {
  GATE_SHADOW_BLOCK_SEMANTICS,
  gateShadowBlockSemantic,
  gateShadowTraversal,
  isDarkCandidateResearchBlockReason,
  isGateShadowBlockReason,
  isGateShadowSequentialBlockReason,
} from "./gateShadowPolicy.js";
import { readFileSync } from "node:fs";

const legacyReleaseSuppressions = [
  "day1_spy_same_clock_collision",
  "day1_reentry_disabled",
  "day1_same_occ_open",
  "day1_underlying_concurrency",
  "day1_global_concurrency",
] as const;

const domainReleaseSuppressions = [
  "admission_domain_same_clock_collision",
  "admission_domain_session_entry_limit",
  "admission_domain_family_open",
  "admission_domain_reentry_disabled",
  "admission_domain_same_occ_open",
  "admission_cross_domain_same_occ_open",
  "admission_domain_underlying_concurrency",
  "admission_domain_global_concurrency",
] as const;

for (const reason of legacyReleaseSuppressions) {
  assert.equal(isGateShadowBlockReason(reason), true, `${reason} must enter after-close reconstruction`);
  assert.equal(isGateShadowSequentialBlockReason(reason), true, `${reason} must be de-duplicated sequentially`);
}
for (const reason of domainReleaseSuppressions) {
  assert.equal(isGateShadowBlockReason(reason), true, `${reason} must enter after-close reconstruction`);
  assert.equal(isGateShadowSequentialBlockReason(reason), true, `${reason} must be de-duplicated sequentially`);
}

assert.equal(gateShadowBlockSemantic("rc54_dark_lifecycle"), "dark_lifecycle", "RC5.4 dark decisions use stable semantics");
assert.equal(gateShadowTraversal("rc54_premium_debit_cap"), "every-opportunity", "RC5.4 premium gates retain every opportunity");
assert.equal(gateShadowTraversal("rc55_dark_lifecycle"), "sequential", "future release prefixes do not require an allowlist edit");
assert.equal(isDarkCandidateResearchBlockReason("rc54_dark_lifecycle"), true, "RC5.4 dark decisions enter exact-candidate freeze");
assert.equal(isDarkCandidateResearchBlockReason("admission_domain_reentry_disabled"), true, "domain re-entry decisions enter exact-candidate freeze");
assert.equal(isDarkCandidateResearchBlockReason("admission_domain_session_entry_limit"), false, "session-entry capacity remains outside exact-candidate freeze");
assert.equal(isDarkCandidateResearchBlockReason("admission_cross_domain_same_occ_open"), false, "cross-domain occupancy remains outside exact-candidate freeze");
assert.equal(isDarkCandidateResearchBlockReason("rc54_premium_debit_cap"), false, "premium-cap decisions remain outside exact-candidate freeze");
assert.equal(isGateShadowBlockReason("unknown_dark_lifecycle"), false, "unknown namespaces fail closed");
assert.equal(isGateShadowBlockReason("admission_domain_dark_lifecycle"), false, "domain namespaces cannot borrow release-only semantics");
assert.equal(isGateShadowBlockReason("rc54_admission_closed"), false, "unknown release-scoped semantics fail closed");
assert.equal(isGateShadowBlockReason("day1_admission_closed"), false, "post-admission signals are not admitted opportunities");
assert.equal(isGateShadowBlockReason("day1_session_ledger_unavailable"), false, "missing control truth must remain censored");
assert.equal(isGateShadowBlockReason("admission_domain_new_entries_disabled"), false, "disabled configuration is not a counterfactual opportunity");
assert.equal(new Set(GATE_SHADOW_BLOCK_SEMANTICS).size, GATE_SHADOW_BLOCK_SEMANTICS.length, "block semantics must not contain duplicates");
const script = readFileSync(new URL("../../scripts/gate-shadow.ts", import.meta.url), "utf8");
assert.match(script, /if \(HAS_SERVICE\) await bank\(s, prior, false\)/, "publication must not skip rows first reconstructed read-only");
assert.doesNotMatch(script, /\.in\("blocked_reason"/, "raw block strings must not be a database allowlist");
assert.match(script, /isGateShadowBlockReason/, "raw blocked decisions must be classified by stable semantics");
assert.match(script, /VIRTUAL_TRADES_ONLY/, "bounded recovery must support a virtual-trades-only write scope");
assert.match(script, /!VIRTUAL_TRADES_ONLY && isFresh/, "journal events must be suppressed in the bounded write scope");
const verifier = readFileSync(new URL("../../scripts/verify-shadow-rebuild.ts", import.meta.url), "utf8");
assert.match(verifier, /remoteSelectOnly: true/, "independent verifier must declare its SELECT-only boundary");
assert.match(verifier, /productionWrites: 0/, "independent verifier must declare zero production writes");
assert.match(verifier, /localPayloadSha256/, "independent verifier must hash the local payload");
assert.match(verifier, /remotePayloadSha256/, "independent verifier must hash the remote payload");

const checks = (legacyReleaseSuppressions.length + domainReleaseSuppressions.length) * 2 + 24;
console.log(`gate-shadow-policy-selftest: ${checks}/${checks} passed`);
