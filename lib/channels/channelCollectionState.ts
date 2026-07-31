import { canonicalJson, contentHash } from "./channelControlPlane";

export const CHANNEL_COLLECTION_STATE_VERSION =
  "channel-collection-state-v1" as const;

export type ChannelCollectionState = "active" | "paused" | "archived";

export interface ChannelCollectionStateReceipt {
  id: string;
  channelId: string;
  channelSlug: string;
  state: ChannelCollectionState;
  priorReceiptId: string | null;
  reason: string;
  evidenceRefs: string[];
  operatorId: string;
  effectiveAt: string;
  preservesHistory: true;
  executionAuthority: false;
  orderAuthority: false;
}

export interface ChannelCollectionStateChange {
  channelId: string;
  targetState: ChannelCollectionState;
  reason: string;
  evidenceRefs: string[];
}

export interface ChannelCollectionInventoryItem {
  channelId: string;
  channelSlug: string;
  executionPosture: "paper" | "observe-only";
  collectionState: ChannelCollectionState;
  currentReceiptId: string;
}

export interface ChannelCollectionCullPreview {
  version: typeof CHANNEL_COLLECTION_STATE_VERSION;
  state: "reviewable" | "blocked";
  previewHash: string;
  changes: Array<{
    channelId: string;
    channelSlug: string;
    executionPosture: "paper" | "observe-only";
    before: ChannelCollectionState;
    after: ChannelCollectionState;
    reason: string;
    evidenceRefs: string[];
  }>;
  beforeCounts: Record<ChannelCollectionState, number>;
  afterCounts: Record<ChannelCollectionState, number>;
  blockers: string[];
  guarantees: {
    executionStateChanged: false;
    activeManifestChanged: false;
    historicalEvidenceChanged: false;
    brokerOrOrderAuthority: false;
  };
}

function counts(
  values: readonly ChannelCollectionState[],
): Record<ChannelCollectionState, number> {
  return {
    active: values.filter((value) => value === "active").length,
    paused: values.filter((value) => value === "paused").length,
    archived: values.filter((value) => value === "archived").length,
  };
}

function printable(value: string, min: number, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length >= min
    && trimmed.length <= max
    && !/[\u0000-\u001f\u007f]/.test(trimmed);
}

export function previewChannelCollectionCull(input: {
  inventory: ChannelCollectionInventoryItem[];
  changes: ChannelCollectionStateChange[];
}): Readonly<ChannelCollectionCullPreview> {
  const blockers: string[] = [];
  const inventoryById = new Map(
    input.inventory.map((item) => [item.channelId, item]),
  );
  if (inventoryById.size !== input.inventory.length) {
    blockers.push("collection:duplicate_inventory_channel");
  }
  const seen = new Set<string>();
  const changes = input.changes.map((change) => {
    const current = inventoryById.get(change.channelId);
    if (seen.has(change.channelId)) {
      blockers.push(`collection:duplicate_change:${change.channelId}`);
    }
    seen.add(change.channelId);
    if (!current) {
      blockers.push(`collection:unknown_channel:${change.channelId}`);
      return null;
    }
    if (!["active", "paused", "archived"].includes(change.targetState)) {
      blockers.push(`collection:invalid_state:${current.channelSlug}`);
    }
    if (!printable(change.reason, 8, 2_000)) {
      blockers.push(`collection:reason_invalid:${current.channelSlug}`);
    }
    if (!Array.isArray(change.evidenceRefs)
        || change.evidenceRefs.length > 32
        || change.evidenceRefs.some((ref) => !printable(ref, 1, 500))) {
      blockers.push(`collection:evidence_invalid:${current.channelSlug}`);
    }
    if (current.collectionState === change.targetState) {
      blockers.push(`collection:no_change:${current.channelSlug}`);
    }
    if (current.executionPosture === "paper"
        && change.targetState !== "active") {
      blockers.push(`collection:executing_channel_must_remain_active:${current.channelSlug}`);
    }
    return {
      channelId: current.channelId,
      channelSlug: current.channelSlug,
      executionPosture: current.executionPosture,
      before: current.collectionState,
      after: change.targetState,
      reason: change.reason.trim(),
      evidenceRefs: [...new Set(change.evidenceRefs.map((ref) => ref.trim()))].sort(),
    };
  }).filter((change): change is NonNullable<typeof change> => change !== null);
  if (!changes.length) blockers.push("collection:no_changes");

  const after = new Map(
    input.inventory.map((item) => [item.channelId, item.collectionState]),
  );
  for (const change of changes) after.set(change.channelId, change.after);
  const semantic = {
    version: CHANNEL_COLLECTION_STATE_VERSION,
    changes: [...changes].sort((left, right) =>
      left.channelId.localeCompare(right.channelId)),
    baseReceipts: input.inventory
      .filter((item) => seen.has(item.channelId))
      .map((item) => ({
        channelId: item.channelId,
        receiptId: item.currentReceiptId,
      }))
      .sort((left, right) => left.channelId.localeCompare(right.channelId)),
  };
  return Object.freeze({
    version: CHANNEL_COLLECTION_STATE_VERSION,
    state: blockers.length ? "blocked" : "reviewable",
    previewHash: contentHash(semantic),
    changes: JSON.parse(canonicalJson(changes)),
    beforeCounts: counts(input.inventory.map((item) => item.collectionState)),
    afterCounts: counts([...after.values()]),
    blockers: [...new Set(blockers)].sort(),
    guarantees: {
      executionStateChanged: false as const,
      activeManifestChanged: false as const,
      historicalEvidenceChanged: false as const,
      brokerOrOrderAuthority: false as const,
    },
  });
}
