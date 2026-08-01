import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reconstructStoredResearchRegistry,
} from "./channelRosterBundleServerContext.js";
import { registerResearchChannel } from "./researchChannelRegistry.js";

const draft = {
  id: "research:blocked-context-fixture:1.0.0",
  channelId: "11111111-1111-4111-8111-111111111111",
  slug: "blocked-context-fixture",
  registeredAt: "2026-07-31T20:00:00.000Z",
  registeredBy: "operator:22222222-2222-4222-8222-222222222222",
  cartridge: null,
  candidateSpec: null,
  declaredBlockers: ["inventory:cartridge_missing"],
};
const registration = registerResearchChannel(draft);
const registry = reconstructStoredResearchRegistry([{
  registration_key: registration.id,
  channel_id: registration.channelId,
  channel_slug: registration.slug,
  cartridge: registration.cartridge,
  candidate_spec: registration.candidateSpec,
  state: registration.state,
  declared_blockers: registration.declaredBlockers,
  blockers: registration.blockers,
  content_hash: registration.contentHash,
  registered_by: registration.registeredBy,
  registered_at: registration.registeredAt,
}]);
assert.equal(registry.entries.length, 1);
assert.equal(registry.entries[0].contentHash, registration.contentHash);
assert.equal(registry.entries[0].state, "registered-blocked");
const postgrestRegistry = reconstructStoredResearchRegistry([{
  registration_key: registration.id,
  channel_id: registration.channelId,
  channel_slug: registration.slug,
  cartridge: registration.cartridge,
  candidate_spec: registration.candidateSpec,
  state: registration.state,
  declared_blockers: registration.declaredBlockers,
  blockers: registration.blockers,
  content_hash: registration.contentHash,
  registered_by: registration.registeredBy,
  registered_at: "2026-07-31T20:00:00.000+00:00",
}]);
assert.equal(postgrestRegistry.entries[0].contentHash, registration.contentHash);
assert.throws(() => reconstructStoredResearchRegistry([{
  registration_key: registration.id,
  channel_id: registration.channelId,
  channel_slug: registration.slug,
  cartridge: registration.cartridge,
  candidate_spec: registration.candidateSpec,
  state: registration.state,
  declared_blockers: registration.declaredBlockers,
  blockers: registration.blockers,
  content_hash: `sha256:${"0".repeat(64)}`,
  registered_by: registration.registeredBy,
  registered_at: registration.registeredAt,
}]), /identity drifted/);

const source = readFileSync(
  new URL("./channelRosterBundleServerContext.ts", import.meta.url),
  "utf8",
);
assert.match(source, /collectFreshSafeBoundary/);
assert.match(source, /\/v2\/account/);
assert.match(source, /research_channel_registration_current/);
assert.match(source, /channel_collection_state_current/);
assert.match(source, /collection registry contains duplicate channel identities/);
assert.match(source, /buildOperatorPaperCapacityEnvelope/);
assert.doesNotMatch(source, /method:\s*["']POST["']/);
assert.doesNotMatch(source, /placeOrder|submitOrder|insert\(|update\(|delete\(/);

console.log("channel-roster-bundle-server-context-selftest: 13/13 passed");
