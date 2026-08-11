import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "./prepare-pb-itm-ustop-experiments.ts",
  import.meta.url,
), "utf8");

assert.match(source, /buildDecisionAtlasPbRideItmRegistration/);
assert.match(source, /loadChannelRosterBundleServerContext/);
assert.match(source, /orb\.quantity !== 4/);
assert.match(source, /slug: "orb-ustop-ctl", quantity: 5/);
assert.match(source, /bundle:whole_lot_manager_incompatible:orb-ustop-ctl/);
assert.match(source, /hold-at-four-until-an-even-size-replay/);
assert.match(source, /slug: candidate\.slug,[\s\S]+?quantity: 1/);
assert.match(source, /admissionPolicyUpserts: \[updatedLabPolicy\]/);
assert.match(source, /--persist-draft requires --publish-registration/);
assert.match(source, /runtimeMutationAuthorized: false/);
assert.match(source, /orderAuthority: false/);
assert.doesNotMatch(source, /activate_channel_roster_bundle/);
assert.doesNotMatch(source, /placeOrder|submitOrder|executeEntry/);

console.log("prepare-pb-itm-ustop-experiments-selftest: 13/13 passed");
