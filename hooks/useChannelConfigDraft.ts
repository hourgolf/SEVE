"use client";

import { useMemo, useState } from "react";
import { deriveChannelConfigDraft, type ChannelConfigDraftPatch } from "@/lib/channels/channelConfigDraft";
import type { ChannelPassport } from "@/lib/channels/channelPassport";
import { activeRootRuntimeConfig } from "@/lib/channels/activeRelease";
import type { StrategistState } from "@/lib/desk/types";
import type { ChannelControlPlaneSpecView } from "@/lib/channels/channelControlPlaneOperatorView";

/** Local-only proposal state. Drafts survive row changes within the mounted
 * workspace, but never cross into the desk reducer, Supabase, or the worker. */
export function useChannelConfigDraft(
  channel?: StrategistState,
  passport?: ChannelPassport,
  activeSpec?: ChannelControlPlaneSpecView | null,
  activeConfigurationEpochId?: string | null,
) {
  const [drafts, setDrafts] = useState<Record<string, ChannelConfigDraftPatch>>({});
  const slug = channel?.slug ?? "";
  const active = !!slug && Object.prototype.hasOwnProperty.call(drafts, slug);
  const patch = active ? drafts[slug] : {};
  const baseConfig = channel
    ? passport?.release.state === "verified" && activeSpec
      ? {
        ...channel.config,
        capital_pct: activeSpec.maxRiskUsd,
        max_contracts: activeSpec.quantity,
        premium_stop_pct: activeSpec.stopLoss.catastrophePct,
        take_profit_pct: activeSpec.takeProfit.kind === "bank"
          ? activeSpec.takeProfit.targetPct ?? 0
          : 0,
      }
      : passport?.release.state === "verified" && passport.rootPolicy
        ? activeRootRuntimeConfig(channel.config, passport.rootPolicy)
        : channel.config
    : undefined;
  const proposed = baseConfig ? { ...baseConfig, ...patch } : undefined;
  const model = useMemo(() => channel && passport ? deriveChannelConfigDraft({
    slug: channel.slug,
    baseConfig: baseConfig ?? channel.config,
    patch,
    releaseState: passport.release.state,
    releaseId: passport.release.releaseId,
    releaseHash: passport.release.receipt?.configHash ?? passport.release.expectedHash,
    configurationEpochId:
      activeConfigurationEpochId
      ?? passport.rootPolicy?.configurationEpochId
      ?? null,
  }) : null, [
    activeConfigurationEpochId,
    baseConfig,
    channel,
    passport,
    patch,
  ]);

  const begin = () => {
    if (!slug) return;
    setDrafts((current) => Object.prototype.hasOwnProperty.call(current, slug) ? current : { ...current, [slug]: {} });
  };
  const update = (next: ChannelConfigDraftPatch) => {
    if (!slug || !active) return;
    setDrafts((current) => ({ ...current, [slug]: { ...current[slug], ...next } }));
  };
  const discard = () => {
    if (!slug) return;
    setDrafts((current) => {
      const next = { ...current };
      delete next[slug];
      return next;
    });
  };

  return { active, proposed, baseConfig, model, begin, update, discard };
}
