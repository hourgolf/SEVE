"use client";

import { useMemo, useState } from "react";
import { deriveChannelConfigDraft, type ChannelConfigDraftPatch } from "@/lib/channels/channelConfigDraft";
import type { ChannelPassport } from "@/lib/channels/channelPassport";
import type { StrategistState } from "@/lib/desk/types";

/** Local-only proposal state. Drafts survive row changes within the mounted
 * workspace, but never cross into the desk reducer, Supabase, or the worker. */
export function useChannelConfigDraft(channel?: StrategistState, passport?: ChannelPassport) {
  const [drafts, setDrafts] = useState<Record<string, ChannelConfigDraftPatch>>({});
  const slug = channel?.slug ?? "";
  const active = !!slug && Object.prototype.hasOwnProperty.call(drafts, slug);
  const patch = active ? drafts[slug] : {};
  const proposed = channel ? { ...channel.config, ...patch } : undefined;
  const model = useMemo(() => channel && passport ? deriveChannelConfigDraft({
    slug: channel.slug,
    baseConfig: channel.config,
    patch,
    releaseState: passport.release.state,
    releaseId: passport.release.releaseId,
    releaseHash: passport.release.receipt?.configHash ?? passport.release.expectedHash,
    configurationEpochId: passport.rootPolicy?.configurationEpochId ?? null,
  }) : null, [channel, passport, patch]);

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

  return { active, proposed, model, begin, update, discard };
}
