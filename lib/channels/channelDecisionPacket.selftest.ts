import assert from "node:assert/strict";
import {
  buildVersionedChannelDecisionPacket,
  readVersionedChannelDecisionPacket,
} from "./channelDecisionPacket";

const packet = buildVersionedChannelDecisionPacket({
  sessionDateEt: "2026-07-30",
  generatedAt: "2026-07-30T22:00:00.000Z",
  releaseId: "release:test",
  manifestContentHash: `sha256:${"1".repeat(64)}`,
  configurationEpochId: `sha256:${"2".repeat(64)}`,
  predecessorContentHash: `sha256:${"3".repeat(64)}`,
  slugs: ["pb-ride", "new-observer"],
  exactCurrentCohorts: [{
    slug: "pb-ride",
    channelSpecVersionId: "channel:pb-ride:v2",
    configurationEpochId: `sha256:${"2".repeat(64)}`,
    observations: 7,
    sessions: 4,
    totalUsd: 175,
    evidenceRef: `sha256:${"4".repeat(64)}`,
  }],
  reviewBasisVersion: "channel-decision-review-test",
});

assert.match(packet.contentHash, /^sha256:[0-9a-f]{64}$/);
assert.equal(packet.authority.configurationChangeAuthorized, false);
assert.equal(packet.authority.mutationAuthorized, false);
assert.equal(
  packet.reviews["pb-ride"].layers[0].comparability,
  "exact-current",
);
assert.equal(packet.reviews["pb-ride"].layers[0].expectancyUsd, 25);
assert.equal(
  packet.reviews["new-observer"].disposition,
  "insufficient-evidence",
);
assert.deepEqual(readVersionedChannelDecisionPacket(packet), packet);
assert.equal(readVersionedChannelDecisionPacket({
  ...packet,
  sessionDateEt: "2026-07-31",
}), null);

console.log("channelDecisionPacket selftest passed");
