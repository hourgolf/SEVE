"use client";

import { useDeskDispatch } from "@/hooks/useDeskState";
import type { StrategistState } from "@/lib/desk/types";
import type { SurfaceProps } from "@/components/surfaceTypes";

type Write = SurfaceProps["write"];

// Shared channel-ordering logic for BOTH surfaces — extracted so reorder/group-by can
// never strand in one shell again (the desktop had it; mobile didn't). It wraps the
// optimistic REORDER dispatch + the persisted write.reorderChannels(sort_order). Desktop
// drives `persist` from dnd-kit drag; mobile drives it from move()/groupBy(). The UI per
// surface stays native; the LOGIC is one source of truth.
export function useChannelOrdering(strategists: StrategistState[], write: Write) {
  const dispatch = useDeskDispatch();
  const order = strategists.map((s) => s.slug);

  // optimistic local reorder + persist the new sort_order (no-ops for anon — auth-gated write)
  const persist = (next: string[]) => {
    dispatch({ type: "REORDER", order: next });
    const byId = new Map(strategists.map((s) => [s.slug, s.id]));
    void write.reorderChannels(next.map((sl) => byId.get(sl)).filter((x): x is string => !!x));
  };

  // auto-arrange by a field, then the operator nudges by hand (desktop chip / mobile chip)
  const groupBy = (key: "underlying" | "regime") =>
    persist(
      [...strategists]
        .sort((a, b) => String(a[key] || "").localeCompare(String(b[key] || "")) || a.name.localeCompare(b.name))
        .map((s) => s.slug)
    );

  // move one channel one step earlier (-1) or later (+1) — the mobile reorder primitive
  const move = (slug: string, dir: -1 | 1) => {
    const i = order.indexOf(slug), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  return { order, persist, groupBy, move, canWrite: write.canWrite };
}
