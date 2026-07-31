import assert from "node:assert/strict";
import { previewChannelCollectionCull } from "./channelCollectionState";

const inventory = [
  {
    channelId: "11111111-1111-4111-8111-111111111111",
    channelSlug: "sealed-root",
    executionPosture: "paper" as const,
    collectionState: "active" as const,
    currentReceiptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  },
  {
    channelId: "22222222-2222-4222-8222-222222222222",
    channelSlug: "dark-candidate",
    executionPosture: "observe-only" as const,
    collectionState: "active" as const,
    currentReceiptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
];

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  void name;
};

check("observe-only collection can pause without changing execution", () => {
  const preview = previewChannelCollectionCull({
    inventory,
    changes: [{
      channelId: inventory[1].channelId,
      targetState: "paused",
      reason: "Cull a redundant shadow lane while keeping its history.",
      evidenceRefs: ["receipt:swarm-review"],
    }],
  });
  assert.equal(preview.state, "reviewable");
  assert.equal(preview.beforeCounts.active, 2);
  assert.equal(preview.afterCounts.active, 1);
  assert.equal(preview.afterCounts.paused, 1);
  assert.deepEqual(preview.guarantees, {
    executionStateChanged: false,
    activeManifestChanged: false,
    historicalEvidenceChanged: false,
    brokerOrOrderAuthority: false,
  });
});

check("executing paper channels cannot have evidence collection paused", () => {
  const preview = previewChannelCollectionCull({
    inventory,
    changes: [{
      channelId: inventory[0].channelId,
      targetState: "paused",
      reason: "Attempt to pause a sealed root collection path.",
      evidenceRefs: ["receipt:bad-cull"],
    }],
  });
  assert.equal(preview.state, "blocked");
  assert.ok(preview.blockers.includes(
    "collection:executing_channel_must_remain_active:sealed-root",
  ));
});

check("preview identity binds the exact current receipt and target", () => {
  const base = previewChannelCollectionCull({
    inventory,
    changes: [{
      channelId: inventory[1].channelId,
      targetState: "archived",
      reason: "Archive a redundant research lane after review.",
      evidenceRefs: ["receipt:archive-review"],
    }],
  });
  const drifted = previewChannelCollectionCull({
    inventory: inventory.map((item) => item.channelId === inventory[1].channelId
      ? { ...item, currentReceiptId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
      : item),
    changes: [{
      channelId: inventory[1].channelId,
      targetState: "archived",
      reason: "Archive a redundant research lane after review.",
      evidenceRefs: ["receipt:archive-review"],
    }],
  });
  assert.notEqual(base.previewHash, drifted.previewHash);
});

console.log(`channel-collection-state-selftest: ${checks}/${checks} passed`);
