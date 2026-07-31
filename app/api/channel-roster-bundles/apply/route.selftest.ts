import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(source, /requireDeskOperator\(req\)/);
assert.match(source, /loadActiveCompiledControlPlane/);
assert.match(source, /channel_roster_bundle_current/);
assert.match(source, /channel_roster_bundle_worker_acknowledgements/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /activate_channel_roster_bundle/);
assert.match(source, /p_safe_boundary_proof: context\.safeBoundaryProof/);
assert.match(source, /p_approved_at: activatedAt/);
assert.match(source, /p_activated_at: activatedAt/);
assert.match(source, /acknowledgedAt < Date\.now\(\) - 5 \* 60_000/);
assert.match(source, /prospective-new-entry-only/);
assert.match(source, /historicalEvidenceMutation: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /safeBoundaryProof.*input/);
assert.doesNotMatch(source, /candidate_manifest.*input/);
assert.doesNotMatch(source, /placeOrder|submitOrder|\/v2\/orders/);

console.log("channel-roster-bundle-apply-route-selftest: 16/16 passed");
