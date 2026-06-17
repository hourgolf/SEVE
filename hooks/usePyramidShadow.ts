"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabaseClient";

// Live read of the PYRAMID SHADOW events the worker writes (Phase A, V3/ALT): each is a
// "would add ×N" the engine pyramid gate fired on a winning position while held — placing
// NO order. Tracks the graduation evidence (do the live would-be adds match the engine
// replay over 5-10 sessions). Reads `events` directly (message 'stream-shadow: PYRAMID%')
// so it's live without waiting on a day-report run; mount-only (refresh to refresh).

export interface PyramidShadowEvent {
  createdAt: string; slug: string; occ: string; dir: string;
  wouldQty: number; appreciatedPct: number; base: number; ask: number;
}
export interface PyramidChannelAgg { slug: string; name: string; adds: number; contracts: number }

const NAME_BY_SLUG: Record<string, string> = {
  "breakout-alt-v3": "BREAK(ALT V3)",
  "breakout-smart-entries": "BREAK(ALT)",
};
export const pyramidName = (slug: string) => NAME_BY_SLUG[slug] ?? slug;

export function usePyramidShadow(days = 14): {
  events: PyramidShadowEvent[]; byChannel: PyramidChannelAgg[]; loading: boolean; error: string | null;
} {
  const [events, setEvents] = useState<PyramidShadowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sb = getSupabase();
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await sb
        .from("events")
        .select("created_at,meta")
        .like("message", "stream-shadow: PYRAMID%")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!alive) return;
      if (error) { setError(error.message); setLoading(false); return; }
      const evs: PyramidShadowEvent[] = ((data ?? []) as Array<{ created_at: string; meta: Record<string, unknown> | null }>).map((r) => {
        const m = (r.meta ?? {}) as Record<string, unknown>;
        return {
          createdAt: r.created_at, slug: String(m.slug ?? "?"), occ: String(m.occ ?? ""), dir: String(m.dir ?? ""),
          wouldQty: Number(m.wouldQty ?? 0), appreciatedPct: Number(m.appreciatedPct ?? 0),
          base: Number(m.base ?? 0), ask: Number(m.ask ?? 0),
        };
      });
      setEvents(evs); setLoading(false);
    })().catch((e) => { if (alive) { setError((e as Error)?.message ?? "read failed"); setLoading(false); } });
    return () => { alive = false; };
  }, [days]);

  const byMap = new Map<string, { adds: number; contracts: number }>();
  for (const e of events) { const a = byMap.get(e.slug) ?? { adds: 0, contracts: 0 }; a.adds++; a.contracts += e.wouldQty; byMap.set(e.slug, a); }
  const byChannel = [...byMap.entries()]
    .map(([slug, a]) => ({ slug, name: pyramidName(slug), ...a }))
    .sort((x, y) => y.contracts - x.contracts);

  return { events, byChannel, loading, error };
}
