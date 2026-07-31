import type { ChannelCollectionState } from "../../lib/channels/channelCollectionState.js";
import type { ChannelConfig } from "./store.js";

export const CHANNEL_COLLECTION_RUNTIME_VERSION =
  "channel-collection-runtime-v1" as const;

export interface StoredChannelCollectionState {
  channelId: string;
  channelSlug: string;
  state: ChannelCollectionState;
  receiptId: string;
}
export interface ChannelCollectionRuntimeResult {
  version: typeof CHANNEL_COLLECTION_RUNTIME_VERSION;
  state: "ready" | "blocked";
  channels: ChannelConfig[];
  blockers: string[];
  active: number;
  paused: number;
  archived: number;
  executionAuthority: false;
  orderAuthority: false;
}

export function applyChannelCollectionRuntime(input: {
  channels: readonly ChannelConfig[];
  collection: readonly StoredChannelCollectionState[];
  executingSlugs: readonly string[];
}): Readonly<ChannelCollectionRuntimeResult> {
  const blockers: string[] = [];
  const channelById = new Map(input.channels.map((channel) => [channel.id, channel]));
  const collectionById = new Map<string, StoredChannelCollectionState>();
  if (channelById.size !== input.channels.length) {
    blockers.push("collection_runtime:duplicate_channel");
  }
  for (const row of input.collection) {
    if (collectionById.has(row.channelId)) {
      blockers.push(`collection_runtime:duplicate_state:${row.channelId}`);
    }
    if (!channelById.has(row.channelId)) {
      blockers.push(`collection_runtime:unknown_channel:${row.channelId}`);
    }
    if (!["active", "paused", "archived"].includes(row.state)) {
      blockers.push(`collection_runtime:invalid_state:${row.channelId}`);
    }
    if (!row.receiptId.trim()) {
      blockers.push(`collection_runtime:receipt_missing:${row.channelId}`);
    }
    collectionById.set(row.channelId, row);
  }
  for (const channel of input.channels) {
    const row = collectionById.get(channel.id);
    if (!row) blockers.push(`collection_runtime:state_missing:${channel.slug}`);
    else if (row.channelSlug !== channel.slug) {
      blockers.push(`collection_runtime:slug_mismatch:${channel.slug}`);
    }
  }
  const executing = new Set(input.executingSlugs);
  for (const slug of executing) {
    const channel = input.channels.find((candidate) => candidate.slug === slug);
    const row = channel ? collectionById.get(channel.id) : null;
    if (!channel) blockers.push(`collection_runtime:executing_channel_missing:${slug}`);
    else if (!row || row.state !== "active") {
      blockers.push(`collection_runtime:executing_collection_not_active:${slug}`);
    }
  }
  const channels = blockers.length
    ? [...input.channels]
    : input.channels.map((channel) => {
      const row = collectionById.get(channel.id);
      if (!row || row.state === "active") return { ...channel };
      return {
        ...channel,
        // This is an in-memory research-collection overlay. It never changes
        // status, executor, route, economics, or the active manifest.
        is_active: false,
      };
    });
  return Object.freeze({
    version: CHANNEL_COLLECTION_RUNTIME_VERSION,
    state: blockers.length ? "blocked" : "ready",
    channels,
    blockers: [...new Set(blockers)].sort(),
    active: input.collection.filter((row) => row.state === "active").length,
    paused: input.collection.filter((row) => row.state === "paused").length,
    archived: input.collection.filter((row) => row.state === "archived").length,
    executionAuthority: false,
    orderAuthority: false,
  });
}
