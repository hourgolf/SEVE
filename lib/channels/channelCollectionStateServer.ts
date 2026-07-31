import type { SupabaseClient } from "@supabase/supabase-js";
import {
  previewChannelCollectionCull,
  type ChannelCollectionCullPreview,
  type ChannelCollectionInventoryItem,
  type ChannelCollectionStateChange,
} from "./channelCollectionState";
import { loadStoredReceiptBoundControlPlane } from "./channelControlPlanePersistence";

export class ChannelCollectionStateServerError extends Error {
  readonly status: 400 | 409 | 422 | 503;

  constructor(
    message: string,
    status: 400 | 409 | 422 | 503 = 400,
  ) {
    super(message);
    this.name = "ChannelCollectionStateServerError";
    this.status = status;
  }
}

interface CurrentRow {
  channel_id: string;
  channel_slug: string;
  state: "active" | "paused" | "archived";
  receipt_id: string;
}

export async function loadChannelCollectionInventory(
  client: SupabaseClient,
): Promise<ChannelCollectionInventoryItem[]> {
  const [channelsRead, collectionRead, controlPlane] = await Promise.all([
    client.from("strategists")
      .select("id,slug")
      .order("slug"),
    client.from("channel_collection_state_current")
      .select("channel_id,channel_slug,state,receipt_id")
      .order("channel_slug"),
    loadStoredReceiptBoundControlPlane(client),
  ]);
  if (channelsRead.error) {
    throw new ChannelCollectionStateServerError(
      `channel inventory is unavailable: ${channelsRead.error.message}`,
      503,
    );
  }
  if (collectionRead.error) {
    throw new ChannelCollectionStateServerError(
      `collection registry is unavailable: ${collectionRead.error.message}`,
      503,
    );
  }
  if (controlPlane.state === "failed") {
    throw new ChannelCollectionStateServerError(
      `control-plane identity is unavailable: ${controlPlane.error ?? "unknown"}`,
      503,
    );
  }
  const current = new Map(
    ((collectionRead.data ?? []) as CurrentRow[])
      .map((row) => [row.channel_id, row]),
  );
  const executing = new Set(
    controlPlane.compiled?.channelSpecs
      .filter((spec) => (spec.executionPosture ?? "paper") === "paper")
      .map((spec) => spec.channelId) ?? [],
  );
  const inventory = (channelsRead.data ?? []).map((channel) => {
    const id = String(channel.id ?? "");
    const slug = String(channel.slug ?? "");
    const row = current.get(id);
    if (!row || row.channel_slug !== slug) {
      throw new ChannelCollectionStateServerError(
        `collection registry is incomplete for ${slug || id}`,
        503,
      );
    }
    return {
      channelId: id,
      channelSlug: slug,
      executionPosture: executing.has(id)
        ? "paper" as const
        : "observe-only" as const,
      collectionState: row.state,
      currentReceiptId: row.receipt_id,
    };
  });
  if (inventory.length !== current.size) {
    throw new ChannelCollectionStateServerError(
      "collection registry contains an unknown or duplicate channel",
      503,
    );
  }
  return inventory;
}

export function parseCollectionStateChanges(
  value: unknown,
): ChannelCollectionStateChange[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelCollectionStateServerError("request body must be an object");
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.changes) || body.changes.length < 1
      || body.changes.length > 68) {
    throw new ChannelCollectionStateServerError(
      "changes must contain 1 to 68 channel transitions",
    );
  }
  return body.changes.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ChannelCollectionStateServerError(
        `changes[${index}] must be an object`,
      );
    }
    const change = entry as Record<string, unknown>;
    const exact = Object.keys(change).sort().join(",");
    if (exact !== "channelId,evidenceRefs,reason,targetState") {
      throw new ChannelCollectionStateServerError(
        `changes[${index}] contains unknown or missing fields`,
      );
    }
    if (typeof change.channelId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(change.channelId)
        || typeof change.reason !== "string"
        || typeof change.targetState !== "string"
        || !Array.isArray(change.evidenceRefs)
        || change.evidenceRefs.some((ref) => typeof ref !== "string")) {
      throw new ChannelCollectionStateServerError(
        `changes[${index}] contains invalid field types`,
      );
    }
    return {
      channelId: change.channelId,
      targetState: change.targetState as
        ChannelCollectionStateChange["targetState"],
      reason: change.reason,
      evidenceRefs: change.evidenceRefs as string[],
    };
  });
}

export async function buildChannelCollectionPreview(input: {
  client: SupabaseClient;
  changes: ChannelCollectionStateChange[];
}): Promise<{
  inventory: ChannelCollectionInventoryItem[];
  preview: Readonly<ChannelCollectionCullPreview>;
}> {
  const inventory = await loadChannelCollectionInventory(input.client);
  const preview = previewChannelCollectionCull({
    inventory,
    changes: input.changes,
  });
  if (preview.state !== "reviewable") {
    throw new ChannelCollectionStateServerError(
      `collection preview blocked: ${preview.blockers.join("; ")}`,
      422,
    );
  }
  return { inventory, preview };
}
