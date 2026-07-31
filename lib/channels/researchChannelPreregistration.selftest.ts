import assert from "node:assert/strict";
import { planResearchChannelPreregistration } from "./researchChannelPreregistration.js";

const inventory = [
  {
    identity: {
      strategistId: "11111111-1111-4111-8111-111111111111",
      slug: "active-channel",
    },
    blockers: [{ code: "COLLISION_FAMILY_UNSTAMPED" }],
  },
  {
    identity: {
      strategistId: "22222222-2222-4222-8222-222222222222",
      slug: "dark-channel",
    },
    blockers: [
      { code: "HARVEST_POLICY_UNSTAMPED" },
      { code: "COLLISION_FAMILY_UNSTAMPED" },
    ],
  },
];

const first = planResearchChannelPreregistration({
  inventory,
  activeChannelIds: new Set([inventory[0].identity.strategistId]),
  activeSlugs: new Set([inventory[0].identity.slug]),
  existing: [],
  registeredAt: "2026-07-31T20:05:00.000Z",
  registeredBy: "system:inventory-selftest",
});
assert.deepEqual(first.skippedActive, ["active-channel"]);
assert.equal(first.registrations.length, 1);
assert.equal(first.registrations[0].registration.slug, "dark-channel");
assert.equal(first.registrations[0].registration.state, "registered-blocked");
assert.equal(first.registrations[0].registration.executionAuthority, false);
assert.equal(first.registrations[0].registration.runtimeMutationAuthorized, false);
assert.equal(first.registrations[0].registration.orderAuthority, false);
assert.deepEqual(first.registrations[0].registration.declaredBlockers, [
  "inventory:collision_family_unstamped",
  "inventory:harvest_policy_unstamped",
]);
assert.match(first.registrations[0].recordId, /^[0-9a-f-]{36}$/);

const repeated = planResearchChannelPreregistration({
  inventory,
  activeChannelIds: new Set([inventory[0].identity.strategistId]),
  activeSlugs: new Set([inventory[0].identity.slug]),
  existing: [{
    registrationKey: first.registrations[0].registration.id,
    channelId: inventory[1].identity.strategistId,
    state: "registered-blocked",
    isCurrent: true,
  }],
  registeredAt: "2026-07-31T20:05:30.000Z",
  registeredBy: "system:inventory-selftest",
});
assert.equal(repeated.registrations.length, 0);
assert.deepEqual(repeated.skippedExactInventory, ["dark-channel"]);

const eligible = planResearchChannelPreregistration({
  inventory: [inventory[1]],
  activeChannelIds: new Set(),
  activeSlugs: new Set(),
  existing: [{
    registrationKey: "research:dark-channel:sealed",
    channelId: inventory[1].identity.strategistId,
    state: "paper-eligible",
    isCurrent: true,
  }],
  registeredAt: "2026-07-31T20:05:30.000Z",
  registeredBy: "system:inventory-selftest",
});
assert.equal(eligible.registrations.length, 0);
assert.deepEqual(eligible.skippedCurrentPaperEligible, ["dark-channel"]);

const historicalEligibilityDoesNotMaskCurrentBlocked =
  planResearchChannelPreregistration({
    inventory: [inventory[1]],
    activeChannelIds: new Set(),
    activeSlugs: new Set(),
    existing: [{
      registrationKey: "research:dark-channel:historical-eligible",
      channelId: inventory[1].identity.strategistId,
      state: "paper-eligible",
      isCurrent: false,
    }],
    registeredAt: "2026-07-31T20:06:00.000Z",
    registeredBy: "system:inventory-selftest",
  });
assert.equal(historicalEligibilityDoesNotMaskCurrentBlocked.registrations.length, 1);

console.log("research-channel-preregistration-selftest: 16/16 passed");
