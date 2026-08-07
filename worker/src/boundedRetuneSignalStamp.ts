import { createHash } from "node:crypto";
import {
  boundedRetuneForChannel,
  buildBoundedRetuneSignalStamp,
  type BoundedRetuneSignalStamp,
} from "../../lib/research/boundedRetuneRegistry.js";
import type { ChannelConfig } from "./store.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function boundedRetuneSourceHash(channel: Pick<ChannelConfig, "slug" | "spec_json">): string | null {
  const definition = boundedRetuneForChannel(channel.slug);
  if (!definition) return null;
  if (channel.spec_json && typeof channel.spec_json === "object"
    && Object.keys(channel.spec_json as Record<string, unknown>).length) {
    return `sha256:${createHash("sha256").update(canonical(channel.spec_json)).digest("hex")}`;
  }
  // Registry strategies are reviewed with the source-bundle hash sealed in the
  // definition. A future registry edit must issue v2 rather than reusing v1.
  return definition.baseline.sourceContentHash;
}

export function boundedRetuneSignalStamp(
  channel: Pick<ChannelConfig,
    "slug" | "spec_json" | "max_contracts" | "premium_stop_pct" | "take_profit_pct">,
): BoundedRetuneSignalStamp | null {
  const sourceContentHash = boundedRetuneSourceHash(channel);
  return sourceContentHash ? buildBoundedRetuneSignalStamp({
    channel: channel.slug,
    sourceContentHash,
    maxContracts: channel.max_contracts,
    configuredPremiumStopPct: channel.premium_stop_pct,
    takeProfitPct: channel.take_profit_pct,
  }) : null;
}

